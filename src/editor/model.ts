// The editor's changes to a story, as pure functions from one StoryDoc to
// the next -- never mutating, so undo is just keeping the old ones. Every
// change spreads the object it touches, so fields this version doesn't
// know (a newer minor version's, an extension's) ride along untouched:
// opening and saving a story must never lose anything.
import { FORMAT_ID, FORMAT_VERSION } from "../version";
import type { Slide, StoryDate, StoryDoc } from "../types";

/** A story with one empty slide: the smallest valid one. */
export function blankStory(title: string, language?: string): StoryDoc {
  return {
    format: FORMAT_ID,
    version: FORMAT_VERSION,
    title,
    ...(language ? { language } : {}),
    slides: [{ id: "s0", title }],
    media: {},
  };
}

/** "s<n>" past every id already of that form, so it's unique however the
 * story's other ids were made. */
export function nextSlideId(doc: StoryDoc): string {
  let max = -1;
  for (const slide of doc.slides) {
    const match = /^s(\d+)$/.exec(slide.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  let n = max + 1;
  const ids = new Set(doc.slides.map((s) => s.id));
  while (ids.has(`s${n}`)) n += 1;
  return `s${n}`;
}

function withSlides(doc: StoryDoc, slides: Slide[]): StoryDoc {
  return { ...doc, slides };
}

/** A new empty slide after `index`; returns the story and the new slide's
 * index. */
export function addSlide(doc: StoryDoc, index: number): { doc: StoryDoc; index: number } {
  const slides = [...doc.slides];
  const at = Math.min(Math.max(index + 1, 0), slides.length);
  slides.splice(at, 0, { id: nextSlideId(doc) });
  return { doc: withSlides(doc, slides), index: at };
}

/** A copy of the slide right after it, with its own id. */
export function duplicateSlide(doc: StoryDoc, index: number): { doc: StoryDoc; index: number } {
  const slides = [...doc.slides];
  const copy = structuredClone(slides[index]);
  copy.id = nextSlideId(doc);
  slides.splice(index + 1, 0, copy);
  return { doc: withSlides(doc, slides), index: index + 1 };
}

/** Removes a slide, unless it's the only one (a story has at least one). */
export function deleteSlide(doc: StoryDoc, index: number): { doc: StoryDoc; index: number } {
  if (doc.slides.length <= 1) return { doc, index };
  const slides = doc.slides.filter((_, i) => i !== index);
  return { doc: withSlides(doc, slides), index: Math.min(index, slides.length - 1) };
}

export function moveSlide(doc: StoryDoc, from: number, to: number): StoryDoc {
  if (from === to || to < 0 || to >= doc.slides.length) return doc;
  const slides = [...doc.slides];
  const [slide] = slides.splice(from, 1);
  slides.splice(to, 0, slide);
  return withSlides(doc, slides);
}

/** Sets fields on an object; an undefined value removes the field, so
 * cleared text doesn't linger as "". */
function patched<T extends object>(base: T, patch: Partial<T>): T {
  const next = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return next as T;
}

export function updateSlide(doc: StoryDoc, index: number, patch: Partial<Slide>): StoryDoc {
  const slides = [...doc.slides];
  slides[index] = patched(slides[index], patch);
  return withSlides(doc, slides);
}

export function updateStory(doc: StoryDoc, patch: Partial<Omit<StoryDoc, "slides" | "media">>): StoryDoc {
  return patched(doc, patch as Partial<StoryDoc>);
}

/** A slide date from what was typed and its precise form. Empty text is no
 * date at all. A new precise form drops a `sortYear` it would contradict
 * (the timeline reads sortYear first); the date's other fields stay. */
export function slideDate(previous: StoryDate | undefined, text: string, edtf: string | undefined): StoryDate | undefined {
  if (!text.trim()) return undefined;
  const next = patched(previous ?? { text }, { text, edtf: edtf || undefined });
  if (next.edtf !== previous?.edtf) delete next.sortYear;
  return next;
}

/** Every media key a slide or overlay refers to. */
export function usedMedia(doc: StoryDoc): Set<string> {
  const used = new Set<string>();
  for (const slide of doc.slides) {
    for (const m of slide.media ?? []) used.add(m.ref);
    for (const o of slide.place?.overlays ?? []) used.add(o.media);
  }
  return used;
}

/** The story as it should be saved: media nothing refers to any more left
 * out, and the files only those that are still used. */
export function pruneMedia(doc: StoryDoc, files: Map<string, Uint8Array>): { doc: StoryDoc; files: Map<string, Uint8Array> } {
  const used = usedMedia(doc);
  const media = Object.fromEntries(Object.entries(doc.media).filter(([key]) => used.has(key)));
  const srcs = new Set(Object.values(media).map((m) => m.src));
  return {
    doc: { ...doc, media },
    files: new Map([...files].filter(([path]) => srcs.has(path))),
  };
}

/** "Josef Meyer" -> "Josef Meyer.story.zip", minus characters some file
 * systems refuse. */
export function storyFileName(title: string): string {
  const safe = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  return `${safe || "story"}.story.zip`;
}

/** Undo and redo over whole documents. Typing in one field makes one step,
 * not one per keystroke: a change with the same `key` within COALESCE_MS
 * of the last replaces it. */
export interface History {
  past: StoryDoc[];
  present: StoryDoc;
  future: StoryDoc[];
  lastKey?: string;
  lastAt?: number;
}

export const COALESCE_MS = 1500;
const MAX_STEPS = 200;

export function startHistory(doc: StoryDoc): History {
  return { past: [], present: doc, future: [] };
}

export function record(history: History, next: StoryDoc, key?: string, now = Date.now()): History {
  if (next === history.present) return history;
  const coalesce = key !== undefined && key === history.lastKey && history.lastAt !== undefined && now - history.lastAt < COALESCE_MS;
  const past = coalesce ? history.past : [...history.past, history.present].slice(-MAX_STEPS);
  return { past, present: next, future: [], lastKey: key, lastAt: now };
}

export function undo(history: History): History {
  const previous = history.past[history.past.length - 1];
  if (!previous) return history;
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] };
}

export function redo(history: History): History {
  const [next, ...future] = history.future;
  if (!next) return history;
  return { past: [...history.past, history.present], present: next, future };
}
