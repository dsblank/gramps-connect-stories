import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import {
  encodingCandidates,
  fitWithin,
  mediaBlob,
  readStoryZip,
  StoryFormatError,
  StoryValidationError,
  SUPPORTED_FORMAT_MAJORS,
  upgradeStory,
  validate,
  writeStoryZip,
  type StoryDoc,
} from "../index";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const EXAMPLES = `${ROOT}examples/`;

function exampleNames(): string[] {
  return readdirSync(EXAMPLES).filter((name) => statSync(`${EXAMPLES}${name}`).isDirectory());
}

function loadExample(name: string): { doc: StoryDoc; files: Map<string, Uint8Array> } {
  const dir = `${EXAMPLES}${name}/`;
  const doc = JSON.parse(readFileSync(`${dir}story.json`, "utf8")) as StoryDoc;
  const files = new Map<string, Uint8Array>();
  for (const item of Object.values(doc.media)) {
    files.set(item.src, new Uint8Array(readFileSync(`${dir}${item.src}`)));
  }
  return { doc, files };
}

/** A zip from raw entries, for cases writeStoryZip() refuses to produce. */
function rawZip(entries: Record<string, string | Uint8Array>): Uint8Array {
  const encoded: Record<string, Uint8Array> = {};
  for (const [name, data] of Object.entries(entries)) {
    encoded[name] = typeof data === "string" ? new TextEncoder().encode(data) : data;
  }
  return zipSync(encoded);
}

function minimalDoc(): StoryDoc {
  return loadExample("minimal").doc;
}

async function rejectsWith(promise: Promise<unknown>, code: string): Promise<StoryFormatError> {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof StoryFormatError, `expected StoryFormatError, got ${String(err)}`);
    assert.equal(err.code, code, err.message);
    return err;
  }
  assert.fail(`expected a "${code}" error, but it resolved`);
}

test("generated schema validator matches the schema", () => {
  execFileSync(process.execPath, [`${ROOT}scripts/generate-validator.mjs`, "--check"], { stdio: "pipe" });
});

test("there are examples to test", () => {
  assert.ok(exampleNames().length >= 4);
});

for (const name of exampleNames()) {
  test(`example "${name}" is valid with no warnings`, () => {
    const { doc, files } = loadExample(name);
    const result = validate(doc, files);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
  });

  test(`example "${name}" survives a zip round trip`, async () => {
    const { doc, files } = loadExample(name);
    const zipped = await writeStoryZip(doc, files);
    const pkg = await readStoryZip(zipped);
    assert.deepEqual(pkg.doc, doc);
    assert.deepEqual(pkg.warnings, []);
    for (const [path, data] of files) assert.deepEqual(pkg.files.get(path), data);
  });
}

test("writeStoryZip fills in format and version", async () => {
  const { format: _format, version: _version, ...rest } = minimalDoc();
  const pkg = await readStoryZip(await writeStoryZip(rest, new Map()));
  assert.equal(pkg.doc.format, "gramps-connect-story");
  assert.equal(pkg.doc.version, "1.0");
});

test("writeStoryZip refuses an invalid story", async () => {
  const doc = { ...minimalDoc(), slides: [{ id: "s0", media: [{ ref: "nope" }] }] };
  const err = await rejectsWith(writeStoryZip(doc, new Map()), "invalid");
  assert.ok(err instanceof StoryValidationError);
  assert.equal(err.issues[0].path, "/slides/0/media/0/ref");
});

test("mediaBlob returns the file with its declared type", async () => {
  const { doc, files } = loadExample("full");
  const pkg = await readStoryZip(await writeStoryZip(doc, files));
  const blob = mediaBlob(pkg, "map-1850")!;
  assert.equal(blob.type, "image/png");
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), files.get("media/map-1850.png"));
  assert.equal(mediaBlob(pkg, "missing"), undefined);
  assert.equal(mediaBlob(pkg, "toString"), undefined);
});

