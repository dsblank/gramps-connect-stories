// A slide's map, full screen: the shapes under its pin (drawn, or imported
// from a KML, GPX or GeoJSON file) and scanned old maps laid over it, each
// with the years it shows. Works on a copy: Done hands the editor the
// place and any images added, as one change; Cancel drops them.
import { useMemo, useRef, useState } from "react";
import { ActionIcon, Box, Button, Group, Modal, Stack, Text, TextInput, Tooltip } from "@mantine/core";
import type { MediaItem, Place, StoryDate, StoryDoc } from "../types";
import { optimizeImage } from "../image";
import { parseMapFile } from "../mapEdit";
import { storyPlaces } from "../player/geo";
import { edtfYearRange } from "../player/dates";
import type { DateTextParser } from "./dates";
import { MapEditor, MapEditorHelp, type MapEditorHandle } from "./MapEditor";
import type { MapEditorStrings } from "./mapEditorStrings";
import { addImage, slideDate, type NewImage } from "./model";
import { editorToPlace, placeToEditor } from "./placeShapes";
import type { EditorStrings } from "./strings";

const BAR_HEIGHT = 56;

/** Where the map editor's English is Gramps Connect's (images come from
 * its media there), the story editor's own. */
const STORY_MAP_WORDS: Partial<MapEditorStrings> = {
  helpImage: "Image: add a picture file, such as a scan of an old map -- see",
};

export interface PlaceMapDialogProps {
  place: Place | undefined;
  doc: StoryDoc;
  files: Map<string, Uint8Array>;
  dark?: boolean;
  parseDateText: DateTextParser;
  strings: EditorStrings;
  mapStrings?: Partial<MapEditorStrings>;
  onCancel: () => void;
  /** The place as edited, and the story's media and files with any images
   * added here. */
  onDone: (place: Place | undefined, media: Record<string, MediaItem>, files: Map<string, Uint8Array>) => void;
}

/** The default way an old map's scan is stored: 2048px, PNG when it has
 * transparency (see optimizeImage's "overlay" purpose). */
async function prepareOverlay(file: Blob): Promise<NewImage> {
  const image = await optimizeImage(file, { purpose: "overlay" });
  return { data: new Uint8Array(await image.blob.arrayBuffer()), mime: image.mime, ext: image.ext, width: image.width, height: image.height };
}

/** An overlay's years, as readers would write them; the precise form
 * follows. Narrow, for the map editor's side panel. */
function OverlayDateField({ value, language, parse, strings, onChange }: {
  value: StoryDate | undefined;
  language: string | undefined;
  parse: DateTextParser;
  strings: EditorStrings;
  onChange: (date: StoryDate | undefined) => void;
}) {
  const [text, setText] = useState(value?.text ?? "");
  const request = useRef(0);
  const edtf = value?.edtf;
  return (
    <Stack gap={2} maw={220}>
      <TextInput
        size="xs" label={strings.overlayDate} description={strings.overlayDateHint} value={text}
        onChange={(e) => {
          const typed = e.currentTarget.value;
          setText(typed);
          const id = ++request.current;
          if (!typed.trim()) { onChange(undefined); return; }
          void parse(typed, language).then((parsed) => {
            if (id === request.current) onChange(slideDate(value, typed, parsed));
          });
        }}
      />
      {text.trim() && (
        <Text size="xs" c={edtf && edtfYearRange(edtf) ? "dimmed" : "red"}>
          {edtf && edtfYearRange(edtf) ? `EDTF ${edtf}` : strings.preciseDateNotUnderstood}
        </Text>
      )}
    </Stack>
  );
}

