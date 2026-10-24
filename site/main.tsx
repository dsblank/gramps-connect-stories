// The standalone viewer: open a .story.zip (picked, dropped, or ?src=URL)
// and present it. Runs entirely in the browser -- an opened file is never
// uploaded anywhere; the only network traffic is the map's tiles.
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { createRoot } from "react-dom/client";
import * as maplibregl from "maplibre-gl";
import { mediaBlob, readStoryZip, type StoryPackage } from "../src/index";
import { StoryPlayer, ViewerBrand, ViewerIcon } from "../src/player/index";
import { loadDraft, saveDraft, type Draft } from "./drafts";

maplibregl.setWorkerUrl(new URL("./maplibre-gl-worker.mjs", import.meta.url).href);

declare const __PACKAGE_VERSION__: string;

// Real stories made in Gramps Connect (site/demos/, served at demos/). The
// format's own test fixtures (examples/) are still built and served at
// examples/, just not listed here.
const DEMOS = [
  {
    file: "louis-xiii",
    label: "The Story of Louis XIII",
    about: (
      <>
        made in Gramps Connect from <code>sample-bourbon/bourbon.ged</code> in{" "}
        <a href="https://github.com/D-Jeffrey/gedcom-samples/tree/main/sample-bourbon">D-Jeffrey/gedcom-samples</a>
      </>
    ),
  },
  {
    file: "george-vi",
    label: "The Story of George VI",
    about: (
      <>
        made in Gramps Connect from the{" "}
        <a href="https://github.com/DavidMStraub/gramps-web-example-tree-queen">Gramps Web example tree</a>{" "}
        (<a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>); photos from{" "}
        <a href="https://commons.wikimedia.org/">Wikimedia Commons</a>, credited on each slide
      </>
    ),
  },
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
  // The file the story came from, for the editor to save back under.
  const [fileName, setFileName] = useState<string | undefined>(undefined);
  // A story left open in the editor, offered back on the landing page.
  const [draft, setDraft] = useState<Draft | null>(null);
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

  const open = useCallback(async (input: Blob | Promise<Blob>, keepUrl: boolean, name?: string) => {
    setError(null);
    setLoading(true);
    try {
      const pkg = await readStoryZip(await input);
      release();
      setInitialSlide(slideFromHash(pkg));
      setStory(pkg);
      setFileName(name);
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
    if (!src) {
      void loadDraft().then(setDraft);
      return;
    }
    void open(
      fetch(new URL(src, location.href)).then((res) => {
        if (!res.ok) throw new Error(`Couldn't fetch ${src} (${res.status}).`);
        return res.blob();
      }).catch((err) => {
        throw new Error(err instanceof TypeError ? `Couldn't fetch ${src}. If it's on another website, that site has to allow it (CORS).` : errorText(err));
      }),
      true,
      decodeURIComponent(src.split("/").pop() || "") || undefined,
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

  // Hands the open story to the editor page, as its draft. Asks first if
  // that would replace a different story with changes nobody saved.
  const edit = async () => {
    if (!story) return;
    const existing = await loadDraft();
    if (existing && JSON.stringify(existing.doc) !== existing.savedJson
      && !window.confirm(`Replace the unsaved changes to "${existing.doc.title}" in the editor?`)) return;
    const doc = story.doc;
    await saveDraft({ doc, files: story.files, fileName, savedJson: JSON.stringify(doc), updated: Date.now() });
    location.href = "edit.html";
  };

  const close = () => {
    release();
    void loadDraft().then(setDraft);
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
          brand={<ViewerBrand href={location.pathname} target="_self" />}
          actions={<button type="button" className="bar-button" onClick={() => void edit()}>Edit</button>}
        />
      </div>
    );
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void open(file, false, file.name);
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
        <h1><ViewerIcon size={36} />Gramps Connect Story Viewer</h1>
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
              if (file) void open(file, false, file.name);
            }}
          />
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        <p className="small" style={{ marginTop: 12 }}>
          {draft
            ? <>Continue editing <a href="edit.html">{draft.doc.title}</a>, or <a href="edit.html?new">start a new story</a>.</>
            : <>Or <a href="edit.html?new">make a new story</a> in the Story Editor.</>}
        </p>

        <p className="small" style={{ marginTop: 16 }}>
          Your story stays on your computer: nothing is uploaded. Only the map's background comes from the internet
          (OpenFreeMap and OpenHistoricalMap). Use the arrow keys or swipe to move between slides, and F for full
          screen.
        </p>

        <h2>Examples</h2>
        <ul>
          {DEMOS.map((demo) => (
            <li key={demo.file}>
              <a href={`?src=demos/${demo.file}.story.zip`}>{demo.label}</a> <span className="small">— {demo.about}</span>
            </li>
          ))}
        </ul>

        <h2>Making a story</h2>
        <p>
          In <a href="https://github.com/dsblank/gramps-connect">Gramps Connect</a>, open a story and choose{" "}
          <b>Download</b>. To change a story, open it here and
          choose <b>Edit</b>, or start one from scratch in the <a href="edit.html">Story Editor</a>. Other programs
          can write stories too: the format is open and documented.
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