// --- versioning ---------------------------------------------------------

test("SUPPORTED_FORMAT_MAJORS is [1] while 1 is the only major", () => {
  assert.deepEqual([...SUPPORTED_FORMAT_MAJORS], [1]);
});

test("a newer minor version opens, and its unknown fields are ignored silently", async () => {
  const doc = { ...minimalDoc(), version: "1.7", soundtrack: "media/x.ogg" };
  const pkg = await readStoryZip(rawZip({ "story.json": JSON.stringify(doc) }));
  assert.equal(pkg.doc.version, "1.7");
  assert.deepEqual(pkg.warnings, []);
});

test("an unknown field in a 1.0 file opens, with a warning", async () => {
  const doc = minimalDoc() as StoryDoc & { slides: Record<string, unknown>[] };
  doc.slides[0].titel = "typo";
  const pkg = await readStoryZip(rawZip({ "story.json": JSON.stringify(doc) }));
  assert.deepEqual(pkg.warnings.map((w) => w.path), ["/slides/0/titel"]);
});

test("GeoJSON and extensions are open: no unknown-field warnings inside them", () => {
  const { doc, files } = loadExample("full");
  assert.deepEqual(validate(doc, files).warnings, []);
});

test("a newer major version is refused with a clear message", async () => {
  const doc = { ...minimalDoc(), version: "2.0" };
  const err = await rejectsWith(readStoryZip(rawZip({ "story.json": JSON.stringify(doc) })), "newer-version");
  assert.match(err.message, /newer viewer/);
});

test("format and version are checked before anything else", () => {
  assert.throws(() => upgradeStory([]), { code: "not-a-story" });
  assert.throws(() => upgradeStory({ ...minimalDoc(), format: "storymap" }), { code: "not-a-story" });
  assert.throws(() => upgradeStory({ ...minimalDoc(), version: "1" }), { code: "bad-version" });
  assert.throws(() => upgradeStory({ ...minimalDoc(), version: "0.9" }), { code: "bad-version" });
  assert.throws(() => upgradeStory({ ...minimalDoc(), version: 1.0 }), { code: "bad-version" });
});

// --- validation -----------------------------------------------------------

/** Error paths after `mutate` edits the "full" example. Checked against
 * the example's own files unless `files` is given -- pass null to check
 * story.json alone, so a "file not in the zip" error can't stand in for
 * the error a test is actually looking for. */
function errorsFor(mutate: (doc: any) => void, files?: Map<string, Uint8Array> | null) {
  const { doc, files: exampleFiles } = loadExample("full");
  mutate(doc);
  return validate(doc, files === null ? undefined : files ?? exampleFiles).errors.map((e) => e.path);
}

test("validation: cross-references", () => {
  assert.deepEqual(errorsFor((d) => { d.slides[2].id = "s1"; }), ["/slides/2/id"]);
  assert.deepEqual(errorsFor((d) => { d.slides[1].place.overlays[0].media = "gone"; }), ["/slides/1/place/overlays/0/media"]);
  assert.deepEqual(errorsFor(() => {}, new Map()), [
    "/media/portrait/src",
    "/media/church/src",
    "/media/map-1850/src",
  ]);
});

test("validation: schema rules", () => {
  assert.deepEqual(errorsFor((d) => { d.title = "   "; }), ["/title"]);
  assert.deepEqual(errorsFor((d) => { delete d.slides[3].place.lon; }), ["/slides/3/place"]);
  assert.deepEqual(errorsFor((d) => { d.slides[3].place.lat = 91; }), ["/slides/3/place/lat"]);
  assert.deepEqual(errorsFor((d) => { d.slides[1].date.sortYear = 1850.5; }), ["/slides/1/date/sortYear"]);
  assert.deepEqual(errorsFor((d) => { d.slides[1].place.overlays[0].corners.pop(); }), ["/slides/1/place/overlays/0/corners"]);
  assert.deepEqual(errorsFor((d) => { d.slides = []; }), ["/slides"]);
  assert.deepEqual(errorsFor((d) => { d.presentation.basemap = "satellite"; }), ["/presentation/basemap"]);
  assert.deepEqual(errorsFor((d) => { d.slides[0].id = "has space"; }), ["/slides/0/id"]);
});

