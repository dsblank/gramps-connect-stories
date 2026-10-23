// The editor's changes to a story, as pure functions from one StoryDoc to
// the next -- never mutating, so undo is just keeping the old ones. Every
// change spreads the object it touches, so fields this version doesn't
// know (a newer minor version's, an extension's) ride along untouched:
// opening and saving a story must never lose anything.
import { FORMAT_ID, FORMAT_VERSION } from "../version";
import type { MediaItem, Place, Slide, SlideMedia, StoryDate, StoryDoc } from "../types";

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

/** A place with some fields set or (undefined) removed; one left with
 * nothing in it is no place at all. Its shape and overlays, and any field
 * this version doesn't know, stay as they were. */
export function patchPlace(place: Place | undefined, patch: Partial<Place>): Place | undefined {
  if (place && Object.entries(patch).every(([key, value]) => place[key as keyof Place] === value)) return place;
  const next = patched(place ?? {}, patch);
  return Object.keys(next).length ? next : undefined;
}

/** Degrees to 5 decimals: about a metre, and no float noise. */
export const roundDegrees = (value: number) => Math.round(value * 1e5) / 1e5;

/** "47.3769, 8.5417" (or with a space or semicolon between) -> a point;
 * null when that's not two numbers in range. */
export function parseLatLon(text: string): { lat: number; lon: number } | null {
  const parts = text.trim().split(/\s*[,;\s]\s*/);
  if (parts.length !== 2 || parts.some((p) => !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(p))) return null;
  const [lat, lon] = parts.map(Number);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

export function formatLatLon(lat: number, lon: number): string {
  return `${roundDegrees(lat)}, ${roundDegrees(lon)}`;
}

/** The places of the story's other slides, one per name (the first slide
 * to use it), for giving another slide the very same place. */
export function storyPlaceChoices(doc: StoryDoc, exceptIndex?: number): Place[] {
  const byName = new Map<string, Place>();
  doc.slides.forEach((slide, i) => {
    const name = slide.place?.name?.trim();
    if (i !== exceptIndex && name && !byName.has(name)) byName.set(name, slide.place!);
  });
  return [...byName.values()];
}

/** A prepared image to add to a story (see optimizeImage). */
export interface NewImage {
  data: Uint8Array;
  mime: string;
  /** File extension, without the dot. */
  ext: string;
  width?: number;
  height?: number;
}

function sameBytes(a: Uint8Array | undefined, b: Uint8Array): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** The media key whose file is exactly these bytes, if any: a photo
 * that's already in the story, chosen again. */
export function findMedia(doc: StoryDoc, files: Map<string, Uint8Array>, data: Uint8Array): string | undefined {
  for (const [key, item] of Object.entries(doc.media)) {
    if (sameBytes(files.get(item.src), data)) return key;
  }
  return undefined;
}

/** Adds an image to the story's media (not to any slide), or finds the
 * identical one already there, so the same photo is stored once. Returns
 * its media key. */
export function addImage(
  doc: StoryDoc, files: Map<string, Uint8Array>, image: NewImage, stem = "photo",
): { doc: StoryDoc; files: Map<string, Uint8Array>; key: string } {
  const existing = findMedia(doc, files, image.data);
  if (existing) return { doc, files, key: existing };
  let n = 1;
  const taken = (key: string) => Object.prototype.hasOwnProperty.call(doc.media, key) || files.has(`media/${key}.${image.ext}`);
  while (taken(`${stem}-${n}`)) n += 1;
  const key = `${stem}-${n}`;
  const src = `media/${key}.${image.ext}`;
  const item: MediaItem = {
    src, mime: image.mime,
    ...(image.width ? { width: image.width } : {}),
    ...(image.height ? { height: image.height } : {}),
  };
  return {
    doc: { ...doc, media: { ...doc.media, [key]: item } },
    files: new Map(files).set(src, image.data),
    key,
  };
}

/** A slide's photo list; an empty one removes the field. */
export function setSlidePhotos(doc: StoryDoc, index: number, media: SlideMedia[]): StoryDoc {
  return updateSlide(doc, index, { media: media.length ? media : undefined });
}

/** Changes a media item itself (its description, shared by every slide
 * that shows it). */
export function updateMedia(doc: StoryDoc, key: string, patch: Partial<MediaItem>): StoryDoc {
  if (!Object.prototype.hasOwnProperty.call(doc.media, key)) return doc;
  return { ...doc, media: { ...doc.media, [key]: patched(doc.media[key], patch) } };
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
