# Gramps Connect Story format, version 1.0

A **story** is a sequence of slides about people's lives: a title, some
text, and optionally a date, a place on a map, and photos. This document
defines a file format for a finished story that any program can write and
any viewer can present, with no access to the genealogy database it came
from.

The key words MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119.

- Schema: [`story.schema.json`](story.schema.json) (JSON Schema 2020-12)
- Examples: [`../../examples/`](../../examples/)
- Changes between versions: [`../CHANGELOG.md`](../CHANGELOG.md)

## 1. The file

A story is a single ZIP archive, conventionally named `<title>.story.zip`.

```
josef-meyer.story.zip
├── story.json
└── media/
    ├── m1.webp
    └── m2.png
```

- `story.json`, UTF-8 JSON, MUST be at the root of the archive.
- Every file a story uses MUST be inside the archive, so a story works
  offline and keeps working. Media paths in `story.json` are relative to
  the archive root (§5).
- Other files MAY be present; viewers ignore any file `story.json` doesn't
  refer to.

**Readers SHOULD also accept** an archive with no root `story.json` but
exactly one `<folder>/story.json`, treating `<folder>/` as the root. That is
what "compress this folder" produces on most systems. Entries under
`__MACOSX/` are ignored.

## 2. Versioning

Every `story.json` has

```json
{ "format": "gramps-connect-story", "version": "1.0" }
```

`format` is always `"gramps-connect-story"`. A reader MUST reject a
file with any other `format`.

`version` is `MAJOR.MINOR`:

- A **minor** version only adds optional fields. A reader of version 1.N
  MUST open any 1.x file, including newer ones, and MUST ignore fields it
  does not know.
- A **major** version may change or remove fields. A reader MUST refuse a
  file whose major version is newer than any it supports, and SHOULD say
  that a newer viewer is needed rather than showing a partial story.
- A reader SHOULD open files of every older major version, by upgrading
  them to the shape it understands.

Writers SHOULD write the lowest version that has every field they use.

## 3. `story.json`

