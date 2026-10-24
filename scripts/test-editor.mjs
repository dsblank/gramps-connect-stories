// Runs the Story Editor page of the built site (site-dist/) in headless
// Chrome, served under /gramps-connect-stories/ as GitHub Pages serves it:
// opens a story carrying fields this version doesn't know, edits titles,
// dates (in two languages), photos, places and the slide order, undoes,
// reloads (the draft survives), saves (as a download: the File System Access pickers are
// taken away, since a headless browser can't answer them), and reads the
// saved file back. Then the viewer's Edit button and the editor's Close.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { deflateSync } from "node:zlib";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { readStoryZip, writeStoryZip } from "../dist/index.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const siteDist = join(root, "site-dist");
const PREFIX = "/gramps-connect-stories/";
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".zip": "application/zip",
};

// The full example, plus things a newer program might have written.
const exampleDir = join(root, "examples", "full");
const doc = JSON.parse(readFileSync(join(exampleDir, "story.json"), "utf8"));
doc["x-future"] = { kept: true };
doc.slides[1]["x-note"] = "kept";
doc.extensions = { "org.example": { reviewed: "2026-10-01" } };
const files = new Map(Object.values(doc.media).map((m) => [m.src, new Uint8Array(readFileSync(join(exampleDir, m.src)))]));
const fixture = await writeStoryZip(doc, files);

