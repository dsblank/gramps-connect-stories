# Example stories

Each folder is the unzipped contents of a `.story.zip`. The tests zip them
up and read them back, so every example here must stay valid.

| Folder | Shows |
|---|---|
| `minimal/` | The smallest valid story: one slide, no media. |
| `no-map/` | Dates and photos but no places: a viewer presents it without a map. Line breaks and paragraphs in text. An undated slide. |
| `full/` | Every optional field: image overlay with a date, GeoJSON geometry, captions and credits, people, presentation hints, extensions. |
| `rtl/` | A right-to-left language (Hebrew). |

When a future format version changes something, add a fixture here from
the version it upgrades from (e.g. `v1-...`), so the upgrader stays tested.