| Field | Type | Required | Meaning |
|---|---|---|---|
| `format` | string | yes | Always `"gramps-connect-story"`. |
| `version` | string | yes | `"1.0"` for this version (§2). |
| `title` | string | yes | The story's title. |
| `slides` | array of [Slide](#31-slide) | yes | At least one. Shown in array order. |
| `media` | object of [Media](#35-media) | yes | Every media file, keyed by id (may be empty). |
| `language` | string | | BCP 47 tag of the text (`"en"`, `"de-CH"`). Viewers MAY use it to localize their own controls. |
| `created` | string | | RFC 3339 date-time the file was written. |
| `generator` | object | | `{name, version?, url?}` of the program that wrote it. |
| `authors` | array | | `[{name, url?}]` |
| `license` | string | | License of the story's content: an SPDX identifier (`"CC-BY-4.0"`) or free text. |
| `presentation` | object | | Hints a viewer MAY ignore (§6). |
| `extensions` | object | | Producer-specific data (§7). |
| `$schema` | string | | URL of the schema, for editors and validators. |

**Ids** (slide ids and media keys) are 1–64 characters from
`A–Z a–z 0–9 _ -`, unique within their kind in one file.

### 3.1 Slide

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | string | yes | Unique among slides. Viewers MAY use it for links (`#s3`). |
| `title` | string | | Heading. |
| `text` | string | | Body, with the markup in §4. |
| `date` | [Date](#32-date) | | When it happened. |
| `place` | [Place](#33-place) | | Where it happened. |
| `media` | array of [Slide media](#34-slide-media) | | Photos for this slide, in order. |
| `people` | array | | `[{name, role?}]`: who the slide is about. Informational. |

Every slide field except `id` is optional. A slide with only text, only a
photo, or only a place is valid.

The first slide is the story's opening card. Nothing distinguishes it
structurally; viewers present slides in array order and MUST NOT re-sort
them by date.

### 3.2 Date

| Field | Type | Required | Meaning |
|---|---|---|---|
| `text` | string | yes | The date as it should be displayed, in the story's language: `"about 1850"`, `"between 1910 and 1912"`. |
| `edtf` | string | | The same date in [Extended Date/Time Format](https://www.loc.gov/standards/datetime/) (ISO 8601-2): `"1850~"`, `"1910/1912"`, `"1923-04-?"`. |
| `sortYear` | integer | | A single representative year (proleptic Gregorian), used to place the slide on a timeline and to choose a historical basemap. |

Viewers display `text`. `edtf` is for programs that want to reason about
the date; writers SHOULD omit it rather than guess when a date doesn't fit
EDTF (textual dates, non-Gregorian calendars).

### 3.3 Place

| Field | Type | Required | Meaning |
|---|---|---|---|
| `name` | string | | Display name. |
| `lat`, `lon` | number | together | WGS 84 decimal degrees. If one is present, both MUST be. |
| `geometry` | GeoJSON object | | A shape for the place (RFC 7946 FeatureCollection, Feature, or geometry), drawn under the pin: a parish boundary, a route. |
| `overlays` | array of [Overlay](#331-overlay) | | Images placed on the map, typically scanned historical maps. |

A slide whose place has no `lat`/`lon` and no `geometry` has no position;
a viewer shows it without moving the map.

#### 3.3.1 Overlay

| Field | Type | Required | Meaning |
|---|---|---|---|
| `media` | string | yes | Key into `media` of the image. |
| `corners` | array of 4 `[lon, lat]` | yes | Where the image's top-left, top-right, bottom-right and bottom-left corners go. |
| `opacity` | number 0–1 | | Default 1. |
| `order` | integer | | Stacking among this slide's overlays; lower is drawn first. Default: array order. |
| `date` | [Date](#32-date) | | The period the overlay depicts. A viewer showing a historical basemap for a year SHOULD hide overlays whose `date` doesn't include that year. |

### 3.4 Slide media

| Field | Type | Required | Meaning |
|---|---|---|---|
| `ref` | string | yes | Key into `media`. |
| `caption` | string | | Shown with the image on this slide. |
| `credit` | string | | Attribution shown with the image on this slide. |

### 3.5 Media

| Field | Type | Required | Meaning |
|---|---|---|---|
| `src` | string | yes | Path of the file in the archive, e.g. `"media/m1.webp"`. No leading `/`, no `.` or `..` segments, no backslashes. |
| `mime` | string | yes | Media type, e.g. `"image/webp"`. |
| `width`, `height` | integer | | Pixel size, so viewers can lay out before the image loads. |
| `alt` | string | | Text alternative for screen readers. |

The same media item MAY be used by several slides and overlays; it is
stored once. Viewers MUST support `image/jpeg`, `image/png` and
`image/webp`, and SHOULD skip media of a type they can't show.

## 4. Text markup

Slide `text` is plain text with exactly these conventions:

- `**bold**` and `*italic*` (bold is matched first, so `**a**` is bold,
  not two empty italics).
- A line break (`\n`) is a line break. A blank line separates paragraphs.

Nothing else is interpreted: not HTML, not links, not the rest of
Markdown. An unmatched `*` is a literal asterisk. Viewers MUST NOT render
`text` as HTML. Later minor versions may add conventions; older viewers
will show them as literal text.

## 5. Media paths

`src` is resolved against the archive root (or the folder containing
`story.json`, §1). Writers SHOULD put media under `media/`, named by media
key plus extension, and SHOULD size images for screen presentation (about
1600 px on the long edge for photos), with metadata such as EXIF/GPS
removed.

## 6. Presentation hints

| Field | Values | Meaning |
|---|---|---|
| `basemap` | `"standard"`, `"historical"`, `"auto"`, `"none"` | Starting map style. `historical` shows a map of the era (e.g. OpenHistoricalMap) for the current slide's `sortYear`; `auto` is the viewer's choice; `none` presents the story without a map. |

## 7. Extensions

`extensions` holds data for specific programs, keyed by a namespace the
producer owns: its name or a domain. Viewers MUST ignore it. Gramps Connect
writes `"gramps-connect"` with the record ids slides were made from.

```json
"extensions": { "gramps-connect": { "slides": { "s1": { "event": "E0012" } } } }
```

## 8. Validity beyond the schema

`story.schema.json` checks structure. A valid story also satisfies:

1. Slide ids are unique.
2. Every slide-media `ref` and overlay `media` is a key of `media`.
3. Every `src` names a file present in the archive.

The `@gramps-connect/story` package's `validate()` checks all of these.
