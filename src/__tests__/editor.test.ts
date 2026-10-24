import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "../validate";
import type { StoryDoc } from "../types";
import {
  addImage, addSlide, blankStory, deleteSlide, duplicateSlide, findMedia, moveSlide, nextSlideId, pruneMedia, record, redo, slideDate,
  setSlidePhotos, startHistory, storyFileName, undo, updateMedia, updateSlide, updateStory, parseLatLon, formatLatLon, patchPlace,
  storyPlaceChoices,
} from "../editor/model";
import { suggestEdtf } from "../editor/dates";
import { searchWikidataPlaces, wikidataPoint } from "../editor/placeSearch";
import { editorToPlace, placeFeatures, placeToEditor } from "../editor/placeShapes";

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

test("editor: undo history works for any document, not only a StoryDoc", () => {
  // Gramps Connect's story editor keeps its own spec (slides as references).
  let h = startHistory({ title: "a", points: [] as string[] });
  h = record(h, { title: "b", points: [] }, "title", 0);
  h = record(h, { title: "b", points: ["x"] }, undefined, 10);
  assert.deepEqual(undo(h).present, { title: "b", points: [] });
  assert.equal(undo(undo(h)).present.title, "a");
  assert.deepEqual(redo(undo(h)).present.points, ["x"]);
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

test("editor: coordinates as typed", () => {
  assert.deepEqual(parseLatLon("47.3769, 8.5417"), { lat: 47.3769, lon: 8.5417 });
  assert.deepEqual(parseLatLon(" -33.9 ;151.2 "), { lat: -33.9, lon: 151.2 });
  assert.deepEqual(parseLatLon("51.5 -0.12"), { lat: 51.5, lon: -0.12 });
  assert.equal(parseLatLon("91, 0"), null);
  assert.equal(parseLatLon("0, 181"), null);
  assert.equal(parseLatLon("47.3"), null);
  assert.equal(parseLatLon("47.3, 8.5, 1"), null);
  assert.equal(parseLatLon("north, east"), null);
  assert.equal(formatLatLon(47.376912345, 8.5), "47.37691, 8.5");
});

test("editor: a place keeps its shape, overlays and unknown fields", () => {
  const place = { name: "Zürich", lat: 47.37, lon: 8.54, geometry: { type: "Point", coordinates: [8.54, 47.37] }, overlays: [], "x-note": 1 };
  const moved = patchPlace(place, { lat: 47.4, lon: 8.5 })!;
  assert.deepEqual(moved, { ...place, lat: 47.4, lon: 8.5 });
  assert.equal(patchPlace(place, { name: "Zürich" }), place, "no change, same object");
  assert.deepEqual(patchPlace({ name: "x" }, { name: undefined }), undefined, "nothing left is no place");
  assert.deepEqual(patchPlace(undefined, { name: "Bern" }), { name: "Bern" });
  assert.deepEqual(patchPlace({ name: "Bern", lat: 1, lon: 2 }, { lat: undefined, lon: undefined }), { name: "Bern" });
});

test("editor: the story's other places, one per name", () => {
  const doc = story();
  doc.slides[0].place = { name: "Zürich", lat: 1, lon: 2 };
  doc.slides[1].place = { name: " Zürich ", lat: 3, lon: 4 };
  doc.slides[2].place = { name: "Bern", lat: 5, lon: 6 };
  assert.deepEqual(storyPlaceChoices(doc).map((p) => p.lat), [1, 5]);
  assert.deepEqual(storyPlaceChoices(doc, 0).map((p) => p.lat), [3, 5]);
  assert.deepEqual(storyPlaceChoices(doc, 2).map((p) => p.name), ["Zürich"]);
});

test("editor: place search asks Wikidata in the story's language", async () => {
  const seen: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    seen.push(url);
    if (url.includes("wbsearchentities")) {
      return new Response(JSON.stringify({ search: [{ id: "Q72", label: "Zürich", description: "city in Switzerland" }, { id: "Q9" }] }));
    }
    // Q72 redirected to Q999: the answer is keyed by the new id.
    return new Response(JSON.stringify({ entities: { Q999: { claims: { P625: [{ mainsnak: { datavalue: { value: { latitude: 47.37, longitude: 8.54 } } } }] } } } }));
  }) as typeof fetch;
  try {
    const results = await searchWikidataPlaces("Zürich", "de_CH");
    assert.deepEqual(results, [{ id: "Q72", label: "Zürich", description: "city in Switzerland" }, { id: "Q9", label: "Q9" }]);
    const url = new URL(seen[0]);
    assert.equal(url.searchParams.get("language"), "de-ch");
    assert.equal(url.searchParams.get("origin"), "*");
    assert.deepEqual(await wikidataPoint(results[0]), { lat: 47.37, lon: 8.54 });
    globalThis.fetch = (async () => new Response(JSON.stringify({ entities: { Q9: { claims: {} } } }))) as typeof fetch;
    assert.equal(await wikidataPoint(results[1]), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("editor: a place's shapes and overlays, to the map editor and back", () => {
  const corners: [[number, number], [number, number], [number, number], [number, number]] = [[0, 1], [1, 1], [1, 0], [0, 0]];
  const place = {
    name: "Zürich", lat: 47.37, lon: 8.54,
    geometry: { type: "FeatureCollection", "x-source": "survey", features: [
      { type: "Feature", properties: { name: "Parish" }, geometry: { type: "Point", coordinates: [8.5, 47.3] } },
    ] },
    overlays: [{ media: "map-1850", corners, opacity: 0.7, order: 0, date: { text: "1850", edtf: "1850" }, "x-note": 1 }],
  };
  const opened = placeToEditor(place);
  assert.equal(opened.features.length, 1);
  assert.deepEqual(opened.overlays, [{ image: "map-1850", corners, opacity: 0.7, order: 0 }]);

  // Unchanged: the same place, the collection's own members and the
  // overlay's date and unknown field included.
  assert.deepEqual(editorToPlace(place, { features: opened.features, overlays: opened.overlays }, new Map()), place);

  // A new overlay, a new date for the old one, and a shape drawn.
  const moved: typeof corners = [[1, 2], [2, 2], [2, 1], [1, 1]];
  const drawn = { type: "Feature" as const, properties: { color: "#ff0000" }, geometry: { type: "LineString" as const, coordinates: [[0, 0], [1, 1]] } };
  const after = editorToPlace(
    place,
    { features: [...opened.features, drawn], overlays: [{ ...opened.overlays[0], opacity: 1 }, { image: "map-2", corners: moved, order: 10.4 }] },
    new Map([["map-1850", { text: "1850–1860", edtf: "1850/1860" }], ["map-2", undefined]]),
  )!;
  assert.equal((after.geometry as unknown as { features: unknown[] }).features.length, 2);
  assert.equal((after.geometry as Record<string, unknown>)["x-source"], "survey");
  assert.deepEqual(after.overlays, [
    { media: "map-1850", corners, order: 0, date: { text: "1850–1860", edtf: "1850/1860" }, "x-note": 1 },
    { media: "map-2", corners: moved, order: 10 },
  ]);

  // Everything taken off: the name and point stay, the rest goes.
  assert.deepEqual(editorToPlace(place, { features: [], overlays: [] }, new Map()), { name: "Zürich", lat: 47.37, lon: 8.54 });
  // A bare geometry or a Feature is read as a feature.
  assert.equal(placeFeatures({ geometry: { type: "Point", coordinates: [1, 2] } })[0].geometry.type, "Point");
  assert.equal(placeFeatures({ geometry: { type: "Feature", properties: {}, geometry: null } }).length, 0);
  // No place yet: a shape drawn makes one.
  assert.deepEqual(editorToPlace(undefined, { features: [drawn], overlays: [] }, new Map()), {
    geometry: { type: "FeatureCollection", features: [drawn] },
  });
});
