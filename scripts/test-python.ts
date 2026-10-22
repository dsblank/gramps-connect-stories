// The Python writer (python/gramps_connect_story.py) checked by this
// package's own reader: Python writes a story -- once with Pillow, once
// as if it weren't installed -- and readStoryZip() must accept it with no
// errors and no warnings. Run with tsx (it imports src/ directly).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mediaBlob, readStoryZip } from "../src/index";

const root = fileURLToPath(new URL("..", import.meta.url));
const python = process.env.PYTHON ?? "python3";

const writer = (out: string, withoutPillow: boolean) => `
import sys
${withoutPillow ? 'sys.modules["PIL"] = None' : ""}
sys.path.insert(0, ${JSON.stringify(join(root, "python"))})
import gramps_connect_story as gcs
from test_gramps_connect_story import tiny_png
story = gcs.Story("The Story of Josef Meyer", language="en_US", generator={"name": "test-python"},
                  authors=["Example Author"], license="CC-BY-4.0")
photo = story.add_media(tiny_png(40, 30), mime="image/png", alt="Josef")
story.add_slide(title="The Story of Josef Meyer", text="Two moments.", photo=photo, people=["Josef Meyer"])
story.add_slide(title="Birth", text="Born *about* 1850 in **Zürich**.",
                date={"text": "about 1850", "edtf": "1850~", "sortYear": 1850},
                place={"name": "Zürich, Switzerland", "lat": 47.3769, "lon": 8.5417},
                photo=photo, caption="A portrait", people=["Josef Meyer"])
story.add_slide(title="Emigration", date={"text": "1872"})
story.extensions["test-python"] = {"pillow": gcs._HAVE_PIL}
story.write(${JSON.stringify(out)})
`;

const work = mkdtempSync(join(tmpdir(), "story-python-"));
try {
  for (const withoutPillow of [false, true]) {
    const out = join(work, `story-${withoutPillow ? "raw" : "pillow"}.story.zip`);
    execFileSync(python, ["-c", writer(out, withoutPillow)], { stdio: "inherit" });
    const story = await readStoryZip(readFileSync(out));
    assert.deepEqual(story.warnings, []);
    assert.equal(story.doc.language, "en-US");
    assert.equal(story.doc.slides.length, 3);
    assert.deepEqual(story.doc.slides[1].date, { text: "about 1850", edtf: "1850~", sortYear: 1850 });
    const usedPillow = (story.doc.extensions?.["test-python"] as { pillow: boolean }).pillow;
    if (withoutPillow) assert.equal(usedPillow, false);
    const photo = mediaBlob(story, "m1")!;
    assert.ok(photo.size > 0);
    assert.equal(photo.type, usedPillow ? story.doc.media.m1.mime : "image/png");
    console.log(`python writer (${usedPillow ? "with Pillow" : "without Pillow"}): valid, ${story.doc.media.m1.mime}`);
  }
  console.log("python tests passed");
} finally {
  rmSync(work, { recursive: true, force: true });
}
