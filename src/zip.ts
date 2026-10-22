// Reading and writing the .story.zip container (spec/1.0/README.md
// sections 1 and 5). A zip handed to readStoryZip() may come from anyone,
// so reading caps how much it will inflate before looking at any of it.
import { unzip, zip, type AsyncZippable, type UnzipFileInfo } from "fflate";
import { FORMAT_ID, FORMAT_VERSION, StoryFormatError, upgradeStory } from "./version";
import { validate, type StoryIssue } from "./validate";
import type { MediaItem, StoryDoc } from "./types";

export interface StoryPackage {
  doc: StoryDoc;
  /** Every file under the story root, keyed by its path relative to that
   * root -- the same paths media `src` values use. */
  files: Map<string, Uint8Array>;
  warnings: StoryIssue[];
}

export interface ReadLimits {
  /** Total uncompressed bytes. Default 512 MiB. */
  maxTotalBytes?: number;
  /** Number of entries. Default 10,000. */
  maxFiles?: number;
}

const STORY_JSON = "story.json";

type Input = Blob | ArrayBuffer | Uint8Array;

async function toBytes(input: Input): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  return new Uint8Array(await input.arrayBuffer());
}

function isIgnoredEntry(name: string): boolean {
  return name.endsWith("/") || name.startsWith("__MACOSX/");
}

/** Opens a .story.zip: finds story.json (at the root, or inside a single
 * top-level folder), upgrades it to the current major version, and
 * validates it against the files actually present. Throws
 * StoryFormatError for anything that isn't a valid story; non-fatal
 * findings come back as `warnings`. */
export async function readStoryZip(input: Input, limits: ReadLimits = {}): Promise<StoryPackage> {
  const maxTotal = limits.maxTotalBytes ?? 512 * 1024 * 1024;
  const maxFiles = limits.maxFiles ?? 10_000;
  const bytes = await toBytes(input);

  let total = 0;
  let count = 0;
  let overLimit = false;
  const entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(bytes, {
      // Runs on the central directory's declared sizes, before inflating.
      filter(file: UnzipFileInfo) {
        if (isIgnoredEntry(file.name)) return false;
        count += 1;
        total += file.originalSize;
        if (count > maxFiles || total > maxTotal) overLimit = true;
        return !overLimit;
      },
    }, (err, data) => (err ? reject(err) : resolve(data)));
  }).catch((err: unknown) => {
    throw new StoryFormatError("not-a-zip", `Not a readable zip file (${err instanceof Error ? err.message : String(err)}).`);
  });
  if (overLimit) {
    throw new StoryFormatError("too-large", "This zip is too large to open as a story.");
  }

  const prefix = findStoryRoot(Object.keys(entries));
  const files = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(entries)) {
    if (name.startsWith(prefix)) files.set(name.slice(prefix.length), data);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(files.get(STORY_JSON)!));
  } catch (err) {
    throw new StoryFormatError("bad-json", `story.json is not valid JSON (${err instanceof Error ? err.message : String(err)}).`);
  }
  const doc = upgradeStory(raw);
  const result = validate(doc, files);
  if (!result.valid) {
    throw new StoryValidationError(result.errors);
  }
  return { doc, files, warnings: result.warnings };
}

/** The `invalid` StoryFormatError, carrying every issue found. */
export class StoryValidationError extends StoryFormatError {
  readonly issues: StoryIssue[];
  constructor(issues: StoryIssue[]) {
    super("invalid", `story.json is invalid: ${issues.slice(0, 5).map((i) => `${i.path || "/"} ${i.message}`).join("; ")}${issues.length > 5 ? ` (and ${issues.length - 5} more)` : ""}`);
    this.issues = issues;
  }
}

function findStoryRoot(names: string[]): string {
  if (names.includes(STORY_JSON)) return "";
  const nested = names.filter((n) => /^[^/]+\/story\.json$/.test(n));
  if (nested.length === 1) return nested[0].slice(0, -STORY_JSON.length);
  throw new StoryFormatError(
    "no-story-json",
    nested.length > 1
      ? "This zip holds more than one story.json; a story zip has exactly one."
      : "This zip has no story.json, so it isn't a story.",
  );
}

/** The Blob for one media key, typed with its declared mime -- ready for
 * URL.createObjectURL(). Undefined for an unknown key or a missing file. */
export function mediaBlob(pkg: StoryPackage, key: string): Blob | undefined {
  const item: MediaItem | undefined = Object.prototype.hasOwnProperty.call(pkg.doc.media, key) ? pkg.doc.media[key] : undefined;
  const data = item && pkg.files.get(item.src);
  return data ? new Blob([data as Uint8Array<ArrayBuffer>], { type: item.mime }) : undefined;
}

/** Already-compressed formats are stored rather than deflated again. */
function isCompressedMime(mime: string | undefined): boolean {
  return !!mime && (/^(image|video|audio)\//.test(mime) && mime !== "image/svg+xml" && mime !== "image/bmp");
}

/** Builds a .story.zip from a document and its media files (keyed by the
 * same paths as the media `src` values). Fills in `format`/`version` when
 * absent, validates, and throws StoryValidationError rather than writing
 * an invalid story. */
export async function writeStoryZip(
  doc: Omit<StoryDoc, "format" | "version"> & Partial<Pick<StoryDoc, "format" | "version">>,
  files: Map<string, Uint8Array | Blob>,
): Promise<Uint8Array> {
  const full: StoryDoc = { format: FORMAT_ID, version: FORMAT_VERSION, ...doc } as StoryDoc;
  const result = validate(full, files);
  if (!result.valid) throw new StoryValidationError(result.errors);

  const mimeBySrc = new Map(Object.values(full.media).map((m) => [m.src, m.mime]));
  const entries: AsyncZippable = {
    [STORY_JSON]: [new TextEncoder().encode(JSON.stringify(full, null, 2)), { level: 6 }],
  };
  for (const [path, data] of files) {
    if (path === STORY_JSON) continue;
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer());
    entries[path] = [bytes, { level: isCompressedMime(mimeBySrc.get(path)) ? 0 : 6 }];
  }
  return new Promise((resolve, reject) => {
    zip(entries, (err, out) => (err ? reject(err) : resolve(out)));
  });
}
