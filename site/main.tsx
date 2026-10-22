// The standalone viewer: open a .story.zip (picked, dropped, or ?src=URL)
// and present it. Runs entirely in the browser -- an opened file is never
// uploaded anywhere; the only network traffic is the map's tiles.
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { createRoot } from "react-dom/client";
import * as maplibregl from "maplibre-gl";
import { mediaBlob, readStoryZip, type StoryPackage } from "../src/index";
import { StoryPlayer } from "../src/player/index";

maplibregl.setWorkerUrl(new URL("./maplibre-gl-worker.mjs", import.meta.url).href);

declare const __PACKAGE_VERSION__: string;

const EXAMPLES = [
  { file: "full", label: "The Story of Josef Meyer", about: "a map with a historical overlay, a shape, captions, and a timeline" },
  { file: "no-map", label: "The Story of Anna Keller", about: "no places, so plain cards; paragraphs" },
  { file: "rtl", label: "סיפורה של רבקה כהן", about: "a right-to-left language" },
];

function usePrefersDark(): boolean {
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const [dark, setDark] = useState(query.matches);
  useEffect(() => {
    const onChange = () => setDark(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [query]);
  return dark;
}

/** #s3 -> the index of slide "s3" (or 0). */
function slideFromHash(story: StoryPackage): number {
  const id = decodeURIComponent(location.hash.slice(1));
  const index = id ? story.doc.slides.findIndex((s) => s.id === id) : -1;
  return Math.max(index, 0);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function App() {
  const dark = usePrefersDark();
  const [story, setStory] = useState<StoryPackage | null>(null);
  const [initialSlide, setInitialSlide] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const urls = useRef(new Map<string, string>());

  const release = () => {
    for (const url of urls.current.values()) URL.revokeObjectURL(url);
    urls.current.clear();
  };

  const open = useCallback(async (input: Blob | Promise<Blob>, keepUrl: boolean) => {
    setError(null);
    setLoading(true);
    try {
      const pkg = await readStoryZip(await input);
      release();
      setInitialSlide(slideFromHash(pkg));
      setStory(pkg);
      document.title = pkg.doc.title;
      if (!keepUrl) history.replaceState(null, "", location.pathname);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // ?src=<url of a .story.zip>
  useEffect(() => {
    const src = new URLSearchParams(location.search).get("src");
    if (!src) return;
    void open(
      fetch(new URL(src, location.href)).then((res) => {
        if (!res.ok) throw new Error(`Couldn't fetch ${src} (${res.status}).`);
        return res.blob();
      }).catch((err) => {
        throw new Error(err instanceof TypeError ? `Couldn't fetch ${src}. If it's on another website, that site has to allow it (CORS).` : errorText(err));
      }),
      true,
    );
  }, [open]);

  // F: fullscreen.
  useEffect(() => {
    if (!story) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "f" || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [story]);

  const resolveMedia = useCallback(async (key: string) => {
    const cached = urls.current.get(key);
    if (cached) return cached;
    const blob = story && mediaBlob(story, key);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    urls.current.set(key, url);
    return url;
  }, [story]);

  // The current slide goes in the URL (#s3), so a link or a reload comes
  // back to it -- except the opening slide, which needs none.
  const onSlideChange = useCallback((index: number) => {
    const id = index > 0 ? story?.doc.slides[index]?.id : undefined;
    history.replaceState(null, "", `${location.pathname}${location.search}${id ? `#${encodeURIComponent(id)}` : ""}`);
  }, [story]);

  const close = () => {
    release();
    setStory(null);
    document.title = "Gramps Connect Story Viewer";
    history.replaceState(null, "", location.pathname);
  };

  if (story) {
    return (
      <div className="stage">
        <StoryPlayer
          story={story.doc}
          resolveMedia={resolveMedia}
          dark={dark}
          initialSlide={initialSlide}
          onSlideChange={onSlideChange}
          onClose={close}
        />
      </div>
    );
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void open(file, false);
  };

  const embed = `<script type="module"
  src="https://cdn.jsdelivr.net/npm/@gramps-connect/story@${__PACKAGE_VERSION__}/dist/embed.js"></script>
<gramps-connect-story src="my-family.story.zip"></gramps-connect-story>`;

  return (
    <main
      className={`landing${dragging ? " dragging" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={onDrop}
    >
      <div className="column">
        <h1>Gramps Connect Story Viewer</h1>
        <p className="lead">
          Opens a family-history story saved as a <code>.story.zip</code>: slides with text, dates, photos, and
          places on a map.
        </p>

        <div className="drop">
          <button className="primary" type="button" onClick={() => fileInput.current?.click()} disabled={loading}>
            {loading ? "Opening…" : "Open a story…"}
          </button>
          <p className="hint">or drop a .story.zip file anywhere on this page</p>
          <input
            ref={fileInput}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = "";
              if (file) void open(file, false);
            }}
          />
        </div>
        {error && <div className="error" role="alert">{error}</div>}

        <p className="small" style={{ marginTop: 16 }}>
          Your story stays on your computer: nothing is uploaded. Only the map's background comes from the internet
          (OpenFreeMap and OpenHistoricalMap). Use the arrow keys or swipe to move between slides, and F for full
          screen.
        </p>

        <h2>Examples</h2>
        <ul>
          {EXAMPLES.map((ex) => (
            <li key={ex.file}>
              <a href={`?src=examples/${ex.file}.story.zip`}>{ex.label}</a> <span className="small">— {ex.about}</span>
            </li>
          ))}
        </ul>

        <h2>Making a story</h2>
        <p>
          In <a href="https://github.com/dsblank/gramps-connect">Gramps Connect</a>, open a story and choose{" "}
          <b>Download</b>. Other programs can write stories too: the format is open and documented.
        </p>

        <h2>For developers</h2>
        <ul>
          <li><a href="https://github.com/dsblank/gramps-connect-stories/blob/main/spec/1.0/README.md">Format specification, version 1.0</a> and its <a href="spec/1.0/story.schema.json">JSON Schema</a></li>
          <li><a href="https://www.npmjs.com/package/@gramps-connect/story">@gramps-connect/story</a> on npm: read, write and validate stories, and the player as a React component</li>
          <li><a href="https://github.com/dsblank/gramps-connect-stories">Source code</a> (AGPL-3.0-or-later)</li>
        </ul>
        <p style={{ marginTop: 12 }}>Put a story on any web page:</p>
        <pre>{embed}</pre>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
