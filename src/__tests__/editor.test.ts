import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "../validate";
import type { StoryDoc } from "../types";
import {
  addImage, addSlide, blankStory, deleteSlide, duplicateSlide, findMedia, moveSlide, nextSlideId, pruneMedia, record, redo, slideDate,
  setSlidePhotos, startHistory, storyFileName, undo, updateMedia, updateSlide, updateStory,
} from "../editor/model";
import { suggestEdtf } from "../editor/dates";

function story(): StoryDoc {
  return {
    format: "gramps-connect-story",
    version: "1.0",
    title: "T",
    slides: [
      { id: "s0", title: "Opening" },
      { id: "s1", title: "Birth", media: [{ ref: "photo" }], date: { text: "1850", edtf: "1850", sortYear: 1850 } },
      { id: "intro-2", title: "Death" },
    ],
    media: {
      photo: { src: "media/photo.webp", mime: "image/webp" },
      unused: { src: "media/unused.webp", mime: "image/webp" },
    },
  };
}

test("editor: a blank story is valid", () => {
  const doc = blankStory("My story", "de");
  assert.equal(validate(doc).valid, true);
  assert.equal(doc.language, "de");
});

test("editor: new slide ids are unique whatever the others look like", () => {
  assert.equal(nextSlideId(story()), "s2");
  const { doc, index } = addSlide(story(), 0);
  assert.equal(index, 1);
  assert.deepEqual(doc.slides.map((s) => s.id), ["s0", "s2", "s1", "intro-2"]);
  assert.equal(nextSlideId(doc), "s3");
});

test("editor: duplicate, delete and move", () => {
  const dup = duplicateSlide(story(), 1);
  assert.equal(dup.index, 2);
  assert.equal(dup.doc.slides[2].title, "Birth");
  assert.notEqual(dup.doc.slides[2].id, "s1");
  // A deep copy: changing the copy's photo list leaves the original alone.
  dup.doc.slides[2].media!.push({ ref: "x" });
  assert.equal(dup.doc.slides[1].media!.length, 1);

  const del = deleteSlide(story(), 2);
  assert.equal(del.index, 1);
  assert.equal(del.doc.slides.length, 2);
  const only = { ...story(), slides: [story().slides[0]] };
  assert.equal(deleteSlide(only, 0).doc, only);

  assert.deepEqual(moveSlide(story(), 0, 2).slides.map((s) => s.id), ["s1", "intro-2", "s0"]);
  assert.equal(moveSlide(story(), 0, 5).slides[0].id, "s0");
});

test("editor: changes keep fields this version doesn't know", () => {
  const doc = story() as StoryDoc & Record<string, unknown>;
  doc["x-future"] = { kept: true };
  (doc.slides[1] as unknown as Record<string, unknown>)["x-note"] = "kept";
  let next = updateSlide(doc, 1, { title: "Born" });
  next = updateStory(next, { title: "New title" });
  next = moveSlide(next, 1, 0);
  assert.deepEqual((next as unknown as Record<string, unknown>)["x-future"], { kept: true });
  assert.equal((next.slides[0] as unknown as Record<string, unknown>)["x-note"], "kept");
  assert.equal(next.slides[0].title, "Born");
  // The original is untouched.
  assert.equal(doc.slides[1].title, "Birth");
});

test("editor: clearing a field removes it", () => {
  const next = updateSlide(story(), 1, { title: undefined });
  assert.equal("title" in next.slides[1], false);
});

test("editor: slide dates", () => {
  const old = { text: "1850", edtf: "1850", sortYear: 1850 };
  assert.deepEqual(slideDate(old, "about 1850", "1850~"), { text: "about 1850", edtf: "1850~" });
  // Same precise form: sortYear stays.
  assert.deepEqual(slideDate(old, "in 1850", "1850"), { text: "in 1850", edtf: "1850", sortYear: 1850 });
  assert.deepEqual(slideDate(old, "spring 1850", undefined), { text: "spring 1850" });
  assert.equal(slideDate(old, "  ", "1850"), undefined);
  assert.deepEqual(slideDate(undefined, "1900", "1900"), { text: "1900", edtf: "1900" });
});

