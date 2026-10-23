# Gramps Connect Stories

A portable, versioned file format for family-history **stories** (slides
with text, dates, places on a map, and photos), plus the TypeScript
package that reads, writes and validates them.

A story is one `.story.zip`: a `story.json` and the media it uses. It needs
no database, server or account to open, so any program can write one and
any viewer can present it. [Gramps Connect](https://github.com/dsblank/gramps-connect)
writes them and presents them with this package's player.

- **Open a story:** the Gramps Connect Story Viewer at
  **https://dsblank.github.io/gramps-connect-stories/**. Pick or drop a
  `.story.zip`, or link to one with `?src=<url>`; `#s3` opens a slide.
  Everything happens in the browser: an opened story is never uploaded.
- **Put a story on a web page:** the [`<gramps-connect-story>`](#on-any-web-page-gramps-connect-story)
  element.
- **Format specification:** [`spec/1.0/README.md`](spec/1.0/README.md)
- **JSON Schema:** [`spec/1.0/story.schema.json`](spec/1.0/story.schema.json)
- **Examples:** [`examples/`](examples/)

## On any web page: `<gramps-connect-story>`

One script tag, no build step:

```html
<script type="module"
  src="https://cdn.jsdelivr.net/npm/@gramps-connect/story@0.1.0/dist/embed.js"></script>

<gramps-connect-story src="josef-meyer.story.zip"></gramps-connect-story>
```

| Attribute | |
|---|---|
| `src` | URL of a `.story.zip`. On another site, that site has to allow it (CORS). |
| `slide` | Slide to open on: an index, or a slide id like `s3`. |
| `theme` | `light`, `dark`, or `auto` (the default: the viewer's setting). |

It's 480px tall unless the page's CSS says otherwise
(`gramps-connect-story { height: 70vh }`), and draws into a shadow root,
so the page's styles and the story's don't mix. Arrow keys move between
slides once a story has focus, so several can share a page. `embed.js`
includes React and maplibre; the map's worker loads from beside it (from
a CDN through a `blob:` URL, so a page whose Content-Security-Policy sets
`worker-src` has to allow `blob:`).

## The package: `@gramps-connect/story`

```sh
npm install @gramps-connect/story
```

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

## The player: `@gramps-connect/story/player`

A React component that presents a story: one slide at a time over a
full-bleed map when any slide has a place (with the place's shapes,
historical map overlays shown in their own era, and Auto / Standard /
Historical basemaps from OpenFreeMap and OpenHistoricalMap), or as plain
cards when none does, with a timeline strip when two or more slides are
dated.

```tsx
import * as maplibregl from "maplibre-gl";
import { StoryPlayer } from "@gramps-connect/story/player";

// Tell maplibre where your bundler serves its worker (maplibre-gl 5+
// ships it as dist/maplibre-gl-worker.mjs + dist/maplibre-gl-shared.mjs,
// which must sit side by side). Without this the map draws nothing.
maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");

const story = await readStoryZip(file);
const urls = new Map<string, string>();
const resolveMedia = async (key: string) => {
  if (!urls.has(key)) urls.set(key, URL.createObjectURL(mediaBlob(story, key)!));
  return urls.get(key)!;
};

<div style={{ width: "100vw", height: "100vh" }}>
  <StoryPlayer story={story.doc} resolveMedia={resolveMedia} onClose={() => {}} />
</div>
```

It fills its container. Props:

| Prop | |
|---|---|
| `story` | The story document (`StoryDoc`). |
| `resolveMedia(key, item)` | A URL for a media key, or null. The host owns these URLs, and revoking them. |
| `dark`, `colors` | Light/dark defaults, and any colors to override (`surface`, `text`, `muted`, `border`, `mark`, `panel`). |
| `strings` | The player's own words (`previous`, `next`, `close`, map-mode labels). By default, built-in English, German, Spanish, French or Dutch, by the story's language and then the browser's. |
| `onClose` | Shows a close button. |
| `keyboard` | Arrow keys change slides: `true` (default) anywhere on the page, `"focus"` only while the player has focus, `false` never. Swiping on a slide always works. |
| `onSlideChange(index)` | Called whenever the slide changes. |
| `initialSlide` | The slide to open on. |
| `renderMapModeControl` | Replaces the built-in map-mode control with your own, given the same props. |

Peer dependencies: `react`, `react-dom` and `maplibre-gl` (5 or later),
needed only by the player. With TypeScript 6 or later, add `"geojson"` to
`compilerOptions.types`: maplibre's own declarations use its global
`GeoJSON` namespace.

## Writing stories from Python: `python/gramps_connect_story.py`

One file, standard library only, for programs that aren't JavaScript.
Copy it into your project. It's **GPL-2.0-or-later** (unlike the rest of
this repo), so GPL programs such as Gramps addons can include it.

```python
from gramps_connect_story import Story

story = Story("The Story of Josef Meyer", language="en")
story.add_slide(
    title="Birth",
    text="Josef was born *about* 1850.",
    date={"text": "about 1850", "edtf": "1850~", "sortYear": 1850},
    place={"name": "Zürich", "lat": 47.37, "lon": 8.54},
    photo="portrait.jpg",
)
story.write("josef.story.zip")
```

With [Pillow](https://python-pillow.org/) installed, photos are sized for
viewing (1600px, WebP) with their metadata removed; without it they're
stored as they are. `write()` checks what a writer can get wrong (ids,
references, coordinates) and the tests check the output against this
package's own reader (`npm run test:python`).

The Gramps desktop addon **Export Story** (Tools → Utilities, in
`gramps-project/addons-source`) ships a copy of this file; keep the two
identical.

## Development

```sh
npm install
npm test               # Node tests (examples, versioning, validation, zip handling)
npm run test:browser   # in headless Google Chrome: optimizeImage(), the player,
                       # the embed (cross-origin) and the viewer site
npm run test:pack      # what npm would get, installed into an empty project
npm run test:python    # the Python writer, and its output read by this package
npm run typecheck
npm run generate       # after editing spec/*/story.schema.json
npm run build          # dist/ (what npm users get)
npm run build:site     # site-dist/ (the viewer)
```

Gramps Connect includes this repo as a git submodule and compiles `src/`
directly (the `source` export condition), so it never needs `dist/`.

## Releasing

The viewer site redeploys from `main` on every push
(`.github/workflows/pages.yml`). An npm release is a version tag:

```sh
# bump "version" in package.json, commit and push, then:
git tag v0.2.0 && git push origin v0.2.0
```

`.github/workflows/release.yml` then runs every test and publishes with
provenance. The package's version (semver, for its API) is separate from
the format's (`FORMAT_VERSION`); the table below says which package
versions read and write which format versions.

| Package | Reads format | Writes format |
|---|---|---|
| 0.1.x | 1.x | 1.0 |

## Versioning

The format has its own `MAJOR.MINOR` version, separate from the package's.
Newer minor versions only add optional fields, which older readers ignore;
a newer major version is refused with a clear message. Every older major
version stays readable through an upgrader in `src/version.ts`. See
[spec section 2](spec/1.0/README.md#2-versioning).

## License

AGPL-3.0-or-later, the same as Gramps Connect. See [LICENSE](LICENSE).

The exception is the Python writer, `python/gramps_connect_story.py`:
GPL-2.0-or-later, the same as Gramps desktop, so Gramps addons can include
it.
