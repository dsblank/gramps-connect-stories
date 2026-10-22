// Runs dist/embed.js the way a blog would use it: a page on one origin
// loading the script and a story from another (a CDN), in headless
// Chrome. Needs `npm run build` first. The example zips are written with
// the built dist/index.js under plain Node, which checks that build too.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { writeStoryZip } from "../dist/index.js";

const root = fileURLToPath(new URL("..", import.meta.url));

async function exampleZip(name) {
  const dir = join(root, "examples", name);
  const doc = JSON.parse(readFileSync(join(dir, "story.json"), "utf8"));
  const files = new Map(Object.values(doc.media).map((m) => [m.src, new Uint8Array(readFileSync(join(dir, m.src)))]));
  return Buffer.from(await writeStoryZip(doc, files));
}
const zips = { "full.story.zip": await exampleZip("full"), "no-map.story.zip": await exampleZip("no-map") };

function listen(handler) {
  const server = createServer(handler);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// The "CDN": dist/ and the stories, with CORS, as jsDelivr/unpkg send it.
const cdn = await listen((req, res) => {
  const name = new URL(req.url, "http://x").pathname.slice(1);
  let body;
  if (zips[name]) body = zips[name];
  else if (/^[\w.-]+\.(m?js)$/.test(name)) {
    try { body = readFileSync(join(root, "dist", name)); } catch { /* 404 below */ }
  }
  if (!body) { res.writeHead(404, { "Access-Control-Allow-Origin": "*" }).end(); return; }
  const type = extname(name) === ".zip" ? "application/zip" : "text/javascript";
  res.writeHead(200, { "Content-Type": type, "Access-Control-Allow-Origin": "*" }).end(body);
});
const cdnBase = `http://127.0.0.1:${cdn.address().port}`;

// The blog: a different origin (another port) from the CDN.
const page = `<!doctype html><html><body style="margin:0">
<h1>My family blog</h1>
<gramps-connect-story id="a" src="${cdnBase}/full.story.zip" style="height:600px;width:1100px"></gramps-connect-story>
<gramps-connect-story id="b" src="${cdnBase}/no-map.story.zip" slide="s2" theme="dark" style="height:400px;width:800px"></gramps-connect-story>
<gramps-connect-story id="c" src="${cdnBase}/missing.story.zip"></gramps-connect-story>
<script type="module" src="${cdnBase}/embed.js"></script>
</body></html>`;
const blog = await listen((req, res) => res.writeHead(200, { "Content-Type": "text/html" }).end(page));
const blogBase = `http://127.0.0.1:${blog.address().port}`;

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const pageErrors = [];
const workerErrors = [];
try {
  const tab = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
  tab.on("pageerror", (err) => pageErrors.push(String(err)));
  tab.on("console", (m) => { if (m.type() === "error" && /worker/i.test(m.text())) workerErrors.push(m.text()); });
  await tab.goto(blogBase);

  // Playwright's CSS locators reach into open shadow roots.
  const a = tab.locator("#a");
  const b = tab.locator("#b");
  // The host element's innerText doesn't include its shadow root; the
  // player's root (the element with lang) is inside it.
  const shown = (el) => el.locator("[lang]").first().innerText();
  await a.getByText("3 moments from Josef Meyer").waitFor();
  // The map runs, which needs maplibre's worker -- started cross-origin
  // through the blob: shim -- and its stylesheet inside the shadow root.
  await a.locator(".maplibregl-canvas").waitFor();
  await a.locator(".maplibregl-marker").waitFor({ timeout: 30_000 });
  assert.equal(await a.locator(".maplibregl-marker").evaluate((el) => getComputedStyle(el).position), "absolute");
  // The page's own styles don't reach in, and the player's don't leak out.
  assert.equal(await tab.locator("h1").evaluate((el) => getComputedStyle(el).fontFamily.includes("system-ui")), false);

  // `slide` and `theme` attributes.
  await b.getByText("Marriage").waitFor();
  assert.match(await shown(b), /3 \/ 4/);
  const bg = await b.locator("[lang]").first().evaluate((el) => getComputedStyle(el).backgroundColor);
  assert.equal(bg, "rgb(36, 36, 36)");

  // Arrow keys belong to whichever story has focus, not to the page.
  await tab.keyboard.press("ArrowRight");
  assert.match(await shown(b), /3 \/ 4/);
  await b.locator("[lang]").first().focus();
  await tab.keyboard.press("ArrowRight");
  await b.getByText("4 / 4").waitFor();
  assert.match(await shown(a), /3 moments from Josef Meyer/);

  // Changing src loads the other story -- on the same slide="s2".
  await tab.evaluate(() => document.getElementById("b").setAttribute("src", document.getElementById("a").getAttribute("src")));
  await b.getByText("Baptism of Josef Meyer").waitFor();

  // A story that isn't there says so instead of breaking the page.
  await tab.locator("#c").getByText(/couldn't be opened/).waitFor();

  assert.deepEqual(pageErrors, []);
  assert.deepEqual(workerErrors, []);
  console.log("browser embed tests passed");
} finally {
  await browser.close();
  cdn.close();
  blog.close();
}
