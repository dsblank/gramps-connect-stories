// A plain Textarea plus Bold/Italic buttons that wrap the selection in the
// story format's `**`/`*` markers -- the only formatting a slide's text has
// (parseStoryText is the matching reader), so no rich-text editor.
import { useRef } from "react";
import { Button, Group, Stack, Text, Textarea } from "@mantine/core";

/** Wraps the textarea's selection in `marker` (or unwraps it, if the
 * selection is already exactly `marker…marker`); with nothing selected,
 * inserts an empty pair and leaves the cursor between them. */
function applyMarker(el: HTMLTextAreaElement, marker: string, value: string, onChange: (v: string) => void) {
  const start = el.selectionStart ?? value.length;
  const end = el.selectionEnd ?? value.length;
  if (start === end) {
    onChange(value.slice(0, start) + marker + marker + value.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + marker.length, start + marker.length);
    });
    return;
  }
  const selected = value.slice(start, end);
  const alreadyWrapped = selected.length > marker.length * 2 && selected.startsWith(marker) && selected.endsWith(marker);
  const replacement = alreadyWrapped ? selected.slice(marker.length, selected.length - marker.length) : `${marker}${selected}${marker}`;
  onChange(value.slice(0, start) + replacement + value.slice(end));
}

export interface StoryTextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  boldLabel?: string;
  italicLabel?: string;
  minRows?: number;
}

export function StoryTextField({ label, value, onChange, boldLabel = "Bold", italicLabel = "Italic", minRows = 3 }: StoryTextFieldProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <Stack gap={4}>
      <Group gap="xs">
        <Text size="sm" fw={500}>{label}</Text>
        <Button
          variant="default" size="compact-xs" fw={700} aria-label={boldLabel} title={boldLabel}
          onClick={() => ref.current && applyMarker(ref.current, "**", value, onChange)}
        >
          B
        </Button>
        <Button
          variant="default" size="compact-xs" fs="italic" aria-label={italicLabel} title={italicLabel}
          onClick={() => ref.current && applyMarker(ref.current, "*", value, onChange)}
        >
          i
        </Button>
      </Group>
      <Textarea
        ref={ref} aria-label={label} autosize minRows={minRows} maxRows={14} value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
    </Stack>
  );
}
