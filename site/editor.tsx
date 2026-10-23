// The Story Editor page (edit.html): open a .story.zip (or start a new
// one), edit it, save it. Everything stays in the browser: the story being
// edited is kept as a draft here (drafts.ts) between visits, and saving
// writes a file on this computer -- back into the opened file where the
// browser allows it (Chrome, Edge), else as a download.
import "@mantine/core/styles.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as maplibregl from "maplibre-gl";
import { Alert, Button, Group, MantineProvider, Modal, Stack, Text, Title, useComputedColorScheme } from "@mantine/core";
import { readStoryZip, validate, writeStoryZip, type MediaItem, type StoryDoc } from "../src/index";
import { ViewerBrand, ViewerIcon } from "../src/player/index";
import { blankStory, pruneMedia, StoryEditor, storyFileName } from "../src/editor/index";
import { clearDraft, loadDraft, saveDraft, type Draft } from "./drafts";

maplibregl.setWorkerUrl(new URL("./maplibre-gl-worker.mjs", import.meta.url).href);

// The File System Access API, where the browser has it (not yet in
// TypeScript's DOM types).
interface FilePickerOptions {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}
interface PickerWindow {
  showOpenFilePicker?: (options?: FilePickerOptions) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (options?: FilePickerOptions) => Promise<FileSystemFileHandle>;
}
const picker = window as unknown as PickerWindow;
const STORY_FILES: FilePickerOptions["types"] = [{ description: "Story", accept: { "application/zip": [".zip"] } }];

const isAbort = (err: unknown) => err instanceof DOMException && err.name === "AbortError";
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

function newDraft(doc: StoryDoc, files: Map<string, Uint8Array>, fileName?: string, handle?: FileSystemFileHandle): Draft {
  return { doc, files, fileName, handle, savedJson: JSON.stringify(doc), updated: Date.now() };
}

async function draftFromFile(file: Blob, fileName?: string, handle?: FileSystemFileHandle): Promise<Draft> {
  const pkg = await readStoryZip(file);
  return newDraft(pkg.doc, pkg.files, fileName, handle);
}

function download(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/zip" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function Landing({ onOpen, onNew, error }: { onOpen: () => void; onNew: () => void; error: string | null }) {
  return (
    <Stack maw={560} mx="auto" px="md" py={48} gap="md">
      <Group gap="sm">
        <ViewerIcon size={36} />
        <Title order={1} size={28}>Story Editor</Title>
      </Group>
      <Text c="dimmed">
        Change a family-history story (<code>.story.zip</code>): its slides' titles, dates and text, and their order.
        Your story stays on your computer: nothing is uploaded.
      </Text>
      <Group>
        <Button onClick={onOpen}>Open a story…</Button>
        <Button variant="default" onClick={onNew}>New story</Button>
      </Group>
      {error && <Alert color="red" role="alert">{error}</Alert>}
      <Text size="sm"><a href="./">Back to the Story Viewer</a></Text>
    </Stack>
  );
}

