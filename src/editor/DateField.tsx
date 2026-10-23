// A slide's date: the text readers see, and its precise form (EDTF), which
// follows the text as it's typed until someone changes it by hand.
import { useEffect, useRef, useState } from "react";
import { Anchor, Group, Stack, Text, TextInput } from "@mantine/core";
import type { StoryDate } from "../types";
import { edtfYearRange } from "../player/dates";
import type { DateTextParser } from "./dates";
import { slideDate } from "./model";
import type { EditorStrings } from "./strings";

export interface DateFieldProps {
  value: StoryDate | undefined;
  language: string | undefined;
  parse: DateTextParser;
  strings: EditorStrings;
  onChange: (date: StoryDate | undefined) => void;
}

/** Keyed by slide in the parent, so `following` starts over per slide. */
export function DateField({ value, language, parse, strings, onChange }: DateFieldProps) {
  // Whether the precise form is worked out from the text. Unknown (null)
  // until the stored one has been compared with what the text gives.
  const [following, setFollowing] = useState<boolean | null>(value?.edtf ? null : true);
  const latest = useRef(value);
  latest.current = value;
  const request = useRef(0);

  useEffect(() => {
    if (following !== null) return;
    let live = true;
    void parse(value?.text ?? "", language).then((edtf) => {
      if (live) setFollowing(edtf === value?.edtf);
    });
    return () => { live = false; };
    // Once, for the stored date.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const follow = (text: string) => {
    const id = ++request.current;
    void parse(text, language).then((edtf) => {
      // Only the latest text's answer, and only onto the date as it is now.
      if (id !== request.current || latest.current?.text !== text) return;
      onChange(slideDate(latest.current, text, edtf));
    });
  };

  const onText = (text: string) => {
    onChange(slideDate(latest.current, text, latest.current?.edtf));
    if (following !== false) follow(text);
  };

  const edtf = value?.edtf ?? "";
  const understood = !edtf || edtfYearRange(edtf) !== null;
  let note: string;
  if (edtf && !understood) note = strings.preciseDateNotUnderstood;
  else if (!edtf) note = strings.noPreciseDate;
  else if (following) note = strings.preciseDateFollows;
  else note = strings.preciseDateHint;

  return (
    <Stack gap={6}>
      <TextInput
        label={strings.date}
        description={strings.dateHint}
        value={value?.text ?? ""}
        onChange={(e) => onText(e.currentTarget.value)}
      />
      {value?.text && (
        <Group gap="sm" align="flex-end" wrap="nowrap">
          <TextInput
            label={strings.preciseDate}
            size="xs"
            w={200}
            value={edtf}
            error={!understood}
            styles={{ input: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" } }}
            onChange={(e) => {
              setFollowing(false);
              onChange(slideDate(latest.current, latest.current?.text ?? "", e.currentTarget.value.trim() || undefined));
            }}
          />
          <Stack gap={0} pb={4}>
            <Text size="xs" c={understood ? "dimmed" : "red"}>{note}</Text>
            {following === false && (
              <Anchor component="button" type="button" size="xs" onClick={() => { setFollowing(true); follow(value.text); }}>
                {strings.matchDateAsWritten}
              </Anchor>
            )}
          </Stack>
        </Group>
      )}
    </Stack>
  );
}