export function PlaceMapDialog({
  place, doc, files, dark, parseDateText, strings, mapStrings: mapStringOverrides, onCancel, onDone,
}: PlaceMapDialogProps) {
  const mapStrings = { ...STORY_MAP_WORDS, ...mapStringOverrides };
  const editorRef = useRef<MapEditorHandle>(null);
  const initial = useMemo(() => placeToEditor(place), [place]);
  // The story's media and files with what's been added here.
  const [work, setWork] = useState({ doc, files });
  const workRef = useRef(work);
  workRef.current = work;
  // Each overlay's date by media key, once changed here.
  const [dates, setDates] = useState(() => new Map<string, StoryDate | undefined>());
  const [message, setMessage] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  const shapesInput = useRef<HTMLInputElement>(null);

  // Where to look with nothing to frame: the pin, or the story's places.
  const initialView = useMemo(() => {
    if (place?.lat !== undefined && place.lon !== undefined) return { center: [place.lon, place.lat] as [number, number], zoom: 12 };
    const all = storyPlaces(doc.slides.map((s) => s.place));
    if (!all) return undefined;
    const [w, s, e, n] = all.bounds;
    return { center: [(w + e) / 2, (s + n) / 2] as [number, number], zoom: 5 };
  }, [place, doc]);

  const resolveImage = async (key: string) => {
    const item = Object.prototype.hasOwnProperty.call(workRef.current.doc.media, key) ? workRef.current.doc.media[key] : undefined;
    const data = item && workRef.current.files.get(item.src);
    if (!item || !data) throw new Error(strings.photoFailed(key));
    return URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>], { type: item.mime }));
  };

  const addImages = async (chosen: File[]) => {
    setMessage(null);
    for (const file of chosen) {
      let key: string;
      try {
        const added = addImage(workRef.current.doc, workRef.current.files, await prepareOverlay(file), "map");
        workRef.current = { doc: added.doc, files: added.files };
        setWork(workRef.current);
        key = added.key;
      } catch {
        setMessage(strings.photoFailed(file.name || "the image"));
        continue;
      }
      try {
        if (!(await editorRef.current?.addImage(key))) setMessage(strings.overlayAlready);
      } catch (err) {
        setMessage(err instanceof Error ? err.message : String(err));
      }
    }
  };

  const importShapes = async (chosen: File[]) => {
    setMessage(null);
    for (const file of chosen) {
      try {
        // A KML GroundOverlay's picture lives outside the file; only shapes
        // come in.
        const features = parseMapFile(await file.text()).filter((f) => f.properties?.["@geometry-type"] !== "groundoverlay");
        if (features.length === 0) setMessage(strings.importNothing(file.name));
        else editorRef.current?.addFeatures(features);
      } catch {
        setMessage(strings.importFailed(file.name));
      }
    }
  };

  const done = () => {
    const editor = editorRef.current;
    if (!editor) return;
    onDone(editorToPlace(place, editor.getResult(), dates), workRef.current.doc.media, workRef.current.files);
  };

  const bar = dark ? "rgba(20,20,20,0.85)" : "rgba(255,255,255,0.9)";
  return (
    <Modal opened onClose={onCancel} fullScreen withCloseButton={false} closeOnEscape={false} padding={0}>
      <Box style={{ position: "fixed", inset: 0, overflow: "hidden" }}>
        <MapEditor
          ref={editorRef}
          initial={initial}
          initialView={initialView}
          resolveImage={resolveImage}
          releaseImage={(url) => URL.revokeObjectURL(url)}
          onAddImage={() => imageInput.current?.click()}
          onError={setMessage}
          dark={dark}
          toolbarTop={BAR_HEIGHT + 12}
          overlayNames={false}
          strings={mapStrings}
          renderOverlayOptions={(key) => (
            <OverlayDateField
              key={key}
              value={dates.has(key) ? dates.get(key) : place?.overlays?.find((o) => o.media === key)?.date}
              language={doc.language}
              parse={parseDateText}
              strings={strings}
              onChange={(date) => setDates((prev) => new Map(prev).set(key, date))}
            />
          )}
        />
        <Group
          justify="space-between" wrap="nowrap" px="md" gap="sm"
          style={{ position: "absolute", top: 0, left: 0, right: 0, height: BAR_HEIGHT, zIndex: 3, background: bar }}
        >
          <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
            <Text fw={600} truncate dir="auto">{strings.mapDialogTitle(place?.name)}</Text>
            <Tooltip label={strings.mapHelp}>
              <ActionIcon variant="subtle" radius="xl" aria-label={strings.mapHelp} onClick={() => setHelpOpen(true)}>ⓘ</ActionIcon>
            </Tooltip>
          </Group>
          <Group gap="xs" wrap="nowrap">
            <Tooltip label={strings.importShapesHint} multiline w={280}>
              <Button variant="default" size="sm" onClick={() => shapesInput.current?.click()}>{strings.importShapes}</Button>
            </Tooltip>
            <Button variant="default" size="sm" onClick={onCancel}>{strings.cancel}</Button>
            <Button size="sm" onClick={done}>{strings.done}</Button>
          </Group>
        </Group>
        {message && (
          <Text
            size="sm" role="alert"
            style={{
              position: "absolute", bottom: 12, left: 12, zIndex: 3, maxWidth: 480, padding: "6px 10px", borderRadius: 6,
              background: bar, color: "var(--mantine-color-red-filled)",
            }}
          >
            {message}
          </Text>
        )}
        <input
          ref={imageInput} type="file" accept="image/*" multiple hidden
          onChange={(e) => { const chosen = [...(e.currentTarget.files ?? [])]; e.currentTarget.value = ""; void addImages(chosen); }}
        />
        <input
          ref={shapesInput} type="file" accept=".kml,.gpx,.geojson,.json,application/vnd.google-earth.kml+xml,application/gpx+xml,application/geo+json" multiple hidden
          onChange={(e) => { const chosen = [...(e.currentTarget.files ?? [])]; e.currentTarget.value = ""; void importShapes(chosen); }}
        />
      </Box>
      <Modal opened={helpOpen} onClose={() => setHelpOpen(false)} title={strings.mapHelp} size="md" zIndex={1000}>
        <MapEditorHelp strings={mapStrings} />
      </Modal>
    </Modal>
  );
}
