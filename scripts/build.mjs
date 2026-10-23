// Builds what npm users get, into dist/:
//
//   index.js        the core (read/write/validate/optimize), ES module
//   player.js       the React player, ES module; its dependencies (react,
//                   maplibre, ...) stay imports for the user's bundler,
//                   including maplibre's stylesheet
//   editor.js       the React editor (Mantine), ES module, imports kept the
//                   same way
//   types/          TypeScript declarations for all three
//   embed.js        <gramps-connect-story>: everything bundled into one
//                   file for a plain <script type="module"> tag
//   maplibre-gl-worker.mjs, maplibre-gl-shared.mjs
//                   the map's worker, which embed.js loads from beside itself
//
// Gramps Connect doesn't use dist/: it compiles src/ directly (the
// "source" export condition).
import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const maplibreDist = join(dirname(createRequire(import.meta.url).resolve("maplibre-gl/package.json")), "dist");

rmSync(dist, { recursive: true, force: true });

// Everything a user installs alongside us stays an import.
const external = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
  "react/*", "react-dom/*", "maplibre-gl/*",
];
await build({
  absWorkingDir: root,
  entryPoints: { index: "src/index.ts", player: "src/player/index.ts", editor: "src/editor/index.ts" },
  outdir: dist,
  bundle: true,
  format: "esm",
  target: "es2020",
  jsx: "automatic",
  external,
  sourcemap: true,
  logLevel: "warning",
});

await build({
  absWorkingDir: root,
  entryPoints: { embed: "src/embed/index.tsx" },
  outdir: dist,
  bundle: true,
  format: "esm",
  target: "es2020",
  jsx: "automatic",
  minify: true,
  // No source map: it'd be most of the package's size (React and maplibre
  // are the bulk of embed.js), for a file people use, not debug.
  loader: { ".css": "text" },
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "linked",
  // The player's own side-effect import of maplibre's stylesheet is moot
  // here (embed.js puts the text into its shadow root instead).
  logOverride: { "ignored-bare-import": "silent" },
  logLevel: "warning",
});
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(join(maplibreDist, file), join(dist, file));
}

// Through TypeScript's own `tsc` bin entry: its package.json doesn't export
// the script's path as a module.
const tsPackage = createRequire(import.meta.url).resolve("typescript/package.json");
const tscBin = JSON.parse(readFileSync(tsPackage, "utf8")).bin.tsc;
execFileSync(process.execPath, [join(dirname(tsPackage), tscBin), "-p", join(root, "tsconfig.build.json")], { stdio: "inherit" });

console.log("built dist/");