test("validation: media src must stay inside the zip", () => {
  for (const src of ["/etc/passwd", "../outside.png", "media/../../x.png", "./media/x.png", "media\\x.png"]) {
    const errors = errorsFor((d) => { d.media.church.src = src; }, null);
    assert.ok(errors.includes("/media/church/src"), `${src} should be rejected`);
  }
});

test("validation: unused media is a warning, not an error", () => {
  const { doc, files } = loadExample("full");
  doc.slides[2].media = [];
  const result = validate(doc, files);
  assert.equal(result.valid, true);
  assert.deepEqual(result.warnings.map((w) => w.path), ["/media/church"]);
});

// --- reading zips -----------------------------------------------------------

test("a story inside one top-level folder opens (\"compress this folder\")", async () => {
  const { doc, files } = loadExample("no-map");
  const entries: Record<string, string | Uint8Array> = {
    "anna/story.json": JSON.stringify(doc),
    "__MACOSX/anna/._story.json": "junk",
  };
  for (const [path, data] of files) entries[`anna/${path}`] = data;
  const pkg = await readStoryZip(rawZip(entries));
  assert.equal(pkg.doc.title, "The Story of Anna Keller");
  assert.ok(pkg.files.has("media/m1.webp"));
});

test("reading: what isn't a story is refused with a specific code", async () => {
  await rejectsWith(readStoryZip(new TextEncoder().encode("not a zip")), "not-a-zip");
  await rejectsWith(readStoryZip(rawZip({ "readme.txt": "hi" })), "no-story-json");
  await rejectsWith(readStoryZip(rawZip({ "a/story.json": "{}", "b/story.json": "{}" })), "no-story-json");
  await rejectsWith(readStoryZip(rawZip({ "story.json": "{ nope" })), "bad-json");
  await rejectsWith(readStoryZip(rawZip({ "story.json": "{}" })), "not-a-story");
});

test("reading: limits apply before inflating", async () => {
  const { doc, files } = loadExample("full");
  const zipped = await writeStoryZip(doc, files);
  await rejectsWith(readStoryZip(zipped, { maxTotalBytes: 100 }), "too-large");
  await rejectsWith(readStoryZip(zipped, { maxFiles: 2 }), "too-large");
});

test("reading accepts Blob and ArrayBuffer as well as bytes", async () => {
  const zipped = await writeStoryZip(minimalDoc(), new Map());
  assert.equal((await readStoryZip(new Blob([zipped as Uint8Array<ArrayBuffer>]))).doc.title, "A Very Short Story");
  assert.equal((await readStoryZip(zipped.slice().buffer)).doc.title, "A Very Short Story");
});

// --- images -------------------------------------------------------------------

test("fitWithin scales the long edge down, never up", () => {
  assert.deepEqual(fitWithin(4000, 3000, 1600), { width: 1600, height: 1200 });
  assert.deepEqual(fitWithin(3000, 4000, 1600), { width: 1200, height: 1600 });
  assert.deepEqual(fitWithin(800, 600, 1600), { width: 800, height: 600 });
  assert.deepEqual(fitWithin(10000, 1, 1600), { width: 1600, height: 1 });
});

test("encodingCandidates keeps alpha where it matters", () => {
  assert.deepEqual(encodingCandidates("photo", false), ["image/webp", "image/jpeg"]);
  assert.deepEqual(encodingCandidates("photo", true), ["image/webp", "image/png"]);
  assert.deepEqual(encodingCandidates("overlay", true), ["image/png"]);
  assert.deepEqual(encodingCandidates("overlay", false), ["image/webp", "image/jpeg"]);
});
