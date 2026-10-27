import type { AppService } from '@/types/system';
import { TrackerCore, type FlushedEvent } from '@/services/statistics/trackerCore';
import {
  openStatsDb,
  persistStatEvents,
  type DbPromise,
} from '@/services/statistics/statsPersistence';
import {
  DEFAULT_STATS_TRACKING_CONFIG,
  type StatBook,
  type StatsTrackingConfig,
} from '@/types/statistics';

export interface TtsStatsPage {
  page: number; // 1-based, same unit as Book.progress (see statsPageOf)
  total: number;
}

const nowSec = () => Math.floor(Date.now() / 1000);

/**
 * TTSController leaves 'playing' for a moment at every SSML block end, section
 * change and rate/voice change while the UI stays playing. One silent sample
 * therefore only flushes the event; the takeover is released once this many
 * consecutive rolls find the controller silent.
 */
const SILENT_ROLLS_TO_RELEASE = 2;
/**
 * After a silent roll, re-check this soon so a transient gap loses little time.
 * Silent samples closer together than this count once (hidden + pagehide, or a
 * hidden event right after a timer roll, cannot count one gap twice).
 */
const SILENT_RECHECK_SECONDS = 10;

// ---------------------------------------------------------------------------
// Double-count handshake. While a book's TTS recorder is playing, its bookKey
// maps to the takeover time; the visual tracker (useReadingStatsTracker)
// subscribes, closes its own pending event at exactly that time and stops
// feeding until TTS releases it.
// ---------------------------------------------------------------------------
const ttsTakeovers = new Map<string, number>();
const ttsListeners = new Set<() => void>();

export const isTtsStatsActive = (bookKey: string): boolean => ttsTakeovers.has(bookKey);

/** When TTS took over bookKey (Unix seconds), undefined when it is not recording. */
export const ttsStatsTakeoverAt = (bookKey: string): number | undefined =>
  ttsTakeovers.get(bookKey);

export const subscribeTtsStats = (listener: () => void): (() => void) => {
  ttsListeners.add(listener);
  return () => {
    ttsListeners.delete(listener);
  };
};

/** at: the takeover time to register, or null to release. */
const setTtsStatsActive = (bookKey: string, at: number | null) => {
  if (ttsTakeovers.has(bookKey) === (at !== null)) return;
  if (at === null) ttsTakeovers.delete(bookKey);
  else ttsTakeovers.set(bookKey, at);
  ttsListeners.forEach((l) => l());
};

export interface TtsStatsRecorderDeps {
  bookKey: string;
  appService: AppService;
  /** Latest book identity; null skips persisting. */
  getMeta: () => StatBook | null;
  /** Page TTS is reading (falls back to the current page at the call site). */
  getPage: () => TtsStatsPage | null;
  /** readingStatsEnabled; false => never open the db, discard in-progress. */
  isEnabled: () => boolean;
  /**
   * Whether audio is really playing (TTSController.state), sampled at each
   * roll. A silent sample flushes the event but keeps recording; only
   * SILENT_ROLLS_TO_RELEASE consecutive silent samples release the takeover,
   * so a controller that stopped or errored without the UI noticing cannot
   * keep the visual tracker muted or keep accruing time.
   */
  isAudible?: () => boolean;
  now?: () => number;
  openDb?: (appService: AppService) => DbPromise;
}

/**
 * Records page events while TTS is audibly playing, in the same table, units
 * and thresholds as TrackerCore (<min dropped, each event <= max). Unlike the
 * visual tracker it ignores idle and visibility: screen-off listening counts.
 * A long dwell on one page is rolled into consecutive max-length events from
 * its start (TrackerCore.rollTo), so a late timer loses no time.
 */
export class TtsStatsRecorder {
  private readonly core: TrackerCore;
  private dbp: DbPromise | null = null;
  private playing = false;
  private silentRolls = 0;
  private lastSilentAt: number | undefined;
  private rollTimer: number | undefined;
  private listening = false;

