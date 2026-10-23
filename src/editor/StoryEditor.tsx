// Edits a story document: a list of slides on the left, the selected
// slide's (or the story's own) fields in the middle, and the real player
// on the right showing that slide as it's changed. Works on the document
// only -- opening and saving files is the host's (the viewer site's editor
// page does it with the File System Access API or a download).
//
// Needs Mantine: wrap it in a MantineProvider and load @mantine/core's
// stylesheet, as with any Mantine component.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ActionIcon, Badge, Box, Button, Divider, Group, Modal, Popover, Select, Stack, Text, TextInput, Tooltip, UnstyledButton,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import type { MediaItem, Slide, StoryDoc } from "../types";
import { validate, type StoryIssue } from "../validate";
import { StoryPlayer } from "../player/StoryPlayer";
import type { PlayerStrings } from "../player/strings";
import { suggestEdtf, type DateTextParser } from "./dates";
import { DateField } from "./DateField";
import {
  addSlide, deleteSlide, duplicateSlide, moveSlide, record, redo, startHistory, undo, updateSlide, updateStory,
  type History,
} from "./model";
import { SlideList } from "./SlideList";
import { StoryTextField } from "./StoryTextField";
import { EDITOR_ENGLISH, type EditorStrings } from "./strings";

const BAR_HEIGHT = 56;
/** The story's own settings, in place of a slide index. */
const STORY = -1;

export interface StoryEditorProps {
  /** The story to start from. Changing it later has no effect: remount
   * (a new `key`) to edit another. */
  initialStory: StoryDoc;
  /** The story's files, for checking that every media file is there. */
  files?: { has(path: string): boolean };
  /** As for StoryPlayer. */
  resolveMedia: (key: string, item: MediaItem) => Promise<string | null>;
  /** Called with the document after every change, undo and redo included. */
  onChange?: (doc: StoryDoc) => void;
  /** The host's own buttons (Open, Save, ...), at the right of the top bar. */
  toolbar?: ReactNode;
  /** Shown first in the top bar, e.g. ViewerBrand. */
  brand?: ReactNode;
  dark?: boolean;
  strings?: Partial<EditorStrings>;
  playerStrings?: Partial<PlayerStrings>;
  /** Date text -> EDTF. By default gramps-date, in the story's language. */
  parseDateText?: DateTextParser;
}

/** The slide an issue's JSON Pointer is about, or STORY. */
function issueSlide(issue: StoryIssue): number {
  const match = /^\/slides\/(\d+)/.exec(issue.path);
  return match ? Number(match[1]) : STORY;
}

function Thumb({ doc, slide, resolveMedia }: { doc: StoryDoc; slide: Slide; resolveMedia: StoryEditorProps["resolveMedia"] }) {
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
  initialStory, files, resolveMedia, onChange, toolbar, brand, dark = false, strings: stringOverrides, playerStrings,
  parseDateText = suggestEdtf,
}: StoryEditorProps) {
  const strings = useMemo(() => ({ ...EDITOR_ENGLISH, ...stringOverrides }), [stringOverrides]);
  const [history, setHistory] = useState<History>(() => startHistory(initialStory));
  const [selected, setSelected] = useState(0);
  const [presenting, setPresenting] = useState(false);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const wide = useMediaQuery("(min-width: 1000px)", true);
  const doc = history.present;

  // Every change goes through here (and so into history and to the host).
  const apply = useCallback((next: StoryDoc, key?: string) => {
    setHistory((h) => record(h, next, key));
  }, []);
  useEffect(() => { onChange?.(doc); }, [doc, onChange]);

  const index = selected === STORY ? STORY : Math.min(selected, doc.slides.length - 1);
  const slide = index === STORY ? undefined : doc.slides[index];
  const setSlide = (patch: Partial<Slide>, key: string) => {
    if (index !== STORY) apply(updateSlide(history.present, index, patch), `${slide!.id}:${key}`);
  };

  const issues = useMemo(() => validate(doc, files).errors, [doc, files]);

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
      {slide.place && (
        <Stack gap={2}>
          <Text size="sm" fw={500}>{strings.place}</Text>
          <Text size="sm">
            {slide.place.name ?? ""}
            {slide.place.lat !== undefined && slide.place.lon !== undefined && (
              <Text span c="dimmed" size="sm"> {slide.place.lat.toFixed(4)}, {slide.place.lon.toFixed(4)}</Text>
            )}
          </Text>
        </Stack>
      )}
      {slide.media && slide.media.length > 0 && (
        <Stack gap={4}>
          <Text size="sm" fw={500}>{strings.photos}</Text>
          <Group gap="sm">
            {slide.media.map((m, i) => (
              <Group key={i} gap="xs" wrap="nowrap">
                <Thumb doc={doc} slide={{ id: "", media: [m] }} resolveMedia={resolveMedia} />
                <Text size="xs" c="dimmed" maw={200} lineClamp={2}>{m.caption ?? ""}</Text>
              </Group>
            ))}
          </Group>
        </Stack>
      )}
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
