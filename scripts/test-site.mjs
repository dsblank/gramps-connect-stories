// Runs the built viewer site (site-dist/, from build-site.mjs) in headless
// Chrome, served under /gramps-connect-stories/ the way GitHub Pages serves
// a project site -- so an absolute path anywhere would break here first.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("..", import.meta.url));
const siteDist = join(root, "site-dist");
const PREFIX = "/gramps-connect-stories/";
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".zip": "application/zip",
};

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://x");
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  // Landing page, then an example by its ?src= link.
  await page.goto(base);
  await page.getByRole("button", { name: "Open a story…" }).waitFor();
  await page.getByRole("link", { name: "The Story of Josef Meyer" }).click();
  await page.getByText("3 moments from Josef Meyer").waitFor();
  assert.match(page.url(), /\?src=examples\/full\.story\.zip$/);
  assert.equal(await page.title(), "The Story of Josef Meyer");
  await page.locator(".maplibregl-marker").waitFor({ timeout: 30_000 });

  // The slide is in the URL, and a reload comes back to it.
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => location.hash === "#s1");
  await page.reload();
  await page.getByText("Birth of Josef Meyer").waitFor();

  // Closing returns to the landing page with a clean URL.
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Open a story…" }).waitFor();
  assert.equal(new URL(page.url()).search + new URL(page.url()).hash, "");

  // Opening a file from the computer.
  const zip = readFileSync(join(siteDist, "examples", "no-map.story.zip"));
  await page.locator("input[type=file]").setInputFiles({ name: "anna.story.zip", mimeType: "application/zip", buffer: zip });
  await page.getByText("1 / 4").waitFor();
  await page.getByRole("button", { name: "Close" }).click();

  // Something that isn't a story says so.
  await page.locator("input[type=file]").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await page.getByRole("alert").getByText(/Not a readable zip file/).waitFor();

  // A ?src= that isn't there says so too.
  await page.goto(`${base}?src=examples/missing.story.zip`);
  await page.getByRole("alert").getByText(/Couldn't fetch examples\/missing\.story\.zip \(404\)/).waitFor();

  // The schema is served where its own $id says it lives (relative to the site).
  const schema = await (await page.request.get(`${base}spec/1.0/story.schema.json`)).json();
  assert.equal(schema.$id, "https://dsblank.github.io/gramps-connect-stories/spec/1.0/story.schema.json");

  assert.deepEqual(pageErrors, []);
  console.log("browser site tests passed");
} finally {
  await browser.close();
  server.close();
}
