// Runs optimizeImage() (src/image.ts) in a real headless Chrome -- it needs
// createImageBitmap and OffscreenCanvas, which Node doesn't have -- and
// checks what comes out: scaled, rotated per EXIF, re-encoded, and with the
// original's EXIF (camera, GPS) gone. Uses the system Chrome
// (playwright-core's "chrome" channel), which GitHub's Ubuntu runners have.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixture = (name) => readFileSync(`${root}test-fixtures/${name}`).toString("base64");

const bundle = await build({
  entryPoints: [`${root}src/image.ts`],
  bundle: true,
  format: "iife",
  globalName: "StoryImage",
  write: false,
});

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const results = await page.evaluate(async ({ photo, overlay }) => {
    const toBlob = (b64, type) => new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type });
    const describe = async (r) => ({
      mime: r.mime, ext: r.ext, width: r.width, height: r.height, blobType: r.blob.type,
      bytes: Array.from(new Uint8Array(await r.blob.arrayBuffer())),
    });
    // A plain-<canvas> decode of the output, to check its pixels' alpha.
    const alphaRange = async (blob) => {
      const bmp = await createImageBitmap(blob);
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext("2d");
      ctx.drawImage(bmp, 0, 0);
      const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
      let min = 255, max = 0;
      for (let i = 3; i < d.length; i += 4) { min = Math.min(min, d[i]); max = Math.max(max, d[i]); }
      return [min, max];
    };
    const p = await StoryImage.optimizeImage(toBlob(photo, "image/jpeg"));
    const o = await StoryImage.optimizeImage(toBlob(overlay, "image/png"), { purpose: "overlay" });
    const small = await StoryImage.optimizeImage(toBlob(photo, "image/jpeg"), { maxEdge: 300 });
    return {
      photo: await describe(p),
      overlay: { ...(await describe(o)), alpha: await alphaRange(o.blob) },
      small: { width: small.width, height: small.height },
    };
  }, { photo: fixture("photo-exif-gps.jpg"), overlay: fixture("overlay-alpha.png") });

  const contains = (bytes, text) => Buffer.from(bytes).includes(Buffer.from(text, "latin1"));

  // 2400x1800 with EXIF orientation 6 (rotate 90 degrees): upright and
  // scaled to 1600 on the long edge.
  const { photo, overlay, small } = results;
  assert.equal(photo.mime, "image/webp");
  assert.equal(photo.blobType, "image/webp");
  assert.equal(photo.ext, "webp");
  assert.deepEqual([photo.width, photo.height], [1200, 1600]);
  assert.ok(!contains(photo.bytes, "Exif"), "photo output still has an EXIF block");
  assert.ok(!contains(photo.bytes, "SecretCam"), "photo output still names the camera");

  // 2500x1000 with transparency: kept as PNG, alpha intact.
  assert.equal(overlay.mime, "image/png");
  assert.deepEqual([overlay.width, overlay.height], [2048, 819]);
  assert.deepEqual(overlay.alpha, [0, 255]);

  assert.deepEqual([small.width, small.height], [225, 300]);

  console.log("browser image tests passed");
} finally {
  await browser.close();
}
