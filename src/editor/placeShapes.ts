// A slide's place as the map editor sees it, and back: the place's
// `geometry` (a FeatureCollection, a Feature or a bare geometry) as
// features, and its `overlays` as image overlays keyed by media. Whatever
// the editor doesn't edit -- an overlay's date, fields this version
// doesn't know, a FeatureCollection's own members -- is carried over from
// the place as it was.
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { Overlay, Place, StoryDate } from "../types";
import type { MapEditorOverlay, MapEditorResult } from "./MapEditor";
import { patchPlace } from "./model";

/** The features in a place's `geometry`, whichever form it takes. */
export function placeFeatures(place: Place | undefined): Feature[] {
  const geometry = place?.geometry as { type: string; features?: unknown[] } | undefined;
  if (!geometry) return [];
  if (geometry.type === "FeatureCollection") {
    return ((geometry.features ?? []) as Feature[]).filter((f) => f && f.geometry);
  }
  if (geometry.type === "Feature") return (geometry as unknown as Feature).geometry ? [geometry as unknown as Feature] : [];
  return [{ type: "Feature", properties: {}, geometry: geometry as unknown as Geometry }];
}

/** What the map editor opens with for a place. */
export function placeToEditor(place: Place | undefined): { features: Feature[]; overlays: MapEditorOverlay[] } {
  return {
    features: placeFeatures(place),
    overlays: (place?.overlays ?? []).map((o) => ({
      image: o.media, corners: o.corners,
      ...(o.opacity !== undefined ? { opacity: o.opacity } : {}),
      ...(o.order !== undefined ? { order: o.order } : {}),
    })),
  };
}

/** The place with what the map editor ended with. `dates` holds each
 * overlay's date by media key, as edited beside the editor. */
export function editorToPlace(
  place: Place | undefined, result: MapEditorResult, dates: Map<string, StoryDate | undefined>,
): Place | undefined {
  const before = place?.geometry as (FeatureCollection & Record<string, unknown>) | undefined;
  const geometry = result.features.length === 0
    ? undefined
    // A FeatureCollection keeps its own other members; anything else
    // becomes one.
    : { ...(before?.type === "FeatureCollection" ? before : {}), type: "FeatureCollection", features: result.features };
  const previous = new Map((place?.overlays ?? []).map((o) => [o.media, o]));
  const overlays = result.overlays.map((o): Overlay => {
    const { opacity: _o, order: _r, date: _d, ...kept } = previous.get(o.image) ?? ({} as Partial<Overlay>);
    const date = dates.has(o.image) ? dates.get(o.image) : previous.get(o.image)?.date;
    return {
      ...kept,
      media: o.image,
      corners: o.corners,
      ...(o.opacity !== undefined && o.opacity !== 1 ? { opacity: o.opacity } : {}),
      ...(o.order !== undefined ? { order: Math.round(o.order) } : {}),
      ...(date ? { date } : {}),
    };
  });
  return patchPlace(place, {
    geometry: geometry as Place["geometry"],
    overlays: overlays.length ? overlays : undefined,
  });
}