/** A plain PNG of one colour: a photo no story has yet. */
function solidPng(width, height, [r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [r, g, b]).flat())]);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0)),
  ]);
}
const photoDir = mkdtempSync(join(tmpdir(), "story-editor-photos-"));
const harbour = join(photoDir, "harbour.png");
const ship = join(photoDir, "ship.png");
writeFileSync(harbour, solidPng(120, 80, [40, 90, 160]));
writeFileSync(ship, solidPng(60, 90, [160, 90, 40]));
const oldMap = join(photoDir, "old-map.png");
writeFileSync(oldMap, solidPng(100, 80, [200, 180, 140]));
const procession = join(photoDir, "procession.geojson");
writeFileSync(procession, JSON.stringify({
  type: "Feature", properties: { name: "Procession", stroke: "#aa0000" },
  geometry: { type: "LineString", coordinates: [[8.5440, 47.3700], [8.5410, 47.3715]] },
}));

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://x");
  if (pathname === `${PREFIX}test/extra.story.zip`) { res.writeHead(200, { "Content-Type": "application/zip" }).end(fixture); return; }
  if (!pathname.startsWith(PREFIX)) { res.writeHead(404).end(); return; }
  let path = normalize(join(siteDist, pathname.slice(PREFIX.length)));
  if (!path.startsWith(siteDist)) { res.writeHead(403).end(); return; }
  if (pathname.endsWith("/")) path = join(path, "index.html");
  let body;
  try {
    body = readFileSync(path);
  } catch {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" }).end(body);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}${PREFIX}`;

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const pageErrors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, locale: "en-US" });
  await context.addInitScript(() => { delete window.showOpenFilePicker; delete window.showSaveFilePicker; });
  const page = await context.newPage();
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  const slides = () => page.getByRole("option").allInnerTexts();
  const field = (label) => page.getByRole("textbox", { name: label, exact: true });
  const precise = (value) => page.waitForFunction(
    (want) => [...document.querySelectorAll("input")].some((el) => el.labels?.[0]?.textContent === "Precise date (EDTF)" && el.value === want),
    value,
  );

  await page.goto(`${base}edit.html?src=test/extra.story.zip`);
  await page.getByText("Title, language and map").waitFor();
  assert.equal(new URL(page.url()).search, "");
  assert.equal(await page.title(), "The Story of Josef Meyer – Story Editor");

  // A slide's title and date; the precise date follows the text.
  await page.getByRole("option").nth(1).click();
  await field("Title").fill("Born in Zürich");
  await field("Date").fill("about 3 May 1850");
  await precise("1850-05-03~");
  // The preview shows it.
  await page.getByText("Born in Zürich", { exact: true }).nth(1).waitFor();

  // A German story reads German dates.
  await page.getByText("Title, language and map").click();
  await page.getByRole("textbox", { name: "Language" }).fill("de");
  await page.getByRole("option").nth(1).click();
  await field("Date").fill("um 1850");
  // The English date read in German isn't what was stored, so the stored
  // precise date counts as set by hand and stays -- until asked.
  await page.getByRole("button", { name: "Work it out from the date" }).click();
  await precise("1850~");

  // Reorder: Baptism up above the birth.
  await page.getByRole("option").nth(2).click();
  await page.getByRole("button", { name: "Move up" }).click();
  assert.match((await slides())[1], /Baptism/);

  // Add a slide, then undo it.
  await page.getByRole("button", { name: "Add slide" }).click();
  assert.equal((await slides()).length, 5);
  await page.getByRole("button", { name: "Undo" }).click();
  assert.equal((await slides()).length, 4);

  // Photos: two added to the emigration slide (prepared in the browser),
  // the first again (stored once, so the same media), then taken off.
  await page.getByRole("option", { name: /Emigration/ }).click();
  const photoInput = page.locator('input[type=file][accept="image/*"]');
  await photoInput.setInputFiles(harbour);
  await page.getByRole("textbox", { name: "Caption" }).first().waitFor();
  await page.getByRole("textbox", { name: "Caption" }).first().fill("The harbour");
  await page.getByRole("textbox", { name: "Description" }).first().fill("Le Havre harbour");
  await photoInput.setInputFiles(ship);
  await photoInput.setInputFiles(harbour);
  await page.getByRole("textbox", { name: "Caption" }).nth(2).waitFor();
  await page.getByRole("button", { name: "Remove", exact: true }).nth(2).click();
  assert.equal(await page.getByRole("textbox", { name: "Caption" }).count(), 2);
  // The slide list shows the first photo; the preview offers both.
  await page.getByRole("option", { name: /Emigration/ }).locator("img").waitFor();
  // (In German: the story's language is German by now.)
  await page.getByRole("button", { name: "Foto 2 von 2" }).click();
  // Pasting an image (outside a text field) adds it too; undo takes it off.
  const pngBase64 = readFileSync(harbour).toString("base64");
  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], "pasted.png", { type: "image/png" }));
    document.body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
  }, pngBase64);
  await page.getByRole("textbox", { name: "Caption" }).nth(2).waitFor();
  await page.getByRole("button", { name: "Undo" }).click();
  assert.equal(await page.getByRole("textbox", { name: "Caption" }).count(), 2);

  // The story's own portrait file, chosen again: the same media, not a copy.
  await photoInput.setInputFiles(join(exampleDir, "media", "portrait.webp"));
  await page.getByRole("textbox", { name: "Caption" }).nth(2).waitFor();

  // The baptism's photo comes off: its file isn't saved.
  await page.getByRole("option", { name: /Baptism/ }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  assert.equal(await page.getByRole("textbox", { name: "Caption" }).count(), 0);

  // Places. The baptism's has a shape and no point: typing one keeps the
  // shape; nonsense is pointed out.
  const coordinates = page.getByRole("textbox", { name: "Latitude, longitude" });
  await page.getByText("This place also has a shape.").waitFor();
  await coordinates.fill("north");
  await page.getByText(/^Two numbers: latitude/).waitFor();
  await coordinates.fill("47.37, 8.544");
  assert.equal(await page.getByText(/^Two numbers: latitude/).count(), 0);

  // The opening slide takes the birth's place, overlays and all.
  await page.getByRole("option").first().click();
  await field("Name").fill("Zür");
  await page.getByRole("option", { name: "Zürich, Switzerland", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("input[placeholder='e.g. 47.3769, 8.5417']")?.value === "47.3769, 8.5417");
  await page.getByText("This place also has a map overlay.").waitFor();

  // Emigration: its place removed, then found on Wikidata (answered here,
  // not by Wikidata), then moved by a click on the map, which undo takes back.
  await page.route("https://www.wikidata.org/**", (route) => {
    const url = new URL(route.request().url());
    const body = url.pathname.endsWith("api.php")
      ? { search: [{ id: "Q1", label: "Bremerhaven", description: "port city in Germany" }] }
      : { entities: { Q1: { claims: { P625: [{ mainsnak: { datavalue: { value: { latitude: 53.55, longitude: 8.58 } } } }] } } } };
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.getByRole("option", { name: /Emigration/ }).click();
  await page.getByRole("button", { name: "Remove place" }).click();
  await page.waitForFunction(() => document.querySelector("input[placeholder='e.g. 47.3769, 8.5417']")?.value === "");
  await field("Name").fill("Bremerhaven");
  await page.getByRole("button", { name: "Find on Wikidata" }).click();
  await page.getByRole("listitem").filter({ hasText: "port city in Germany" }).click();
  await page.waitForFunction(() => document.querySelector("input[placeholder='e.g. 47.3769, 8.5417']")?.value === "53.55, 8.58");
  await page.waitForTimeout(1600); // past undo's coalescing, so the click is a step of its own
  await page.getByRole("application", { name: "Map: click to put the pin" }).click({ position: { x: 60, y: 60 } });
  await page.waitForFunction(() => document.querySelector("input[placeholder='e.g. 47.3769, 8.5417']")?.value !== "53.55, 8.58");
  await page.getByRole("button", { name: "Undo" }).click();
  await page.waitForFunction(() => document.querySelector("input[placeholder='e.g. 47.3769, 8.5417']")?.value === "53.55, 8.58");

  // The baptism's map: a route imported from a file and an old map's scan
  // laid over it, with its years. Cancel first leaves everything as it was.
  await page.getByRole("option", { name: /Baptism/ }).click();
  await page.getByRole("button", { name: "Edit map" }).click();
  await page.getByText("Map: Grossmünster, Zürich").waitFor();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByText("Map: Grossmünster, Zürich").waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Edit map" }).click();
  await page.getByRole("button", { name: "Polygon" }).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll("button")].find((b) => b.textContent === "Polygon" && !b.disabled));
  await page.locator('input[type=file][accept^=".kml"]').setInputFiles(procession);
  await page.locator('input[type=file][accept="image/*"]').last().setInputFiles(oldMap);
  const years = page.getByRole("textbox", { name: "Years it shows" });
  await years.fill("1850");
  await page.getByText("EDTF 1850").waitFor();
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByText("This place also has a shape, a map overlay.").waitFor();

  // An empty story title is a problem, and Save waits for it.
  await page.getByText("Title, language and map").click();
  await page.getByRole("textbox", { name: "Title" }).fill("");
  await page.getByText(/1 problem to fix before saving/).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll("button")].find((b) => b.textContent === "Save")?.disabled);
  await page.getByRole("textbox", { name: "Title" }).fill("Josef's Story");
  await page.getByText("Unsaved changes").waitFor();

  // A reload keeps the work (the draft), after the draft's short delay.
  await page.waitForTimeout(800);
  await page.reload();
  await page.getByText("Unsaved changes").waitFor();
  assert.match((await slides())[2], /Born in Zürich/);

  // Save: a download, read back.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Save", exact: true }).click(),
  ]);
  assert.equal(download.suggestedFilename(), "extra.story.zip");
  const saved = await readStoryZip(readFileSync(await download.path()));
  assert.equal(saved.doc.title, "Josef's Story");
  assert.equal(saved.doc.language, "de");
  assert.deepEqual(saved.doc.slides.map((s) => s.id), ["s0", "s2", "s1", "s3"]);
  const born = saved.doc.slides[2];
  assert.equal(born.title, "Born in Zürich");
  assert.deepEqual(born.date, { text: "um 1850", edtf: "1850~" });
  // What this version doesn't know came through untouched.
  assert.equal(born["x-note"], "kept");
  assert.deepEqual(saved.doc["x-future"], { kept: true });
  assert.deepEqual(saved.doc.extensions, { "org.example": { reviewed: "2026-10-01" } });
  // Photos: the new ones prepared as WebP, the unused church left out.
  const emigration = saved.doc.slides[3];
  assert.deepEqual(emigration.media, [{ ref: "photo-1", caption: "The harbour" }, { ref: "photo-2" }, { ref: "portrait" }]);
  assert.deepEqual(Object.keys(saved.doc.media).sort(), ["map-1", "map-1850", "photo-1", "photo-2", "portrait"]);
  assert.equal(saved.doc.media["photo-1"].mime, "image/webp");
  assert.equal(saved.doc.media["photo-1"].alt, "Le Havre harbour");
  assert.equal(saved.doc.media["photo-1"].width, 120);
  assert.ok(saved.files.has("media/photo-1.webp") && saved.files.has("media/photo-2.webp"));
  assert.ok(!saved.files.has("media/church.webp"));
  assert.equal(saved.doc.slides[1].media, undefined);
  // Places: a point added beside a shape, a place reused, one found.
  assert.equal(saved.doc.slides[1].place.lat, 47.37);
  assert.equal(saved.doc.slides[1].place.lon, 8.544);
  // The baptism's map: its shape, the imported route, and the scan.
  const baptismMap = saved.doc.slides[1].place;
  assert.equal(baptismMap.geometry.type, "FeatureCollection");
  assert.deepEqual(baptismMap.geometry.features.map((f) => [f.geometry.type, f.properties.name]), [["Polygon", "Grossmünster"], ["LineString", "Procession"]]);
  // A shape keeps the color it came with (the route's file stroke), and
  // one without a color or opacity is saved without one.
  assert.deepEqual(baptismMap.geometry.features.map((f) => [f.properties.color, f.properties.opacity]), [[undefined, undefined], ["#aa0000", undefined]]);
  assert.equal(baptismMap.overlays.length, 1);
  assert.deepEqual(Object.keys(baptismMap.overlays[0]).sort(), ["corners", "date", "media", "order"]);
  assert.deepEqual(baptismMap.overlays[0].date, { text: "1850", edtf: "1850" });
  assert.equal(baptismMap.overlays[0].corners.length, 4);
  const scan = saved.doc.media[baptismMap.overlays[0].media];
  assert.ok(scan && saved.files.has(scan.src), "the scan is saved");
  assert.deepEqual(saved.doc.slides[0].place, doc.slides[1].place);
  assert.deepEqual(emigration.place, { name: "Bremerhaven", lat: 53.55, lon: 8.58 });
  await page.getByText(/Downloaded extra\.story\.zip/).waitFor();
  assert.equal(await page.getByText("Unsaved changes").count(), 0);

  // The viewer offers the draft back, and its Edit opens a story here.
  await page.goto(base);
  await page.getByRole("link", { name: "Josef's Story" }).waitFor();
  await page.goto(`${base}?src=examples/no-map.story.zip`);
  await page.getByRole("button", { name: "Edit" }).click();
  await page.waitForURL(/edit\.html$/);
  await page.getByText("Title, language and map").waitFor();
  assert.equal(await page.title(), "The Story of Anna Keller – Story Editor");

  // Close: back to the viewer, nothing left to continue.
  await page.getByRole("button", { name: "Close" }).click();
  await page.waitForURL((url) => url.pathname === PREFIX);
  await page.getByRole("link", { name: "make a new story" }).waitFor();

  // A new story from there.
  await page.getByRole("link", { name: "make a new story" }).click();
  await page.getByText("Untitled story").first().waitFor();
  assert.equal((await slides()).length, 1);

  // In a German browser: the page, the editor and its map editor in German.
  const german = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "de-DE" });
  const dePage = await german.newPage();
  dePage.on("pageerror", (err) => pageErrors.push(err.message));
  await dePage.goto(`${base}edit.html`);
  await dePage.getByRole("button", { name: "Neue Geschichte" }).click();
  await dePage.getByRole("button", { name: "+ Folie hinzufügen" }).waitFor();
  assert.equal(await dePage.evaluate(() => document.documentElement.lang), "de");
  assert.equal(await dePage.title(), "Geschichte ohne Titel – Geschichten-Editor");
  await dePage.getByRole("button", { name: "Speichern", exact: true }).waitFor();
  await dePage.getByText("Titel, Sprache und Karte").click();
  await dePage.getByText("Wie die Karte beim Abspielen der Geschichte beginnt. Leser können sie trotzdem ändern.").waitFor();
  await german.close();

  assert.deepEqual(pageErrors, []);
  console.log("browser editor tests passed");
} finally {
  await browser.close();
  server.close();
  rmSync(photoDir, { recursive: true, force: true });
}