test("editor: saving leaves out unused media", () => {
  const files = new Map([["media/photo.webp", new Uint8Array(1)], ["media/unused.webp", new Uint8Array(1)]]);
  const saved = pruneMedia(story(), files);
  assert.deepEqual(Object.keys(saved.doc.media), ["photo"]);
  assert.deepEqual([...saved.files.keys()], ["media/photo.webp"]);
  assert.equal(validate(saved.doc, saved.files).warnings.length, 0);
});

test("editor: file names", () => {
  assert.equal(storyFileName("Josef Meyer"), "Josef Meyer.story.zip");
  assert.equal(storyFileName('A/B: "C"?'), "A B C.story.zip");
  assert.equal(storyFileName("   "), "story.story.zip");
});

test("editor: undo and redo, with typing coalesced", () => {
  const a = story();
  const b = updateStory(a, { title: "B" });
  const c = updateStory(b, { title: "Bc" });
  const d = moveSlide(c, 0, 1);
  let h = startHistory(a);
  h = record(h, b, "title", 1000);
  h = record(h, c, "title", 1500); // same field, soon after: one step
  h = record(h, d, undefined, 1600);
  assert.equal(h.past.length, 2);
  h = undo(h);
  assert.equal(h.present, c);
  h = undo(h);
  assert.equal(h.present, a);
  assert.equal(undo(h), h);
  h = redo(h);
  assert.equal(h.present, c);
  // A new change after an undo drops what could have been redone.
  h = record(h, b, "other", 5000);
  assert.equal(h.future.length, 0);
});

test("editor: date text to EDTF, in the story's language", async () => {
  assert.equal(await suggestEdtf("about 3 May 1850", undefined), "1850-05-03~");
  assert.equal(await suggestEdtf("between 1850 and 1860", "en"), "[1850..1860]");
  assert.equal(await suggestEdtf("um 1850", "de"), "1850~");
  assert.equal(await suggestEdtf("vers 1850", "fr-CA"), "1850~");
  assert.equal(await suggestEdtf("spring 1850", "en"), undefined);
  assert.equal(await suggestEdtf("", "en"), undefined);
});

test("editor: adding photos stores each image once", () => {
  const doc = story();
  const files = new Map([["media/photo.webp", new Uint8Array([1, 2, 3])]]);
  const image = { data: new Uint8Array([9, 9]), mime: "image/webp", ext: "webp", width: 800, height: 600 };
  const first = addImage(doc, files, image);
  assert.equal(first.key, "photo-1");
  assert.deepEqual(first.doc.media["photo-1"], { src: "media/photo-1.webp", mime: "image/webp", width: 800, height: 600 });
  assert.deepEqual(first.files.get("media/photo-1.webp"), image.data);
  assert.equal(files.size, 1); // the original map is untouched
  // The same bytes again: the same media, nothing new.
  const again = addImage(first.doc, first.files, { ...image, data: new Uint8Array([9, 9]) });
  assert.equal(again.key, "photo-1");
  assert.equal(again.doc, first.doc);
  // An image already in the story under its own name is found too.
  assert.equal(addImage(doc, files, { data: new Uint8Array([1, 2, 3]), mime: "image/webp", ext: "webp" }).key, "photo");
  // A different image gets the next free name.
  assert.equal(addImage(first.doc, first.files, { ...image, data: new Uint8Array([7]) }).key, "photo-2");
  // Chosen again before any preparing: found by its bytes.
  assert.equal(findMedia(doc, files, new Uint8Array([1, 2, 3])), "photo");
  assert.equal(findMedia(doc, files, new Uint8Array([1, 2])), undefined);
});

test("editor: a slide's photos, and a photo's description", () => {
  let doc = setSlidePhotos(story(), 0, [{ ref: "photo", caption: "Front" }]);
  assert.deepEqual(doc.slides[0].media, [{ ref: "photo", caption: "Front" }]);
  doc = setSlidePhotos(doc, 0, []);
  assert.equal("media" in doc.slides[0], false);
  doc = updateMedia(doc, "photo", { alt: "A man in a hat" });
  assert.equal(doc.media.photo.alt, "A man in a hat");
  assert.equal(doc.media.photo.src, "media/photo.webp");
  assert.equal(updateMedia(doc, "nope", { alt: "x" }), doc);
});
