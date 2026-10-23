// The player's pure pieces. (The components themselves are exercised in a
// real browser by scripts/test-player.mjs.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStoryText } from "../player/text";
import { dateCoversYear, edtfYearRange, timelineYear } from "../player/dates";
import { placeBounds, placeCenter, storyPlaces } from "../player/geo";
import { axisTicks, storyDomain, tickLabel, xForYear } from "../player/timelineLayout";

test("text: bold, italic, line breaks and paragraphs", () => {
  assert.deepEqual(parseStoryText("Born *about* 1850 in **Zürich**."), [[[
    { text: "Born " }, { text: "about", italic: true }, { text: " 1850 in " }, { text: "Zürich", bold: true }, { text: "." },
  ]]]);
  assert.deepEqual(parseStoryText("one\ntwo\n\nthree"), [
    [[{ text: "one" }], [{ text: "two" }]],
    [[{ text: "three" }]],
  ]);
  assert.deepEqual(parseStoryText("a\r\n\r\n\r\nb"), [[[{ text: "a" }]], [[{ text: "b" }]]]);
  assert.deepEqual(parseStoryText(""), []);
});

test("text: nothing else is markup", () => {
  assert.deepEqual(parseStoryText("<b>hi</b> & 5 * 3"), [[[{ text: "<b>hi</b> & 5 * 3" }]]]);
  // A marker doesn't span a line break.
  assert.deepEqual(parseStoryText("*a\nb*"), [[[{ text: "*a" }], [{ text: "b*" }]]]);
  assert.deepEqual(parseStoryText("**a**"), [[[{ text: "a", bold: true }]]]);
});

test("dates: EDTF year ranges", () => {
  assert.deepEqual(edtfYearRange("1850"), { min: 1850, max: 1850 });
  assert.deepEqual(edtfYearRange("1850-03-12~"), { min: 1850, max: 1850 });
  assert.deepEqual(edtfYearRange("1840/1860"), { min: 1840, max: 1860 });
  assert.deepEqual(edtfYearRange("1860/1840"), { min: 1840, max: 1860 });
  assert.deepEqual(edtfYearRange("../1850"), { min: undefined, max: 1850 });
  assert.deepEqual(edtfYearRange("1850/.."), { min: 1850, max: undefined });
  assert.deepEqual(edtfYearRange("[1850~..1860~]"), { min: 1850, max: 1860 });
  assert.equal(edtfYearRange("../.."), null);
  assert.equal(edtfYearRange("spring 1850"), null);
  assert.equal(edtfYearRange(undefined), null);
});

test("dates: an overlay shows only in its own era", () => {
  const era = { text: "1840–1860", edtf: "1840/1860" };
  assert.equal(dateCoversYear(era, 1850), true);
  assert.equal(dateCoversYear(era, 1900), false);
  assert.equal(dateCoversYear(era, null), true); // standard map
  assert.equal(dateCoversYear(undefined, 1900), true); // undated
  assert.equal(dateCoversYear({ text: "old" }, 1900), true); // no EDTF
  assert.equal(dateCoversYear({ text: "before 1850", edtf: "../1850" }, 1849), true);
  assert.equal(dateCoversYear({ text: "before 1850", edtf: "../1850" }, 1851), false);
});

test("dates: timeline positions", () => {
  assert.equal(timelineYear({ text: "1850", sortYear: 1850 }), 1850);
  assert.equal(timelineYear({ text: "March 1850", edtf: "1850-03", sortYear: 1850 }), 1850 + 2 / 12);
  assert.equal(timelineYear({ text: "12 March 1850", edtf: "1850-03-12", sortYear: 1850 }), 1850 + 2 / 12 + 11 / 365);
  // EDTF disagreeing with sortYear (a range) doesn't nudge it.
  assert.equal(timelineYear({ text: "1850-1860", edtf: "1850/1860", sortYear: 1855 }), 1855);
  assert.equal(timelineYear({ text: "1850", edtf: "1850" }), 1850);
  assert.equal(timelineYear({ text: "sometime" }), null);
  assert.equal(timelineYear(undefined), null);
});

test("geo: a place's point, or the middle of its shape and overlays", () => {
  assert.deepEqual(placeCenter({ lat: 47, lon: 8 }), [8, 47]);
  const shaped = {
    geometry: { type: "Feature", geometry: { type: "Polygon", coordinates: [[[8, 47], [9, 47], [9, 48], [8, 47]]] } },
    overlays: [{ media: "m", corners: [[7, 49], [8, 49], [8, 48], [7, 48]] as [number, number][] }],
  };
  assert.deepEqual(placeBounds(shaped as never), [7, 47, 9, 49]);
  assert.deepEqual(placeCenter(shaped as never), [8, 48]);
  assert.deepEqual(placeBounds({ geometry: { type: "FeatureCollection", features: [] } }), null);
  assert.equal(placeCenter({ name: "Nowhere" }), null);
  assert.equal(placeCenter(undefined), null);
});

test("geo: the story's places, for its opening view", () => {
  const shaped = {
    geometry: { type: "Feature", geometry: { type: "LineString", coordinates: [[0, 49], [2, 51]] } },
  };
  const found = storyPlaces([undefined, { lat: 47, lon: 8 }, { name: "Nowhere" }, { lat: 47, lon: 8 }, shaped as never]);
  // Zürich twice is one point; the line's middle is the other.
  assert.deepEqual(found?.points, [[8, 47], [1, 50]]);
  assert.deepEqual(found?.bounds, [0, 47, 8, 51]);
  assert.equal(storyPlaces([undefined, { name: "Nowhere" }]), null);
});

test("timeline layout", () => {
  assert.deepEqual(storyDomain([1850, 1850]), [1845, 1855]);
  assert.deepEqual(storyDomain([1800, 1900]), [1795, 1905]);
  assert.equal(xForYear(1850, [1800, 1900], 1000), 500);
  const ticks = axisTicks([1795, 1905], 1000);
  assert.deepEqual(ticks.map((t) => t.label), ["1800", "1810", "1820", "1830", "1840", "1850", "1860", "1870", "1880", "1890", "1900"]);
  assert.equal(tickLabel(-44), "44 BC");
  assert.equal(tickLabel(1850.4), "1850");
});

test("strings: the story's language, then the browser's, then English", async () => {
  const { stringsFor, ENGLISH } = await import("../player/strings");
  assert.equal(stringsFor("de-CH").next, "Weiter");
  assert.equal(stringsFor(undefined, "fr-FR").next, "Suivant");
  assert.equal(stringsFor("he", "nl").next, "Volgende");
  assert.equal(stringsFor("he"), ENGLISH);
  assert.equal(stringsFor(), ENGLISH);
  assert.equal(stringsFor("es").historicalMapYear(1850), "Mapa histórico, 1850");
});
