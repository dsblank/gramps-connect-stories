// Runs StoryPlayer in a real headless Chrome against the example stories,
// the way a standalone viewer would: each example is zipped
// (writeStoryZip), read back (readStoryZip), and presented with blob URLs
// for its media. Served over a throwaway local HTTP server, since maplibre's
// worker can't load from file:// URLs. Checks what's on screen and that
// nothing throws; basemap tiles come from the network and aren't checked.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("..", import.meta.url));
const maplibreDist = join(dirname(createRequire(import.meta.url).resolve("maplibre-gl/package.json")), "dist");

const harness = `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import * as maplibregl from "maplibre-gl";
import { mediaBlob, readStoryZip, writeStoryZip } from "./src/index.ts";
import { StoryPlayer } from "./src/player/index.ts";

maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");
let reactRoot = null;
window.mountExample = async (name, props = {}) => {
  const doc = await (await fetch("/examples/" + name + "/story.json")).json();
  const files = new Map();
  for (const item of Object.values(doc.media)) {
    files.set(item.src, new Uint8Array(await (await fetch("/examples/" + name + "/" + item.src)).arrayBuffer()));
  }
  const story = await readStoryZip(await writeStoryZip(doc, files));
  window.mediaCalls = [];
  const urls = new Map();
  const resolveMedia = async (key) => {
    window.mediaCalls.push(key);
    if (!urls.has(key)) urls.set(key, URL.createObjectURL(mediaBlob(story, key)));
    return urls.get(key);
  };
  reactRoot?.unmount();
  reactRoot = createRoot(document.getElementById("root"));
  reactRoot.render(createElement(StoryPlayer, { story: story.doc, resolveMedia, onClose: () => { window.closeCalls = (window.closeCalls ?? 0) + 1; }, ...props }));
};
`;

const bundle = await build({
  stdin: { contents: harness, resolveDir: root, loader: "js" },
  bundle: true,
  format: "esm",
  jsx: "automatic",
  write: false,
  logLevel: "warning",
});