function App() {
  const dark = useComputedColorScheme("light") === "dark";
  const [draft, setDraft] = useState<Draft | null | undefined>(undefined);
  // Remounts the editor (fresh undo history) for each newly opened story.
  const [generation, setGeneration] = useState(0);
  const [doc, setDoc] = useState<StoryDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<{ action: () => void } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const urls = useRef(new Map<string, string>());
  const draftRef = useRef<Draft | null>(null);
  draftRef.current = draft ?? null;

  const show = useCallback((next: Draft) => {
    for (const url of urls.current.values()) URL.revokeObjectURL(url);
    urls.current.clear();
    setError(null);
    setNotice(null);
    setDraft(next);
    setDoc(next.doc);
    setGeneration((g) => g + 1);
    document.title = `${next.doc.title} – Story Editor`;
    void saveDraft(next).then((kept) => {
      if (!kept) setNotice("This browser won't keep your changes between visits: save before closing the page.");
    });
  }, []);

  // ?src=<url> or ?new opens that; otherwise the draft from last time.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const src = params.get("src");
    const clean = () => history.replaceState(null, "", location.pathname);
    if (src) {
      fetch(new URL(src, location.href))
        .then((res) => {
          if (!res.ok) throw new Error(`Couldn't fetch ${src} (${res.status}).`);
          return res.blob();
        })
        .then((blob) => draftFromFile(blob, decodeURIComponent(src.split("/").pop() || "") || undefined))
        .then((next) => { clean(); show(next); })
        .catch((err) => { setError(errorText(err)); setDraft(null); });
    } else if (params.has("new")) {
      clean();
      show(newDraft(blankStory("Untitled story"), new Map()));
    } else {
      void loadDraft().then((saved) => {
        if (saved) show(saved);
        else setDraft(null);
      });
    }
  }, [show]);

  const unsaved = !!draft && !!doc && JSON.stringify(doc) !== draft.savedJson;
  const valid = useMemo(() => !!draft && !!doc && validate(doc, draft.files).valid, [doc, draft]);

  // Keep the draft as it's edited (a little after each change).
  useEffect(() => {
    const current = draftRef.current;
    if (!current || !doc || doc === current.doc) return;
    const timer = setTimeout(() => void saveDraft({ ...current, doc, updated: Date.now() }), 400);
    return () => clearTimeout(timer);
  }, [doc]);

  const resolveMedia = useCallback(async (key: string, item: MediaItem) => {
    const cached = urls.current.get(key);
    if (cached) return cached;
    const data = draftRef.current?.files.get(item.src);
    if (!data) return null;
    const url = URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>], { type: item.mime }));
    urls.current.set(key, url);
    return url;
  }, []);

  /** Runs `action` now, or after asking, when there are unsaved changes. */
  const guarded = (action: () => void) => (unsaved ? setConfirm({ action }) : action());

  const openFile = async () => {
    setError(null);
    if (picker.showOpenFilePicker) {
      try {
        const [handle] = await picker.showOpenFilePicker({ types: STORY_FILES });
        const file = await handle.getFile();
        show(await draftFromFile(file, file.name, handle));
      } catch (err) {
        if (!isAbort(err)) { setError(errorText(err)); setDraft((d) => d ?? null); }
      }
    } else {
      fileInput.current?.click();
    }
  };

  const save = async (as: boolean) => {
    if (!draft || !doc) return;
    setSaving(true);
    setNotice(null);
    try {
      const saved = pruneMedia(doc, draft.files);
      const bytes = await writeStoryZip(saved.doc, saved.files);
      const name = draft.fileName && !as ? draft.fileName : storyFileName(doc.title);
      let handle = as ? undefined : draft.handle;
      if (!handle && picker.showSaveFilePicker) {
        handle = await picker.showSaveFilePicker({ suggestedName: name, types: STORY_FILES });
      }
      let fileName = name;
      if (handle) {
        const writable = await (handle as FileSystemFileHandle & { createWritable(): Promise<WritableStream & { write(data: BufferSource): Promise<void>; close(): Promise<void> }> }).createWritable();
        await writable.write(bytes as Uint8Array<ArrayBuffer>);
        await writable.close();
        fileName = handle.name;
      } else {
        download(bytes, name);
      }
      const next: Draft = { ...draft, doc, fileName, handle, savedJson: JSON.stringify(doc), updated: Date.now() };
      setDraft(next);
      // Before saying so: leaving the page right after mustn't leave the
      // draft saying there are unsaved changes.
      await saveDraft(next);
      setNotice(handle ? `Saved to ${fileName}.` : `Downloaded ${fileName}.`);
    } catch (err) {
      if (!isAbort(err)) setNotice(`Couldn't save: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const toolbar = (
    <>
      {unsaved && <Text size="xs" c="dimmed" visibleFrom="sm">Unsaved changes</Text>}
      <Button variant="default" onClick={() => guarded(() => void openFile())}>Open…</Button>
      <Button variant="default" onClick={() => guarded(() => show(newDraft(blankStory("Untitled story", doc?.language), new Map())))}>New</Button>
      <Button onClick={() => void save(false)} disabled={!valid || saving} loading={saving}>Save</Button>
      {picker.showSaveFilePicker && (
        <Button variant="default" onClick={() => void save(true)} disabled={!valid || saving}>Save as…</Button>
      )}
      <Button
        variant="subtle"
        onClick={() => guarded(() => { void clearDraft().then(() => { location.href = "./"; }); })}
      >
        Close
      </Button>
    </>
  );

  return (
    <>
      <input
        ref={fileInput} type="file" accept=".zip,application/zip" hidden
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (file) draftFromFile(file, file.name).then(show).catch((err) => { setError(errorText(err)); setDraft((d) => d ?? null); });
        }}
      />
      {draft === null && <Landing onOpen={() => void openFile()} onNew={() => show(newDraft(blankStory("Untitled story"), new Map()))} error={error} />}
      {draft && (
        <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column" }}>
          {(notice || error) && (
            <Alert color={error ? "red" : "blue"} withCloseButton onClose={() => { setNotice(null); setError(null); }} radius={0} py={6} role="status">
              {error ?? notice}
            </Alert>
          )}
          <div style={{ flex: 1, minHeight: 0 }}>
            <StoryEditor
              key={generation}
              initialStory={draft.doc}
              files={draft.files}
              resolveMedia={resolveMedia}
              onChange={setDoc}
              dark={dark}
              brand={<ViewerBrand href="./" target="_self" />}
              toolbar={toolbar}
            />
          </div>
        </div>
      )}
      <Modal opened={!!confirm} onClose={() => setConfirm(null)} title="Discard unsaved changes?" centered>
        <Text size="sm" mb="md">The changes since you last saved this story will be lost.</Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setConfirm(null)}>Keep editing</Button>
          <Button color="red" onClick={() => { const action = confirm?.action; setConfirm(null); action?.(); }}>Discard</Button>
        </Group>
      </Modal>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <MantineProvider defaultColorScheme="auto">
    <App />
  </MantineProvider>,
);
