'use client';

import { useEffect, useRef } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { isReadingStatsEnabled } from '@/services/statistics/remainingTime';
import { TtsStatsRecorder } from '@/services/statistics/ttsStatsRecorder';
import { statsPageOf, type StatsPage } from '@/hooks/useReadingStatsTracker';
import type { TTSController } from '@/services/tts';
import type { StatBook } from '@/types/statistics';

/** How often to look for audio again after the recorder released on silence. */
const RECOVER_PROBE_MS = 5000;

/**
 * Drives a TtsStatsRecorder from TTSControl's play state. isPlaying is the
 * UI play flag (false while paused); controller is the live TTSController,
 * null once TTS is stopped. Records only for the primary view (split view),
 * only while reading stats are enabled; a switch-off discards the in-progress
 * event without opening the db. Unmount / book switch persists and releases
 * the double-count registry so the visual tracker resumes.
 */
export function useTtsStatsRecorder(
  bookKey: string,
  isPlaying: boolean,
  controller: TTSController | null,
): void {
  const { appService } = useEnv();
  const enabled = useSettingsStore((s) => isReadingStatsEnabled(s.settings));
  const isPrimary = useReaderStore((s) => s.viewStates[bookKey]?.isPrimary ?? false);
  const progress = useReaderStore((s) => s.viewStates[bookKey]?.progress ?? null);
  const getBookData = useBookDataStore((s) => s.getBookData);
  const bookData = getBookData(bookKey);
  const book = bookData?.book;
  const bookMd5 = book?.hash;
  const title = book?.title ?? '';
  const authors = book?.author ?? '';

  // TTS scrolls the view to the spoken range, so the view's current page is the
  // page being read; it is also the fallback before the first highlight.
  const stat = statsPageOf(!!bookData?.isFixedLayout, progress?.section, progress?.pageinfo);
  const page = stat?.page;
  const total = stat?.total;

  const metaRef = useRef<StatBook | null>(null);
  const pageRef = useRef<StatsPage | null>(null);
  const controllerRef = useRef<TTSController | null>(controller);
  const recorderRef = useRef<TtsStatsRecorder | null>(null);
  const enabledRef = useRef(enabled);

  // Declared first so the refs are current before the play/page effects below.
  useEffect(() => {
    metaRef.current = bookMd5 ? { bookMd5, title, authors } : null;
    pageRef.current = page !== undefined && total !== undefined ? { page, total } : null;
    controllerRef.current = controller;
    enabledRef.current = enabled;
  });

  // One recorder per book view; unmount / book switch flushes and releases.
  useEffect(() => {
    if (!appService) return;
    const recorder = new TtsStatsRecorder({
      bookKey,
      appService,
      getMeta: () => metaRef.current,
      getPage: () => pageRef.current,
      isEnabled: () => enabledRef.current,
      isAudible: () => controllerRef.current?.state === 'playing',
    });
    recorderRef.current = recorder;
    return () => {
      recorder.stop();
      if (recorderRef.current === recorder) recorderRef.current = null;
    };
  }, [appService, bookKey]);

  const hasController = !!controller;
  const recording = enabled && isPrimary && isPlaying && hasController;

  useEffect(() => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (!enabled) recorder.discard();
    else if (recording) recorder.play();
    else if (!hasController) recorder.stop();
    else recorder.pause();
  }, [appService, bookKey, enabled, recording, hasController]);

  // After a silent release (the controller left 'playing' for two spaced
  // samples while the UI kept playing) none of the deps above change, so probe
  // at low frequency and resume once audio is audible again. play() re-runs the
  // takeover handshake, so the visual tracker closes at the same instant.
  useEffect(() => {
    if (!recording) return;
    const id = window.setInterval(() => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.isPlaying) return;
      if (enabledRef.current && controllerRef.current?.state === 'playing') recorder.play();
    }, RECOVER_PROBE_MS);
    return () => window.clearInterval(id);
  }, [appService, bookKey, recording]);

  // Page / section change while reading aloud splits the event.
  useEffect(() => {
    recorderRef.current?.onPage();
  }, [page, total]);
}
