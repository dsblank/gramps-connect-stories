// What `npm publish` would ship, checked the way a user meets it: packs
// the tarball, checks its file list, installs it into an empty project,
// then round-trips a story through the installed core under plain Node,
// and bundles and typechecks a consumer importing every entry point --
// which is what proves the "exports" map and the types resolve.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

const work = mkdtempSync(join(tmpdir(), "story-pack-"));
try {
  // Build as `prepack` would, then pack without scripts so the build's own
  // output doesn't land in pack's JSON.
  run(process.execPath, [join(root, "scripts/build.mjs")], root);
  // npm 10 prints an array of packages; npm 12 an object keyed by name.
  const output = JSON.parse(run(npm, ["pack", "--json", "--ignore-scripts", "--pack-destination", work], root));
  const [packed] = Array.isArray(output) ? output : Object.values(output);
  const files = packed.files.map((f) => f.path).sort();
  for (const required of [
    "LICENSE", "README.md", "package.json",
    "dist/index.js", "dist/player.js", "dist/editor.js", "dist/embed.js",
    "dist/maplibre-gl-worker.mjs", "dist/maplibre-gl-shared.mjs",
    "dist/types/index.d.ts", "dist/types/player/index.d.ts", "dist/types/editor/index.d.ts",
    "spec/1.0/story.schema.json", "spec/1.0/README.md",
    "src/index.ts", "src/player/index.ts", "src/editor/index.ts",
  ]) {
    assert.ok(files.includes(required), `${required} is missing from the package`);
  }
  for (const file of files) {
    assert.ok(!/^(src\/__tests__|examples|site|scripts|test-fixtures|\.github)\//.test(file), `${file} shouldn't be in the package`);
  }
  console.log(`package: ${files.length} files, ${(packed.size / 1024).toFixed(0)} KiB packed`);

  // An empty project that installs the tarball and its peers.
  const project = join(work, "consumer");
  run("mkdir", ["-p", project], work);
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "consumer", private: true, type: "module" }));
  // Each at the range we declare (the newest Mantine may be past ours).
  const peers = Object.entries(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).peerDependencies)
    .map(([name, range]) => `${name}@${range}`);
  run(npm, ["install", "--no-audit", "--no-fund", join(work, packed.filename), ...peers, "@types/react", "@types/geojson"], project);

  // The core under plain Node: write a story, read it back.
  writeFileSync(join(project, "roundtrip.mjs"), `
    import { readStoryZip, writeStoryZip, FORMAT_VERSION } from "@gramps-connect/story";
    const zip = await writeStoryZip({ title: "T", slides: [{ id: "s0", title: "T" }], media: {} }, new Map());
    const story = await readStoryZip(zip);
    if (story.doc.version !== FORMAT_VERSION) throw new Error("round trip failed");
    console.log("core works under Node");
  `);
  console.log(run(process.execPath, ["roundtrip.mjs"], project).trim());

  // A consumer bundling every entry point, and typechecking against the
  // shipped declarations -- without the "source" condition, as a user would.
  writeFileSync(join(project, "app.tsx"), `
    import * as maplibregl from "maplibre-gl";
    import { readStoryZip, mediaBlob, type StoryDoc } from "@gramps-connect/story";
    import { StoryPlayer, stringsFor } from "@gramps-connect/story/player";
    import { StoryEditor, suggestEdtf } from "@gramps-connect/story/editor";
    import "@gramps-connect/story/embed";
    import schema from "@gramps-connect/story/schema/1.0" with { type: "json" };
    maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");
    export async function show(file: Blob) {
      const story = await readStoryZip(file);
      const doc: StoryDoc = story.doc;
      return <StoryPlayer story={doc} resolveMedia={async (key) => URL.createObjectURL(mediaBlob(story, key)!)} strings={stringsFor("de")} />;
    }
    export const schemaId: string = schema.$id;
    export function edit(doc: StoryDoc) {
      return <StoryEditor initialStory={doc} resolveMedia={async () => null} parseDateText={suggestEdtf} />;
    }
  `);
  writeFileSync(join(project, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2020", module: "ESNext", moduleResolution: "bundler", jsx: "react-jsx", strict: true,
      noEmit: true, skipLibCheck: false, resolveJsonModule: true, lib: ["ES2020", "DOM"],
      // TypeScript 6+ loads no @types packages unless listed, and
      // maplibre's own declarations use the global GeoJSON namespace.
      types: ["geojson"],
    },
    files: ["app.tsx"],
  }));
  const esbuild = createRequire(import.meta.url).resolve("esbuild");
  const { build } = await import(esbuild);
  await build({
    absWorkingDir: project, entryPoints: ["app.tsx"], bundle: true, format: "esm", jsx: "automatic",
    outdir: join(project, "out"), logLevel: "error",
  });
  console.log("every entry point bundles");
  const tsPackage = createRequire(import.meta.url).resolve("typescript/package.json");
  const tsc = join(dirname(tsPackage), JSON.parse(readFileSync(tsPackage, "utf8")).bin.tsc);
  run(process.execPath, [tsc, "-p", project], project);
  console.log("types resolve");
  console.log("package tests passed");
} finally {
  rmSync(work, { recursive: true, force: true });
}
