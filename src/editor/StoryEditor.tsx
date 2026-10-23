// Edits a story document: a list of slides on the left, the selected
// slide's (or the story's own) fields in the middle, and the real player
// on the right showing that slide as it's changed. Works on the document
// only -- opening and saving files is the host's (the viewer site's editor
// page does it with the File System Access API or a download).
//
// Needs Mantine: wrap it in a MantineProvider and load @mantine/core's
// stylesheet, as with any Mantine component.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActionIcon, Badge, Box, Button, Divider, Group, Modal, Popover, Select, Stack, Text, TextInput, Tooltip, UnstyledButton,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import type { MediaItem, Slide, SlideMedia, StoryDoc } from "../types";
import { optimizeImage } from "../image";
import { validate, type StoryIssue } from "../validate";
import { storyPlaces } from "../player/geo";
import { StoryPlayer } from "../player/StoryPlayer";
import type { PlayerStrings } from "../player/strings";
import { suggestEdtf, type DateTextParser } from "./dates";
import { DateField } from "./DateField";
import {
  addImage, addSlide, deleteSlide, findMedia, duplicateSlide, moveSlide, record, redo, setSlidePhotos, startHistory, storyPlaceChoices,
  undo, updateMedia, updateSlide, updateStory, type History, type NewImage,
} from "./model";
import { PhotosField } from "./PhotosField";
import { PlaceField, type PlaceUpdate } from "./PlaceField";
import { WIKIDATA_PLACE_SEARCH, type PlaceSearch } from "./placeSearch";
import { SlideList } from "./SlideList";
import { StoryTextField } from "./StoryTextField";
import { EDITOR_ENGLISH, type EditorStrings } from "./strings";

const BAR_HEIGHT = 56;
/** The story's own settings, in place of a slide index. */
const STORY = -1;

export interface StoryEditorProps {
  /** The story to start from, and its files (paths as in media `src`).
   * Changing these later has no effect: remount (a new `key`) to edit
   * another story. */
  initialStory: StoryDoc;
  initialFiles?: Map<string, Uint8Array>;
  /** Called with the document and its files after every change, undo and
   * redo included. The files only grow while editing (an undone photo's
   * file stays); pruneMedia leaves out what nothing uses when saving. */
  onChange?: (doc: StoryDoc, files: Map<string, Uint8Array>) => void;
  /** Turns a chosen image file into what's stored. By default
   * optimizeImage: 1600px WebP (JPEG where the browser can't), with the
   * original's metadata left behind. */
  prepareImage?: (file: Blob) => Promise<NewImage>;
  /** The host's own buttons (Open, Save, ...), at the right of the top bar. */
  toolbar?: ReactNode;
  /** Shown first in the top bar, e.g. ViewerBrand. */
  brand?: ReactNode;
  dark?: boolean;
  strings?: Partial<EditorStrings>;
  playerStrings?: Partial<PlayerStrings>;
  /** Date text -> EDTF. By default gramps-date, in the story's language. */
  parseDateText?: DateTextParser;
  /** Finding a place by name. By default Wikidata, and only when the
   * person asks; null leaves the search out. */
  placeSearch?: PlaceSearch | null;
}

/** The slide an issue's JSON Pointer is about, or STORY. */
function issueSlide(issue: StoryIssue): number {
  const match = /^\/slides\/(\d+)/.exec(issue.path);
  return match ? Number(match[1]) : STORY;
}

type Resolve = (key: string, item: MediaItem) => Promise<string | null>;

/** The default prepareImage. */
export async function prepareImage(file: Blob): Promise<NewImage> {
  const image = await optimizeImage(file);
  return { data: new Uint8Array(await image.blob.arrayBuffer()), mime: image.mime, ext: image.ext, width: image.width, height: image.height };
}

function Thumb({ doc, slide, resolveMedia }: { doc: StoryDoc; slide: Slide; resolveMedia: Resolve }) {
  const ref = slide.media?.[0]?.ref;
  const item = ref && Object.prototype.hasOwnProperty.call(doc.media, ref) ? doc.media[ref] : undefined;
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (ref && item) void resolveMedia(ref, item).then((u) => { if (live) setUrl(u); });
    return () => { live = false; };
  }, [ref, item, resolveMedia]);
  return (
    <Box
      w={40} h={40}
      style={{ flex: "none", borderRadius: 4, background: "var(--mantine-color-default-hover)", overflow: "hidden" }}
    >
      {url && <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
    </Box>
  );
}

