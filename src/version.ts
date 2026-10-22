// Format identity and versioning (spec/1.0/README.md section 2), and the
// chain of upgraders that lets this package keep opening every older major
// version of the format.
import type { StoryDoc } from "./types";

export const FORMAT_ID = "gramps-connect-story";

/** The version this package writes. */
export const FORMAT_VERSION = "1.0";

export const CURRENT_MAJOR = 1;

/** Upgraders, keyed by the major version they upgrade *from*: UPGRADERS[1]
 * turns a 1.x document into a 2.0 one, and so on. Never remove one -- each
 * is the only thing that keeps old files opening -- and give each a fixture
 * from its source version under examples/. Empty while 1 is the only major.
 * Each receives a document that already passed its own version's checks. */
const UPGRADERS: Record<number, (doc: Record<string, unknown>) => Record<string, unknown>> = {};

/** Every major version upgradeStory() can open. */
export const SUPPORTED_FORMAT_MAJORS: readonly number[] = Object.freeze(
  Array.from({ length: CURRENT_MAJOR }, (_, i) => i + 1).filter(
    (major) => major === CURRENT_MAJOR || UPGRADERS[major] !== undefined,
  ),
);

export type StoryErrorCode =
  | "not-a-zip"
  | "no-story-json"
  | "bad-json"
  | "not-a-story"
  | "bad-version"
  | "newer-version"
  | "too-large"
  | "invalid";

export class StoryFormatError extends Error {
  readonly code: StoryErrorCode;
  constructor(code: StoryErrorCode, message: string) {
    super(message);
    this.name = "StoryFormatError";
    this.code = code;
  }
}

export interface ParsedVersion {
  major: number;
  minor: number;
}

export function parseVersion(version: unknown): ParsedVersion | null {
  if (typeof version !== "string") return null;
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.exec(version);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

/** Checks `raw` is a story at all and brings it up to CURRENT_MAJOR.
 * Doesn't validate the result -- see validate.ts -- only what it needs to
 * pick upgraders: `format` and `version`. Throws StoryFormatError. */
export function upgradeStory(raw: unknown): StoryDoc {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new StoryFormatError("not-a-story", "story.json is not a JSON object.");
  }
  let doc = raw as Record<string, unknown>;
  if (doc.format !== FORMAT_ID) {
    throw new StoryFormatError("not-a-story", `story.json's "format" is not "${FORMAT_ID}".`);
  }
  const parsed = parseVersion(doc.version);
  if (!parsed || parsed.major < 1) {
    throw new StoryFormatError("bad-version", `story.json's "version" (${JSON.stringify(doc.version)}) is not a valid MAJOR.MINOR version.`);
  }
  if (parsed.major > CURRENT_MAJOR) {
    throw new StoryFormatError(
      "newer-version",
      `This story uses format version ${doc.version}, which is newer than this viewer supports (up to ${CURRENT_MAJOR}.x). A newer viewer is needed to open it.`,
    );
  }
  for (let major = parsed.major; major < CURRENT_MAJOR; major++) {
    const upgrade = UPGRADERS[major];
    if (!upgrade) {
      throw new StoryFormatError("bad-version", `No upgrade path from format version ${major}.x.`);
    }
    doc = upgrade(doc);
  }
  return doc as unknown as StoryDoc;
}