  constructor(
    private readonly deps: TtsStatsRecorderDeps,
    private readonly cfg: StatsTrackingConfig = DEFAULT_STATS_TRACKING_CONFIG,
  ) {
    this.core = new TrackerCore(cfg);
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  private now() {
    return (this.deps.now ?? nowSec)();
  }

  /** TTS started or resumed. */
  play(): void {
    if (!this.deps.isEnabled()) {
      this.discard();
      return;
    }
    if (!this.dbp) this.dbp = (this.deps.openDb ?? openStatsDb)(this.deps.appService);
    const t = this.now();
    this.playing = true;
    this.resetSilent();
    setTtsStatsActive(this.deps.bookKey, t);
    this.attach();
    this.feed(t);
  }

  /** The page TTS reads changed (relocate / section change). */
  onPage(): void {
    if (!this.playing) return;
    if (!this.deps.isEnabled()) {
      this.discard();
      return;
    }
    this.feed();
  }

  /** TTS paused: the dwell so far counts, the paused time does not. */
  pause(): void {
    this.end(this.closeAt(this.now()), false);
  }

  /** TTS stopped / book closed / component unmounted. */
  stop(): void {
    this.end(this.closeAt(this.now()), true);
  }

  /** Stats switched off: drop the in-progress event, write nothing. */
  discard(): void {
    this.core.onClose(this.now());
    this.release();
  }

  // Whole max-length slices first, then the remainder up to t.
  private closeAt(t: number): FlushedEvent[] {
    return [...this.core.rollTo(t), ...this.core.onIdle(t)];
  }

  private persist(events: FlushedEvent[], checkpointNow = false) {
    void persistStatEvents(this.dbp, this.deps.getMeta(), events, checkpointNow);
  }

  private end(events: FlushedEvent[], checkpointNow: boolean) {
    const wasPlaying = this.playing;
    this.release();
    if (!wasPlaying) return;
    if (!this.deps.isEnabled()) return;
    this.persist(events, checkpointNow);
  }

  private release() {
    this.playing = false;
    this.resetSilent();
    window.clearInterval(this.rollTimer);
    this.rollTimer = undefined;
    this.detach();
    setTtsStatsActive(this.deps.bookKey, null);
  }

  private resetSilent() {
    this.silentRolls = 0;
    this.lastSilentAt = undefined;
  }

  private recheckSeconds() {
    return Math.min(SILENT_RECHECK_SECONDS, this.cfg.maxEventSeconds);
  }

  private feed(t = this.now()) {
    // Audio confirmed between samples breaks the silent run.
    if (this.deps.isAudible?.() !== false) this.resetSilent();
    const p = this.deps.getPage();
    if (!p) return;
    this.persist([...this.core.rollTo(t), ...this.core.onPage(p.page, p.total, t)]);
    // While a silent run is open keep the short recheck: a page change must not
    // push the next sample back to the full period.
    this.armRoll(this.silentRolls > 0 ? this.recheckSeconds() : undefined);
  }

  // Periodic and hidden/pagehide roll: slice the dwell at the cap without
  // losing time, and sample whether audio is still playing.
  private roll = (hidden = false) => {
    if (!this.playing) return;
    if (!this.deps.isEnabled()) {
      this.discard();
      return;
    }
    const t = this.now();
    if (this.deps.isAudible && !this.deps.isAudible()) {
      const events = this.closeAt(t);
      const spaced =
        this.lastSilentAt === undefined || t - this.lastSilentAt >= this.recheckSeconds();
      if (spaced) {
        this.silentRolls += 1;
        this.lastSilentAt = t;
        if (this.silentRolls >= SILENT_ROLLS_TO_RELEASE) {
          this.end(events, hidden);
          return;
        }
      }
      this.persist(events, hidden);
      // An unspaced sample keeps the recheck already armed by the counted one.
      if (spaced) this.armRoll(this.recheckSeconds());
      return;
    }
    const resumed = this.silentRolls > 0;
    this.resetSilent();
    if (hidden) {
      // Persist everything so far (the app may be killed), keep recording.
      this.persist(this.closeAt(t), true);
      this.feed(t);
    } else if (resumed || !this.core.hasPending) {
      this.feed(t);
    } else {
      this.persist(this.core.rollTo(t));
    }
  };

  private armRoll(periodSeconds = this.cfg.maxEventSeconds) {
    window.clearInterval(this.rollTimer);
    this.rollTimer = window.setInterval(() => this.roll(), periodSeconds * 1000);
  }

  // Hidden/pagehide: persist what we have (checkpointed, the app may be killed)
  // but keep recording, since audio keeps playing with the screen off.
  private onHidden = () => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'hidden') return;
    this.roll(true);
  };

  private onPageHide = () => this.roll(true);

  private attach() {
    if (this.listening || typeof window === 'undefined') return;
    this.listening = true;
    document.addEventListener('visibilitychange', this.onHidden);
    window.addEventListener('pagehide', this.onPageHide);
  }

  private detach() {
    if (!this.listening) return;
    this.listening = false;
    document.removeEventListener('visibilitychange', this.onHidden);
    window.removeEventListener('pagehide', this.onPageHide);
  }
}