export function StoryEditor({
  initialStory, initialFiles, onChange, prepareImage: prepare = prepareImage, toolbar, brand, dark = false,
  strings: stringOverrides, playerStrings, parseDateText = suggestEdtf, placeSearch = WIKIDATA_PLACE_SEARCH,
}: StoryEditorProps) {
  const strings = useMemo(() => ({ ...EDITOR_ENGLISH, ...stringOverrides }), [stringOverrides]);
  const [history, setHistory] = useState<History>(() => startHistory(initialStory));
  const [selected, setSelected] = useState(0);
  const [presenting, setPresenting] = useState(false);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const wide = useMediaQuery("(min-width: 1000px)", true);
  const doc = history.present;
  const [files, setFiles] = useState(() => new Map(initialFiles ?? []));
  const [busy, setBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  // The latest of each, for work that finishes after a render (photos).
  const docRef = useRef(doc);
  docRef.current = doc;
  const filesRef = useRef(files);
  filesRef.current = files;

  // A blob: URL per stored file, made once and released with the editor.
  const urls = useRef(new Map<string, string>());
  useEffect(() => () => {
    for (const url of urls.current.values()) URL.revokeObjectURL(url);
  }, []);
  const resolveMedia = useCallback<Resolve>(async (_key, item) => {
    const cached = urls.current.get(item.src);
    if (cached) return cached;
    const data = filesRef.current.get(item.src);
    if (!data) return null;
    const url = URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>], { type: item.mime }));
    urls.current.set(item.src, url);
    return url;
  }, []);
  const urlFor = useCallback((key: string) => {
    const item = Object.prototype.hasOwnProperty.call(docRef.current.media, key) ? docRef.current.media[key] : undefined;
    return item ? resolveMedia(key, item) : Promise.resolve(null);
  }, [resolveMedia]);

  // Every change goes through here (and so into history and to the host).
  const apply = useCallback((next: StoryDoc, key?: string) => {
    setHistory((h) => record(h, next, key));
  }, []);
  useEffect(() => { onChange?.(doc, files); }, [doc, files, onChange]);

  const index = selected === STORY ? STORY : Math.min(selected, doc.slides.length - 1);
  const slide = index === STORY ? undefined : doc.slides[index];
  const setSlide = (patch: Partial<Slide>, key: string) => {
    if (index !== STORY) apply(updateSlide(history.present, index, patch), `${slide!.id}:${key}`);
  };

  // A place change applies to the slide as it is by then: a name typed and
  // a place picked in the same moment both land.
  const setPlace = (slideId: string, update: PlaceUpdate, key: string) => {
    setHistory((h) => {
      const at = h.present.slides.findIndex((s) => s.id === slideId);
      if (at < 0) return h;
      const before = h.present.slides[at].place;
      const after = update(before);
      return after === before ? h : record(h, updateSlide(h.present, at, { place: after }), `${slideId}:${key}`);
    });
  };
  const placeChoices = useMemo(() => storyPlaceChoices(doc, index), [doc, index]);
  const around = useMemo(() => storyPlaces(doc.slides.map((s) => s.place))?.bounds ?? null, [doc.slides]);

  const issues = useMemo(() => validate(doc, files).errors, [doc, files]);

  /** Prepares image files and puts them on a slide: added at the end, or
   * in place of photo `replace` (keeping its caption and credit). */
  const addPhotos = useCallback(async (chosen: File[], slideId: string, replace?: number) => {
    setBusy(true);
    setPhotoError(null);
    // A file already in the story (chosen again) is used as it is;
    // anything else is prepared first.
    const chosenImages: (NewImage | string)[] = [];
    for (const file of chosen) {
      try {
        const known = findMedia(docRef.current, filesRef.current, new Uint8Array(await file.arrayBuffer()));
        chosenImages.push(known ?? await prepare(file));
      } catch {
        setPhotoError(strings.photoFailed(file.name || "the image"));
      }
    }
    setBusy(false);
    if (!chosenImages.length) return;
    let next = docRef.current;
    let nextFiles = filesRef.current;
    const keys: string[] = [];
    for (const image of chosenImages) {
      if (typeof image === "string") {
        keys.push(image);
        continue;
      }
      const added = addImage(next, nextFiles, image);
      next = added.doc;
      nextFiles = added.files;
      keys.push(added.key);
    }
    const at = next.slides.findIndex((s) => s.id === slideId);
    if (at < 0) return;
    const photos: SlideMedia[] = [...(next.slides[at].media ?? [])];
    if (replace !== undefined && photos[replace]) photos[replace] = { ...photos[replace], ref: keys[0] };
    else photos.push(...keys.map((ref) => ({ ref })));
    setFiles(nextFiles);
    apply(setSlidePhotos(next, at, photos));
  }, [apply, prepare, strings]);

  // Pasting an image (outside a text field) adds it to the slide.
  const slideId = slide?.id;
  useEffect(() => {
    if (!slideId) return;
    const onPaste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest("input, textarea, [contenteditable=true]")) return;
      const images = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (!images.length) return;
      e.preventDefault();
      void addPhotos(images, slideId);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [slideId, addPhotos]);

  // Undo/redo from the keyboard, except where a text field has its own.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable=true]")) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) { e.preventDefault(); setHistory(undo); }
      else if ((key === "z" && e.shiftKey) || key === "y") { e.preventDefault(); setHistory(redo); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const slideActions = slide && (
    <Group gap={6}>
      <Tooltip label={strings.moveUp}>
        <ActionIcon variant="default" aria-label={strings.moveUp} disabled={index === 0}
          onClick={() => { apply(moveSlide(doc, index, index - 1)); setSelected(index - 1); }}>↑</ActionIcon>
      </Tooltip>
      <Tooltip label={strings.moveDown}>
        <ActionIcon variant="default" aria-label={strings.moveDown} disabled={index === doc.slides.length - 1}
          onClick={() => { apply(moveSlide(doc, index, index + 1)); setSelected(index + 1); }}>↓</ActionIcon>
      </Tooltip>
      <Button variant="default" size="xs" onClick={() => { const r = duplicateSlide(doc, index); apply(r.doc); setSelected(r.index); }}>
        {strings.duplicateSlide}
      </Button>
      <Button variant="default" size="xs" color="red" disabled={doc.slides.length <= 1}
        onClick={() => { const r = deleteSlide(doc, index); apply(r.doc); setSelected(r.index); }}>
        {strings.deleteSlide}
      </Button>
    </Group>
  );

  const storyForm = (
    <Stack gap="md">
      <Text fw={600} size="lg">{strings.story}</Text>
      <TextInput
        label={strings.title} required value={doc.title}
        onChange={(e) => apply(updateStory(doc, { title: e.currentTarget.value }), "story:title")}
      />
      <TextInput
        label={strings.language} description={strings.languageHint} w={260} value={doc.language ?? ""}
        onChange={(e) => apply(updateStory(doc, { language: e.currentTarget.value.trim() || undefined }), "story:language")}
      />
      <Select
        label={strings.map} w={320} allowDeselect={false}
        data={[
          { value: "auto", label: strings.mapAuto },
          { value: "standard", label: strings.mapStandard },
          { value: "historical", label: strings.mapHistorical },
          { value: "none", label: strings.mapNone },
        ]}
        value={doc.presentation?.basemap ?? "auto"}
        onChange={(value) => value && apply(updateStory(doc, {
          presentation: { ...doc.presentation, basemap: value as NonNullable<StoryDoc["presentation"]>["basemap"] },
        }))}
      />
    </Stack>
  );

  const slideForm = slide && (
    <Stack gap="md" key={slide.id}>
      <Group justify="space-between" wrap="wrap" gap="xs">
        <Text fw={600} size="lg">{index === 0 ? strings.openingSlide : `${index + 1} / ${doc.slides.length}`}</Text>
        {slideActions}
      </Group>
      <TextInput
        label={strings.slideTitle} value={slide.title ?? ""}
        onChange={(e) => setSlide({ title: e.currentTarget.value || undefined }, "title")}
      />
      <DateField
        value={slide.date} language={doc.language} parse={parseDateText} strings={strings}
        onChange={(date) => setSlide({ date }, "date")}
      />
      <StoryTextField
        label={strings.text} value={slide.text ?? ""} boldLabel={strings.bold} italicLabel={strings.italic} minRows={5}
        onChange={(text) => setSlide({ text: text || undefined }, "text")}
      />
      <PlaceField
        place={slide.place} choices={placeChoices} around={around} language={doc.language} search={placeSearch} dark={dark} strings={strings}
        onChange={(update, key) => setPlace(slide.id, update, key)}
      />
      <PhotosField
        photos={slide.media ?? []} media={doc.media} urlFor={urlFor} strings={strings} busy={busy}
        onChange={(photos, key) => apply(setSlidePhotos(doc, index, photos), `${slide.id}:${key}`)}
        onFiles={(chosen, replace) => void addPhotos(chosen, slide.id, replace)}
        onDescription={(key, alt) => apply(updateMedia(doc, key, { alt: alt || undefined }), `media:${key}:alt`)}
      />
      {photoError && <Text size="xs" c="red" role="alert">{photoError}</Text>}
    </Stack>
  );

  const list = (
    <Stack gap="xs">
      <UnstyledButton
        onClick={() => setSelected(STORY)}
        style={{ padding: "8px", borderRadius: 6, background: index === STORY ? "var(--mantine-primary-color-light)" : undefined }}
      >
        <Text fw={600} size="sm">{strings.story}</Text>
        <Text size="xs" c="dimmed">{strings.storySettings}</Text>
      </UnstyledButton>
      <Divider label={strings.slides} labelPosition="left" />
      <SlideList
        label={strings.slides}
        items={doc.slides}
        selected={index}
        onSelect={setSelected}
        onMove={(from, to) => { apply(moveSlide(doc, from, to)); setSelected(to); }}
        getKey={(s) => s.id}
        renderItem={(s, i) => (
          <Group gap="sm" wrap="nowrap">
            <Thumb doc={doc} slide={s} resolveMedia={resolveMedia} />
            <Box style={{ minWidth: 0 }}>
              <Text size="sm" fw={500} truncate dir="auto" c={s.title ? undefined : "dimmed"}>
                {s.title || strings.untitledSlide}
              </Text>
              <Text size="xs" c="dimmed" truncate>{i === 0 ? strings.openingSlide : s.date?.text ?? ""}</Text>
            </Box>
          </Group>
        )}
      />
      <Button
        variant="light" size="xs" mt={4}
        onClick={() => { const r = addSlide(doc, index === STORY ? doc.slides.length - 1 : index); apply(r.doc); setSelected(r.index); }}
      >
        + {strings.addSlide}
      </Button>
    </Stack>
  );

  const preview = (
    <Box style={{ position: "relative", height: wide ? "100%" : 460, borderRadius: 8, overflow: "hidden", border: "1px solid var(--mantine-color-default-border)" }}>
      <StoryPlayer
        story={doc} resolveMedia={resolveMedia} dark={dark} strings={playerStrings}
        keyboard={false} initialSlide={index === STORY ? 0 : index}
        onSlideChange={(i) => { if (i !== index && index !== STORY) setSelected(i); }}
      />
    </Box>
  );

  const column = (children: ReactNode, width?: number | string) => (
    <Box
      style={{
        width, flex: width ? "none" : 1, minWidth: 0, padding: 16,
        overflowY: wide ? "auto" : undefined, height: wide ? "100%" : undefined,
      }}
    >
      {children}
    </Box>
  );

  return (
    <Box style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Group
        h={BAR_HEIGHT} px="md" gap="sm" wrap="nowrap" justify="space-between"
        style={{ flex: "none", borderBottom: "1px solid var(--mantine-color-default-border)" }}
      >
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
          {brand}
          <Text fw={600} truncate dir="auto">{doc.title}</Text>
        </Group>
        <Group gap="xs" wrap="nowrap">
          {issues.length > 0 && (
            <Popover opened={problemsOpen} onChange={setProblemsOpen} width={360} position="bottom-end" withArrow>
              <Popover.Target>
                <Badge color="red" variant="light" style={{ cursor: "pointer" }} onClick={() => setProblemsOpen((o) => !o)}>
                  {strings.problems(issues.length)}
                </Badge>
              </Popover.Target>
              <Popover.Dropdown>
                <Stack gap={6}>
                  {issues.map((issue, i) => {
                    const at = issueSlide(issue);
                    return (
                      <UnstyledButton key={i} onClick={() => { setSelected(at); setProblemsOpen(false); }}>
                        <Text size="sm" fw={500}>{at === STORY ? strings.story : (doc.slides[at]?.title || `${strings.untitledSlide} ${at + 1}`)}</Text>
                        <Text size="xs" c="dimmed">{issue.path} {issue.message}</Text>
                      </UnstyledButton>
                    );
                  })}
                </Stack>
              </Popover.Dropdown>
            </Popover>
          )}
          <Tooltip label={strings.undo}>
            <ActionIcon variant="default" size="lg" aria-label={strings.undo} disabled={history.past.length === 0} onClick={() => setHistory(undo)}>↶</ActionIcon>
          </Tooltip>
          <Tooltip label={strings.redo}>
            <ActionIcon variant="default" size="lg" aria-label={strings.redo} disabled={history.future.length === 0} onClick={() => setHistory(redo)}>↷</ActionIcon>
          </Tooltip>
          <Button variant="default" onClick={() => setPresenting(true)}>{strings.present}</Button>
          {toolbar}
        </Group>
      </Group>
      <Box
        style={{
          flex: 1, minHeight: 0, display: "flex", flexDirection: wide ? "row" : "column",
          overflowY: wide ? undefined : "auto",
        }}
      >
        {column(list, wide ? 280 : undefined)}
        {column(index === STORY ? storyForm : slideForm, wide ? "min(520px, 36%)" : undefined)}
        {column(preview)}
      </Box>
      <Modal opened={presenting} onClose={() => setPresenting(false)} fullScreen withCloseButton={false} padding={0}>
        <Box style={{ position: "fixed", inset: 0 }}>
          <StoryPlayer
            story={doc} resolveMedia={resolveMedia} dark={dark} strings={playerStrings}
            initialSlide={index === STORY ? 0 : index} onClose={() => setPresenting(false)}
          />
        </Box>
      </Modal>
    </Box>
  );
}
