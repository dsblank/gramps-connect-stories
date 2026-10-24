// Builds the standalone viewer into site-dist/, for GitHub Pages:
//
//   index.html, app.js, app.css   the viewer (site/)
//   edit.html, editor.js, editor.css, chunks/
//                                 the editor (site/editor.tsx)
//   maplibre-gl-worker.mjs, maplibre-gl-shared.mjs
//   examples/*.story.zip          the example stories, zipped
//   demos/*.story.zip             the home page's demo stories, as they are
//   spec/1.0/story.schema.json    at the URL the schema's own $id names
//
// Needs `npm run build` first: the example zips are written with the
// built dist/index.js.
import { copyFileSync, cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { writeStoryZip } from "../dist/index.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = join(root, "site-dist");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const maplibreDist = join(dirname(createRequire(import.meta.url).resolve("maplibre-gl/package.json")), "dist");

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "examples"), { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: { app: "site/main.tsx" },
  outdir: out,
  bundle: true,
  format: "esm",
  target: "es2020",
  jsx: "automatic",
  minify: true,
  sourcemap: true,
  define: { "process.env.NODE_ENV": '"production"', __PACKAGE_VERSION__: JSON.stringify(pkg.version) },
  legalComments: "linked",
  logLevel: "warning",
});
// The editor: its own page and bundle, so the viewer doesn't carry Mantine.
// Split, so each date language (gramps-date) loads only when a story in it
// is edited. The "source" condition: gramps-date is compiled from its
// TypeScript, as in Gramps Connect, whether it's the workspace copy or npm's.
await build({
  absWorkingDir: root,
  entryPoints: { editor: "site/editor.tsx" },
  outdir: out,
  bundle: true,
  splitting: true,
  chunkNames: "chunks/[name]-[hash]",
  conditions: ["source"],
  format: "esm",
  target: "es2020",
  jsx: "automatic",
  minify: true,
  sourcemap: true,
  define: { "process.env.NODE_ENV": '"production"', __PACKAGE_VERSION__: JSON.stringify(pkg.version) },
  legalComments: "linked",
  logLevel: "warning",
});
copyFileSync(join(root, "site/index.html"), join(out, "index.html"));
copyFileSync(join(root, "site/editor.html"), join(out, "edit.html"));
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(join(maplibreDist, file), join(out, file));
}
cpSync(join(root, "spec"), join(out, "spec"), { recursive: true });
cpSync(join(root, "site/demos"), join(out, "demos"), { recursive: true });

for (const name of readdirSync(join(root, "examples"))) {
  const dir = join(root, "examples", name);
  if (!statSync(dir).isDirectory()) continue;
  const doc = JSON.parse(readFileSync(join(dir, "story.json"), "utf8"));
  const files = new Map(Object.values(doc.media).map((m) => [m.src, new Uint8Array(readFileSync(join(dir, m.src)))]));
  writeFileSync(join(out, "examples", `${name}.story.zip`), await writeStoryZip(doc, files));
}
// GitHub Pages: serve files as they are (no Jekyll processing).
writeFileSync(join(out, ".nojekyll"), "");

console.log("built site-dist/");
