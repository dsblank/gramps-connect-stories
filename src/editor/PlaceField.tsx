// A slide's place: a name and a point. The point comes from clicking the
// map, dragging the pin, typing coordinates, or a search by name (opt-in:
// the one thing the editor sends anywhere). Picking one of the story's
// other places gives this slide the very same place, overlays and all.
// A place's shape and overlays aren't edited here, but are always kept.
import { useEffect, useMemo, useRef, useState } from "react";
import { Autocomplete, Button, Group, Loader, Stack, Text, TextInput, Tooltip, UnstyledButton } from "@mantine/core";
import type { Place } from "../types";
import type { Bounds } from "../player/geo";
import { formatLatLon, parseLatLon, patchPlace, roundDegrees } from "./model";
import { PlaceMap } from "./PlaceMap";
import type { PlaceSearch, PlaceSearchResult } from "./placeSearch";
import type { EditorStrings } from "./strings";

export type PlaceUpdate = (place: Place | undefined) => Place | undefined;

export interface PlaceFieldProps {
  place: Place | undefined;
  /** The story's other places, to reuse. */
  choices: Place[];
  /** Where the map looks while this place has no point. */
  around?: Bounds | null;
  /** The story's language: search results are named in it. */
  language?: string;
  /** Null hides the search. */
  search: PlaceSearch | null;
  dark?: boolean;
  strings: EditorStrings;
  /** A change, as a function of the place as it is by then. */
  onChange: (update: PlaceUpdate, key: string) => void;
}

type Found =
  | { state: "idle" }
  | { state: "searching" }
  | { state: "results"; results: PlaceSearchResult[] }
  | { state: "message"; message: string };

export function PlaceField({ place, choices, around, language, search, dark, strings, onChange }: PlaceFieldProps) {
  const lat = place?.lat;
  const lon = place?.lon;
  const point = lat !== undefined && lon !== undefined ? ([lon, lat] as [number, number]) : null;
  const name = place?.name ?? "";

  // The coordinates as typed, until they're a point; then as the point is.
  const [coords, setCoords] = useState(point ? formatLatLon(point[1], point[0]) : "");
  useEffect(() => {
    setCoords((typed) => {
      const parsed = parseLatLon(typed);
      if (lat === undefined || lon === undefined) return parsed ? "" : typed;
      return parsed && parsed.lat === lat && parsed.lon === lon ? typed : formatLatLon(lat, lon);
    });
  }, [lat, lon]);
  const coordsInvalid = coords.trim() !== "" && !parseLatLon(coords);

  const [found, setFound] = useState<Found>({ state: "idle" });
  const searching = useRef<AbortController | null>(null);
  useEffect(() => () => searching.current?.abort(), []);
  const find = async () => {
    if (!search || !name.trim()) return;
    searching.current?.abort();
    const controller = new AbortController();
    searching.current = controller;
    setFound({ state: "searching" });
    try {
      const results = await search.search(name.trim(), language, controller.signal);
      setFound(results.length ? { state: "results", results } : { state: "message", message: strings.findPlaceNone });
    } catch {
      if (!controller.signal.aborted) setFound({ state: "message", message: strings.findPlaceFailed });
    }
  };
  const choose = async (result: PlaceSearchResult) => {
    if (!search) return;
    searching.current?.abort();
    const controller = new AbortController();
    searching.current = controller;
    setFound({ state: "searching" });
    try {
      const at = await search.point(result, controller.signal);
      if (!at) {
        setFound({ state: "message", message: strings.findPlaceNoPoint(result.label) });
        return;
      }
      setFound({ state: "idle" });
      onChange((p) => patchPlace(p, { name: result.label, lat: roundDegrees(at.lat), lon: roundDegrees(at.lon) }), "place");
    } catch {
      if (!controller.signal.aborted) setFound({ state: "message", message: strings.findPlaceFailed });
    }
  };

  const byName = useMemo(() => new Map(choices.map((c) => [c.name!.trim(), c])), [choices]);
  const keeps = [
    place?.geometry ? strings.placeShape : null,
    place?.overlays?.length ? strings.placeOverlays(place.overlays.length) : null,
  ].filter(Boolean);

  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Text size="sm" fw={500}>{strings.place}</Text>
        {place && (
          <Button variant="subtle" size="compact-xs" color="red" onClick={() => { setFound({ state: "idle" }); onChange(() => undefined, "place"); }}>
            {strings.removePlace}
          </Button>
        )}
      </Group>
      <Group gap="xs" align="flex-end" wrap="nowrap">
        <Autocomplete
          size="xs" label={strings.placeName} style={{ flex: 1 }} value={name}
          data={[...byName.keys()]}
          comboboxProps={{ withinPortal: true }}
          onChange={(value) => onChange((p) => patchPlace(p, { name: value || undefined }), "place:name")}
          onOptionSubmit={(value) => {
            const chosen = byName.get(value);
            if (chosen) onChange(() => structuredClone(chosen), "place");
          }}
        />
        {search && (
          <Tooltip label={strings.findPlaceHint} multiline w={260}>
            <Button variant="default" size="xs" disabled={!name.trim() || found.state === "searching"} onClick={() => void find()}>
              {strings.findPlace}
            </Button>
          </Tooltip>
        )}
      </Group>
      {found.state === "searching" && <Loader size="xs" />}
      {found.state === "message" && <Text size="xs" c="dimmed" role="status">{found.message}</Text>}
      {found.state === "results" && (
        <Stack gap={2} role="list" aria-label={strings.findPlace}>
          {found.results.map((result) => (
            <UnstyledButton
              key={result.id} role="listitem" onClick={() => void choose(result)}
              style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid var(--mantine-color-default-border)" }}
            >
              <Text size="sm">{result.label}</Text>
              {result.description && <Text size="xs" c="dimmed">{result.description}</Text>}
            </UnstyledButton>
          ))}
        </Stack>
      )}
      <TextInput
        size="xs" label={strings.coordinates} placeholder={strings.coordinatesHint} w={260} value={coords}
        error={coordsInvalid ? strings.coordinatesInvalid : undefined}
        onChange={(e) => {
          const text = e.currentTarget.value;
          setCoords(text);
          const parsed = parseLatLon(text);
          if (!text.trim()) onChange((p) => patchPlace(p, { lat: undefined, lon: undefined }), "place:point");
          else if (parsed) onChange((p) => patchPlace(p, parsed), "place:point");
        }}
      />
      <PlaceMap
        point={point} around={around} dark={dark} label={strings.placeMap}
        onPick={([pickedLon, pickedLat]) => onChange((p) => patchPlace(p, { lat: pickedLat, lon: pickedLon }), "place:point")}
      />
      <Text size="xs" c="dimmed">{strings.placeMapHint}</Text>
      {keeps.length > 0 && <Text size="xs" c="dimmed">{strings.placeKeeps(keeps.join(", "))}</Text>}
    </Stack>
  );
}
