import { useEffect, useRef } from 'react';
import { Overlayer } from 'foliate-js/overlayer.js';
import type { WordNote } from '@/types/book';
import type { FoliateView } from '@/types/view';
import { findWordNoteRanges, normalizeWord } from '@/utils/wordNotes';

interface NoteOverlayer {
  add: (value: string, range: Range, draw: typeof Overlayer.underline, options: object) => void;
  remove: (value: string) => void;
}

const PREFIX = 'openreadest-word-note:';

export const useWordNotes = (
  view: FoliateView | null,
  notes: WordNote[] | undefined,
  onShow: (note: WordNote, range: Range, index: number) => void,
) => {
  const onShowRef = useRef(onShow);
  useEffect(() => {
    onShowRef.current = onShow;
  }, [onShow]);

  useEffect(() => {
    if (!view || !notes?.length) return;
    const layers = new Map<
      Document,
      { overlayer: NoteOverlayer; keys: string[]; observer: MutationObserver; dirty: boolean }
    >();
    const matches = new Map<string, WordNote>();
    let disposed = false;

    const scan = () => {
      if (disposed) return;
      const contents = view.renderer.getContents();
      for (const [doc, layer] of layers) {
        if (
          !contents.some((content) => content.doc === doc && content.overlayer === layer.overlayer)
        ) {
          layer.keys.forEach((key) => {
            layer.overlayer.remove(key);
            matches.delete(key);
          });
          layers.delete(doc);
          layer.observer.disconnect();
        }
      }
      for (const { doc, index = 0, overlayer } of contents) {
        if (!doc || !overlayer) continue;
        let layer = layers.get(doc);
        if (!layer) {
          const observer = new MutationObserver(() => {
            const current = layers.get(doc);
            if (current) current.dirty = true;
            scheduleScan();
          });
          layer = { overlayer: overlayer as NoteOverlayer, keys: [], observer, dirty: true };
          layers.set(doc, layer);
          observer.observe(doc.body ?? doc.documentElement, {
            childList: true,
            characterData: true,
            subtree: true,
          });
        }
        if (!layer.dirty) continue;
        layer.dirty = false;
        layer.keys.forEach((key) => {
          layer.overlayer.remove(key);
          matches.delete(key);
        });
        layer.keys = [];
        for (const { note, range } of findWordNoteRanges(doc, notes)) {
          const key = `${PREFIX}${note.id}:${index}:${layer.keys.length}`;
          const element = range.startContainer.parentElement;
          const style = element && doc.defaultView?.getComputedStyle(element);
          layer.overlayer.add(key, range, Overlayer.underline, {
            color: style?.color ?? 'currentColor',
            writingMode: style?.writingMode,
          });
          layer.keys.push(key);
          matches.set(key, note);
        }
      }
    };
    // create-overlay fires just before the renderer stores its overlayer.
    const scheduleScan = () => queueMicrotask(scan);
    const show = (event: Event) => {
      const { value, range, index } = (event as CustomEvent).detail;
      const note =
        matches.get(value) ??
        notes.find((entry) => entry.word === normalizeWord(range?.toString() ?? ''));
      if (note) onShowRef.current(note, range, index);
    };
    view.addEventListener('create-overlay', scheduleScan);
    view.addEventListener('load', scheduleScan);
    view.addEventListener('relocate', scheduleScan);
    view.addEventListener('show-annotation', show);
    scan();
    return () => {
      disposed = true;
      view.removeEventListener('create-overlay', scheduleScan);
      view.removeEventListener('load', scheduleScan);
      view.removeEventListener('relocate', scheduleScan);
      view.removeEventListener('show-annotation', show);
      for (const layer of layers.values()) {
        layer.observer.disconnect();
        layer.keys.forEach((key) => layer.overlayer.remove(key));
      }
    };
  }, [view, notes]);
};
