// A slide's photos: add (pick, drop or paste -- pasting is the editor's),
// replace, reorder and remove them, and write each one's caption, credit
// and description. The files themselves are the editor's to prepare and
// store; this only says what was chosen.
import { useEffect, useRef, useState, type DragEvent } from "react";
import { ActionIcon, Box, Button, Group, Loader, Stack, Text, TextInput, Tooltip } from "@mantine/core";
import type { MediaItem, SlideMedia } from "../types";
import type { EditorStrings } from "./strings";

export interface PhotosFieldProps {
  photos: SlideMedia[];
  media: Record<string, MediaItem>;
  /** A displayable URL for a media key. */
  urlFor: (key: string) => Promise<string | null>;
  strings: EditorStrings;
  /** True while chosen files are being prepared. */
  busy?: boolean;
  onChange: (photos: SlideMedia[], key: string) => void;
  /** Image files to add at the end, or to put in place of photo `replace`. */
  onFiles: (files: File[], replace?: number) => void;
  onDescription: (mediaKey: string, alt: string) => void;
}

const imagesIn = (list: FileList | null | undefined) => [...(list ?? [])].filter((f) => f.type.startsWith("image/"));

function Preview({ mediaKey, urlFor }: { mediaKey: string; urlFor: PhotosFieldProps["urlFor"] }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void urlFor(mediaKey).then((u) => { if (live) setUrl(u); });
    return () => { live = false; };
  }, [mediaKey, urlFor]);
  return (
    <Box w={96} h={96} style={{ flex: "none", borderRadius: 6, overflow: "hidden", background: "var(--mantine-color-default-hover)" }}>
      {url && <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
    </Box>
  );
}

export function PhotosField({ photos, media, urlFor, strings, busy, onChange, onFiles, onDescription }: PhotosFieldProps) {
  const input = useRef<HTMLInputElement>(null);
  const replacing = useRef<number | undefined>(undefined);
  const [dropping, setDropping] = useState(false);

  const pick = (replace?: number) => {
    replacing.current = replace;
    input.current?.click();
  };
  const set = (i: number, patch: Partial<SlideMedia>, field: string) => {
    const next = photos.map((p, j) => {
      if (j !== i) return p;
      const changed: Record<string, unknown> = { ...p, ...patch };
      for (const [k, v] of Object.entries(patch)) if (!v) delete changed[k];
      return changed as unknown as SlideMedia;
    });
    onChange(next, `photo:${i}:${field}`);
  };
  const move = (from: number, to: number) => {
    const next = [...photos];
    const [p] = next.splice(from, 1);
    next.splice(to, 0, p);
    onChange(next, "photos");
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDropping(false);
    const files = imagesIn(e.dataTransfer.files);
    if (files.length) onFiles(files);
  };

  return (
    <Stack
      gap="sm"
      onDragOver={(e) => { if ([...e.dataTransfer.types].includes("Files")) { e.preventDefault(); setDropping(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDropping(false); }}
      onDrop={onDrop}
      style={{
        borderRadius: 8, padding: dropping ? 8 : 0, margin: dropping ? -8 : 0,
        outline: dropping ? "2px dashed var(--mantine-primary-color-filled)" : undefined,
      }}
    >
      <Group justify="space-between">
        <Text size="sm" fw={500}>{strings.photos}</Text>
        <Group gap="xs">
          {busy && <Loader size="xs" />}
          <Button variant="default" size="xs" onClick={() => pick()} disabled={busy}>+ {strings.addPhoto}</Button>
        </Group>
      </Group>
      <input
        ref={input} type="file" accept="image/*" multiple hidden
        onChange={(e) => {
          const files = imagesIn(e.currentTarget.files);
          e.currentTarget.value = "";
          if (files.length) onFiles(replacing.current === undefined ? files : files.slice(0, 1), replacing.current);
        }}
      />
      {photos.length === 0 && <Text size="xs" c="dimmed">{strings.photosHint}</Text>}
      {photos.map((photo, i) => {
        const item = Object.prototype.hasOwnProperty.call(media, photo.ref) ? media[photo.ref] : undefined;
        return (
          <Group key={i} gap="sm" align="flex-start" wrap="nowrap">
            <Stack gap={4} align="center">
              <Preview mediaKey={photo.ref} urlFor={urlFor} />
              <Group gap={4}>
                <Tooltip label={strings.movePhotoUp}>
                  <ActionIcon size="sm" variant="default" aria-label={strings.movePhotoUp} disabled={i === 0} onClick={() => move(i, i - 1)}>↑</ActionIcon>
                </Tooltip>
                <Tooltip label={strings.movePhotoDown}>
                  <ActionIcon size="sm" variant="default" aria-label={strings.movePhotoDown} disabled={i === photos.length - 1} onClick={() => move(i, i + 1)}>↓</ActionIcon>
                </Tooltip>
              </Group>
            </Stack>
            <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
              <TextInput size="xs" label={strings.caption} value={photo.caption ?? ""} onChange={(e) => set(i, { caption: e.currentTarget.value }, "caption")} />
              <TextInput size="xs" label={strings.credit} placeholder={strings.creditHint} value={photo.credit ?? ""} onChange={(e) => set(i, { credit: e.currentTarget.value }, "credit")} />
              {item && (
                <TextInput
                  size="xs" label={strings.description} description={strings.descriptionHint} value={item.alt ?? ""}
                  onChange={(e) => onDescription(photo.ref, e.currentTarget.value)}
                />
              )}
              <Group gap="xs">
                <Button variant="subtle" size="compact-xs" onClick={() => pick(i)} disabled={busy}>{strings.replacePhoto}</Button>
                <Button variant="subtle" size="compact-xs" color="red" onClick={() => onChange(photos.filter((_, j) => j !== i), "photos")}>
                  {strings.removePhoto}
                </Button>
              </Group>
            </Stack>
          </Group>
        );
      })}
    </Stack>
  );
}