const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".webp": "image/webp", ".png": "image/png" };
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  let body;
  let type = "text/html";
  if (url.pathname === "/") {
    body = `<!doctype html><html><body style="margin:0"><div id="root" style="width:1280px;height:800px;position:relative"></div><script type="module" src="/bundle.js"></script></body></html>`;
  } else if (url.pathname === "/bundle.js") {
    body = bundle.outputFiles[0].text;
    type = TYPES[".js"];
  } else if (/^\/maplibre-gl-(worker|shared)\.mjs$/.test(url.pathname)) {
    body = readFileSync(join(maplibreDist, url.pathname.slice(1)));
    type = TYPES[".mjs"];
  } else if (url.pathname.startsWith("/examples/")) {
    const path = normalize(join(root, url.pathname));
    if (!path.startsWith(join(root, "examples"))) { res.writeHead(403).end(); return; }
    try { body = readFileSync(path); } catch { res.writeHead(404).end(); return; }
    type = TYPES[extname(path)] ?? "application/octet-stream";
  } else {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "Content-Type": type }).end(body);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const pageErrors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  if (process.env.DEBUG_PLAYER) page.on("console", (m) => console.log("console:", m.type(), m.text().slice(0, 300)));
  if (process.env.DEBUG_PLAYER) page.on("requestfailed", (r) => console.log("failed:", r.url().slice(0, 120), r.failure()?.errorText));
  await page.goto(base);
  await page.waitForFunction(() => typeof window.mountExample === "function");
  const text = (selector) => page.$eval(selector, (el) => el.textContent);
  const bodyText = () => page.evaluate(() => document.getElementById("root").innerText);

  // --- a located story: map, overlay, timeline ---------------------------
  await page.evaluate(() => window.mountExample("full"));
  await page.waitForFunction(() => document.querySelector(".maplibregl-canvas"));
  assert.match(await bodyText(), /The Story of Josef Meyer/);
  assert.match(await bodyText(), /3 moments from Josef Meyer/);
  // The opening photo arrives through resolveMedia and actually decodes.
  await page.waitForFunction(() => [...document.images].some((img) => img.complete && img.naturalWidth > 0));
  assert.equal(await page.$eval("img", (img) => img.alt), "Portrait of Josef Meyer");
  // Three dated slides; the opening card isn't one, so all three are dots.
  const timeline = (what) => page.$$eval(`svg:has(line) ${what}`, (els) => els.length);
  assert.equal(await timeline("circle"), 3);
  assert.equal(await timeline("path"), 0);

  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => document.getElementById("root").innerText.includes("Birth of Josef Meyer"));
  assert.match(await bodyText(), /about 1850 · Zürich, Switzerland/);
  // Now on a dated slide: it's the pin, the other two are dots.
  assert.equal(await timeline("circle"), 2);
  assert.equal(await timeline("path"), 1);
  // Markup is rendered as elements, not HTML.
  assert.deepEqual(await page.$$eval("p i, p b", (els) => els.map((e) => `${e.tagName}:${e.textContent}`)), ["I:about", "B:Zürich"]);
  // The overlay's image is asked for, and the pin is on the map.
  await page.waitForFunction(() => window.mediaCalls.includes("map-1850"));
  // The marker appears once the map has loaded, which waits on basemap tiles.
  await page.waitForSelector(".maplibregl-marker", { timeout: 30_000 });

  // Auto map mode follows the slide's year.
  await page.getByRole("radio", { name: "Auto" }).click();
  await page.waitForFunction(() => document.getElementById("root").innerText.includes("Historical map, 1850"));
  // Typing a year doesn't change slides.
  await page.getByRole("radio", { name: "Historical" }).click();
  await page.getByRole("spinbutton").focus();
  await page.keyboard.press("ArrowRight");
  assert.match(await bodyText(), /Birth of Josef Meyer/);

  await page.getByRole("button", { name: "Next" }).click();
  await page.waitForFunction(() => document.getElementById("root").innerText.includes("Baptism"));
  assert.match(await bodyText(), /The Grossmünster · © Example Archive/);
  await page.getByRole("button", { name: "Close" }).click();
  assert.equal(await page.evaluate(() => window.closeCalls), 1);

  // --- an unlocated story: card layout, paragraphs ------------------------
  await page.evaluate(() => window.mountExample("no-map"));
  await page.waitForFunction(() => document.getElementById("root").innerText.includes("1 / 4"));
  assert.equal(await page.$(".maplibregl-canvas"), null);
  // No map, so no map-mode control.
  assert.equal(await page.getByRole("radio", { name: "Auto" }).count(), 0);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => document.getElementById("root").innerText.includes("3 / 4"));
  // "...Paul Brunner**.\nThe wedding was small.\n\nThey had four children."
  assert.equal(await page.$$eval("p", (els) => els.length), 2);
  assert.equal(await page.$$eval("p br", (els) => els.length), 1);
  assert.match(await text("figcaption"), /Wedding portrait/);
  await page.getByRole("button", { name: "Next" }).click();
  await page.waitForFunction(() => document.getElementById("root").innerText.includes("4 / 4"));
  assert.equal(await page.getByRole("button", { name: "Next" }).isDisabled(), true);

  // --- right to left: the text, not the layout -----------------------------
  await page.evaluate(() => window.mountExample("rtl"));
  await page.waitForFunction(() => document.getElementById("root").innerText.includes("סיפורה של רבקה כהן"));
  assert.equal(await page.$eval("[lang]", (el) => el.getAttribute("lang")), "he");

  // --- the minimal story ------------------------------------------------------
  await page.evaluate(() => window.mountExample("minimal"));
  await page.waitForFunction(() => document.getElementById("root").innerText.includes("1 / 1"));

  assert.deepEqual(pageErrors, []);
  console.log("browser player tests passed");
} finally {
  await browser.close();
  server.close();
}
