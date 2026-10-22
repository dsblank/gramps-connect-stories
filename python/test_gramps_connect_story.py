#
# Copyright (C) 2026  Doug Blank <doug.blank@gmail.com>
#
# This program is free software; you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation; either version 2 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#

"""Tests for gramps_connect_story.py. (scripts/test-python.ts also checks
its output with the TypeScript reader.)"""

import io
import json
import os
import struct
import tempfile
import unittest
import zipfile
import zlib

import gramps_connect_story as gcs
from gramps_connect_story import Story


def tiny_png(width=4, height=3):
    """A valid opaque RGB PNG, without needing Pillow."""

    def chunk(kind, body):
        return (
            struct.pack(">I", len(body))
            + kind
            + body
            + struct.pack(">I", zlib.crc32(kind + body))
        )

    rows = b"".join(b"\x00" + b"\x80\x40\x20" * width for _ in range(height))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(rows))
        + chunk(b"IEND", b"")
    )


def read(data):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        doc = json.loads(archive.read("story.json"))
        return doc, {name: archive.read(name) for name in archive.namelist()}


def written(story):
    out = io.BytesIO()
    story.write(out)
    return read(out.getvalue())


class StoryTest(unittest.TestCase):
    def test_minimal(self):
        story = Story("A Short Story")
        story.add_slide(title="A Short Story", text="One slide.")
        doc, files = written(story)
        self.assertEqual(doc["format"], "gramps-connect-story")
        self.assertEqual(doc["version"], "1.0")
        self.assertEqual(
            doc["slides"],
            [{"id": "s0", "title": "A Short Story", "text": "One slide."}],
        )
        self.assertEqual(doc["media"], {})
        self.assertEqual(sorted(files), ["story.json"])

    def test_dates_places_people(self):
        story = Story("Josef", language="de_CH.UTF-8", generator={"name": "Test"})
        story.add_slide(
            title="Birth",
            date={"text": "about 1850", "edtf": "1850~", "sortYear": 1850},
            place={"name": "Zürich", "lat": 47.37, "lon": 8.54},
            people=["Josef Meyer", ""],
        )
        story.add_slide(title="Undated", date=None, place={"name": None})
        doc, _ = written(story)
        self.assertEqual(doc["language"], "de-CH")
        self.assertEqual(doc["generator"], {"name": "Test"})
        self.assertEqual(
            doc["slides"][0]["date"],
            {"text": "about 1850", "edtf": "1850~", "sortYear": 1850},
        )
        self.assertEqual(
            doc["slides"][0]["place"], {"name": "Zürich", "lat": 47.37, "lon": 8.54}
        )
        self.assertEqual(doc["slides"][0]["people"], [{"name": "Josef Meyer"}])
        self.assertNotIn("place", doc["slides"][1])

    def test_a_photo_used_twice_is_stored_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "portrait.png")
            with open(path, "wb") as handle:
                handle.write(tiny_png())
            story = Story("Photos")
            story.add_slide(title="One", photo=path, caption="Josef", credit="Archive")
            story.add_slide(title="Two", photo=path)
            doc, files = written(story)
        self.assertEqual(
            doc["slides"][0]["media"],
            [{"ref": "m1", "caption": "Josef", "credit": "Archive"}],
        )
        self.assertEqual(doc["slides"][1]["media"], [{"ref": "m1"}])
        self.assertEqual(list(doc["media"]), ["m1"])
        self.assertIn(doc["media"]["m1"]["src"], files)

    def test_invalid_stories_are_refused(self):
        with self.assertRaises(ValueError):
            Story("  ")
        with self.assertRaisesRegex(ValueError, "at least one slide"):
            Story("Empty").write(io.BytesIO())
        story = Story("Bad")
        story.add_slide(place={"lat": 47.0})
        with self.assertRaisesRegex(ValueError, "lat and lon"):
            story.write(io.BytesIO())
        story = Story("Bad")
        story.add_slide(date={"text": "1850", "sortYear": 1850.5})
        with self.assertRaisesRegex(ValueError, "whole year"):
            story.write(io.BytesIO())
        story = Story("Bad")
        story.add_slide()["media"] = [{"ref": "nope"}]
        with self.assertRaisesRegex(ValueError, "unknown media"):
            story.write(io.BytesIO())

    def test_bcp47(self):
        self.assertEqual(gcs.bcp47("en_US.UTF-8"), "en-US")
        self.assertEqual(gcs.bcp47("C"), None)
        self.assertEqual(gcs.bcp47(None), None)


@unittest.skipUnless(gcs._HAVE_PIL, "Pillow not installed")
class PillowTest(unittest.TestCase):
    def test_photos_are_sized_rotated_and_stripped(self):
        from PIL import Image

        image = Image.new("RGB", (2400, 1800), (200, 50, 50))
        exif = Image.Exif()
        exif[0x0112] = 6  # rotate 90 degrees
        exif[0x010F] = "SecretCam"
        raw = io.BytesIO()
        image.save(raw, "JPEG", exif=exif.tobytes())
        data, mime, ext, width, height = gcs.optimize_photo(raw.getvalue())
        self.assertEqual((width, height), (1200, 1600))
        self.assertIn(mime, ("image/webp", "image/jpeg"))
        self.assertNotIn(b"SecretCam", data)
        with Image.open(io.BytesIO(data)) as result:
            self.assertEqual(result.size, (1200, 1600))
            self.assertEqual(dict(result.getexif()), {})

    def test_transparency_is_kept(self):
        from PIL import Image

        raw = io.BytesIO()
        Image.new("RGBA", (10, 10), (0, 0, 0, 0)).save(raw, "PNG")
        data, mime, _, _, _ = gcs.optimize_photo(raw.getvalue())
        with Image.open(io.BytesIO(data)) as result:
            self.assertIn("A", result.getbands())


class WithoutPillowTest(unittest.TestCase):
    def setUp(self):
        self.saved = gcs._HAVE_PIL
        gcs._HAVE_PIL = False

    def tearDown(self):
        gcs._HAVE_PIL = self.saved

    def test_photos_are_stored_as_they_are(self):
        story = Story("Raw")
        story.add_slide(
            photo=story.add_media(tiny_png(), mime="image/png", alt="A square")
        )
        doc, files = written(story)
        self.assertEqual(
            doc["media"]["m1"],
            {"src": "media/m1.png", "mime": "image/png", "alt": "A square"},
        )
        self.assertEqual(files["media/m1.png"], tiny_png())

    def test_bytes_need_a_type(self):
        with self.assertRaisesRegex(ValueError, "mime"):
            Story("Raw").add_media(tiny_png())


if __name__ == "__main__":
    unittest.main()
