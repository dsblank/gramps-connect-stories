// Runs the Story Editor page of the built site (site-dist/) in headless
// Chrome, served under /gramps-connect-stories/ as GitHub Pages serves it:
// opens a story carrying fields this version doesn't know, edits titles,
// dates (in two languages) and the slide order, undoes, reloads (the draft
// survives), saves (as a download: the File System Access pickers are
// taken away, since a headless browser can't answer them), and reads the
// saved file back. Then the viewer's Edit button and the editor's Close.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
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
  assert.deepEqual(Object.keys(saved.doc.media).sort(), Object.keys(doc.media).sort());
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

  assert.deepEqual(pageErrors, []);
  console.log("browser editor tests passed");
} finally {
  await browser.close();
  server.close();
}
