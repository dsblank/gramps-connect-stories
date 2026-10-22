# Gramps Connect Stories

A portable, versioned file format for family-history **stories** (slides
with text, dates, places on a map, and photos), plus the TypeScript
package that reads, writes and validates them.

A story is one `.story.zip`: a `story.json` and the media it uses. It needs
no database, server or account to open, so any program can write one and
any viewer can present it. [Gramps Connect](https://github.com/dsblank/gramps-connect)
writes them; a standalone viewer is planned.

- **Format specification:** [`spec/1.0/README.md`](spec/1.0/README.md)
- **JSON Schema:** [`spec/1.0/story.schema.json`](spec/1.0/story.schema.json)
- **Examples:** [`examples/`](examples/)

## The package: `@gramps-connect/story`

```ts
import { readStoryZip, writeStoryZip, validate, optimizeImage, mediaBlob } from "@gramps-connect/story";

// Open a story (a File, Blob, ArrayBuffer or Uint8Array).
const story = await readStoryZip(file);
story.doc.title;                          // story.json, upgraded to the current format
const url = URL.createObjectURL(mediaBlob(story, "m1")!);

// Write one. Throws StoryValidationError rather than producing an invalid story.
const photo = await optimizeImage(originalBlob);   // 1600px WebP, EXIF/GPS removed
const zip = await writeStoryZip(
  {
    title: "The Story of Anna Keller",
    slides: [{ id: "s0", title: "The Story of Anna Keller", media: [{ ref: "m1" }] }],
    media: { m1: { src: `media/m1.${photo.ext}`, mime: photo.mime, width: photo.width, height: photo.height } },
  },
  new Map([[`media/m1.${photo.ext}`, photo.blob]]),
);
```

| Export | What it does |
|---|---|
| `readStoryZip(input, limits?)` | Opens a `.story.zip`: finds `story.json`, upgrades older format versions, validates against the files present. Throws `StoryFormatError` with a `code` (`not-a-zip`, `no-story-json`, `bad-json`, `not-a-story`, `bad-version`, `newer-version`, `too-large`, `invalid`). |
| `writeStoryZip(doc, files)` | Builds a `.story.zip`, filling in `format`/`version`. Photos are stored, not recompressed. |
| `validate(doc, files?)` | Schema plus cross-reference checks; returns `{valid, errors, warnings}` with JSON Pointer paths. |
| `upgradeStory(raw)` | Checks `format`/`version` and upgrades an older major version. |
| `optimizeImage(blob, options?)` | Browser only. Resizes (1600px photos, 2048px map overlays), applies EXIF rotation, re-encodes to WebP (PNG for transparent overlays), and drops all metadata. |
| `mediaBlob(story, key)` | A media file as a typed `Blob`. |
| `FORMAT_VERSION`, `SUPPORTED_FORMAT_MAJORS` | The format version written, and every major version that can be read. |

`validate()` runs a validator compiled ahead of time from the schema
(`src/generated/`), so it works under a strict Content-Security-Policy.

## Development

```sh
npm install
npm test               # Node tests (examples, versioning, validation, zip handling)
npm run test:browser   # optimizeImage() in headless Google Chrome
npm run typecheck
npm run generate       # after editing spec/*/story.schema.json
```

## Versioning

The format has its own `MAJOR.MINOR` version, separate from the package's.
Newer minor versions only add optional fields, which older readers ignore;
a newer major version is refused with a clear message. Every older major
version stays readable through an upgrader in `src/version.ts`. See
[spec section 2](spec/1.0/README.md#2-versioning).

## License

AGPL-3.0-or-later, the same as Gramps Connect. See [LICENSE](LICENSE).
