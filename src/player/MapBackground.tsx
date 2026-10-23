// The full-bleed map behind a located story's slides: flies to the current
// slide's place (or frames its shape and overlays), draws that shape and
// those overlays, and holds still -- marker dimmed -- on a slide with no
// place. Its own small maplibre instance; the host page loads no map of
// its own for this.
import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
// Positions the marker and styles the attribution control; without it the
// pin sits in normal flow at the top left instead of on its coordinate.
import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource, Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import type { FeatureCollection, GeoJSON } from "geojson";
import type { Overlay, Place } from "../types";
import { dateCoversYear } from "./dates";
import { placeBounds, placeCenter } from "./geo";
import { applyOhmYear, crossfadeStyleSwap, mapStyleKey, mapStyleUrl } from "./mapStyles";
import { PIN_PATH_D, type PlayerColors } from "./theme";

const SHAPE_SOURCE = "story-shape";
const FILL_LAYER = "story-shape-fill";
const LINE_LAYER = "story-shape-line";
const POINT_LAYER = "story-shape-points";
const LABEL_LAYER = "story-shape-labels";
const OVERLAY_PREFIX = "story-overlay-";
const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

/** The current slide, as far as the map cares. `key` is the slide id:
 * what tells "a new slide" from "the same slide, re-rendered". */
export interface MapSlide {
  key: string;
  place: Place | undefined;
}

/** Frame the place's shape or overlays (usually a field, a route or an old
 * map, far tighter than a town-level zoom), else fly to its point. */
function moveCamera(map: MapLibreMap, place: Place | undefined, duration: number) {
  const bounds = placeBounds(place);
  if (bounds) {
    map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { maxZoom: 17, duration });
    return;
  }
  const center = placeCenter(place);
  if (center) map.flyTo({ center, zoom: 9, essential: true, duration });
}

/** The pin on the place; held where it was, dimmed, for a slide with none. */
function placeMarker(marker: MapLibreMarker | null, center: [number, number] | null) {
  if (!marker) return;
  if (center) marker.setLngLat(center);
  marker.getElement().style.opacity = center ? "1" : "0.4";
}

export function MapBackground({ initialCenter, current, dark, colors, panelFraction, ohmYear, resolveMedia }: {
  initialCenter: [number, number];
  current: MapSlide;
  dark: boolean;
  colors: PlayerColors;
  /** How much of the right side the slide panel covers: a point is
   * centered in the remaining left part, not the whole width. */
  panelFraction: number;
  /** Non-null switches to OpenHistoricalMap filtered to this year. */
  ohmYear: number | null;
  resolveMedia: (key: string) => Promise<string | null>;
}) {
  // A callback ref (via state), not useRef: a host that mounts the player
  // inside a modal may not have it in the DOM on the first render, and a
  // plain ref would leave the create-effect below nothing to re-run on.
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<MapLibreMarker | null>(null);
  // True after each "style.load" (initial load, and again after every
  // style swap, which wipes the layers this component adds).
  const [ready, setReady] = useState(false);

  const darkRef = useRef(dark);
  darkRef.current = dark;
  const ohmYearRef = useRef(ohmYear);
  ohmYearRef.current = ohmYear;
  const colorsRef = useRef(colors);
  colorsRef.current = colors;
  // overlay layer id -> its date, for re-checking visibility on a year change.
  const overlayDatesRef = useRef<Map<string, Overlay["date"]>>(new Map());
  // What the map was built or last swapped with, so a re-render with the
  // same effective style never triggers a reload.
  const appliedStyleKeyRef = useRef(mapStyleKey(dark, ohmYear));
  const currentRef = useRef(current);
  currentRef.current = current;

  useEffect(() => {
    if (!containerEl) return;
    setReady(false);
    appliedStyleKeyRef.current = mapStyleKey(darkRef.current, ohmYearRef.current);
    const map = new maplibregl.Map({
      container: containerEl,
      style: mapStyleUrl(darkRef.current, ohmYearRef.current),
      zoom: 5,
      attributionControl: { compact: true },
      // So crossfadeStyleSwap's snapshot has the last frame in it.
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    mapRef.current = map;
    map.on("style.load", () => setReady(true));
    // Center points in the part of the map the slide panel doesn't cover.
    map.setPadding({ top: 0, bottom: 0, left: 0, right: containerEl.clientWidth * panelFraction });
    // Straight to the opening slide's place, unanimated. The camera effect
    // below ran for it before this map existed (the container arrives a
    // render late), so a story opened partway through starts there too.
    const start = currentRef.current.place;
    const startCenter = placeCenter(start);
    map.jumpTo({ center: startCenter ?? initialCenter });
    if (startCenter) moveCamera(map, start, 0);
    map.on("load", () => {
      const c = colorsRef.current;
      const el = document.createElement("div");
      el.style.width = "26px";
      el.style.height = "26px";
      el.style.transition = "opacity 300ms";
      el.innerHTML = `<svg viewBox="0 0 24 24" width="26" height="26">`
        + `<path d="${PIN_PATH_D}" fill="${c.mark}" stroke="${c.surface}" stroke-width="1.5" />`
        + `</svg>`;
      // The pin's tip, not its middle, sits on the coordinate.
      markerRef.current = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat(initialCenter).addTo(map);
      placeMarker(markerRef.current, placeCenter(currentRef.current.place));
    });
    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // initialCenter is only the first frame; moving is the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerEl]);

  useEffect(() => {
    const map = mapRef.current;
    const key = mapStyleKey(dark, ohmYear);
    if (!map || appliedStyleKeyRef.current === key) return;
    appliedStyleKeyRef.current = key;
    crossfadeStyleSwap(map, mapStyleUrl(dark, ohmYear), () => setReady(false));
  }, [dark, ohmYear]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || ohmYear == null) return;
    applyOhmYear(map, ohmYear);
  }, [ready, ohmYear]);

  // The shape layers, (re-)added after every style load, under the marker.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || map.getSource(SHAPE_SOURCE)) return;
    const c = colorsRef.current;
    map.addSource(SHAPE_SOURCE, { type: "geojson", data: EMPTY });
    // A feature's own `color` property (simplestyle-ish) wins over the mark color.
    const color = ["coalesce", ["get", "color"], c.mark] as maplibregl.ExpressionSpecification;
    map.addLayer({
      id: FILL_LAYER, type: "fill", source: SHAPE_SOURCE,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": color, "fill-opacity": 0.25 },
    });
    map.addLayer({
      id: LINE_LAYER, type: "line", source: SHAPE_SOURCE,
      filter: ["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "LineString"]],
      paint: { "line-color": color, "line-width": 2 },
    });
    map.addLayer({
      id: POINT_LAYER, type: "circle", source: SHAPE_SOURCE,
      // A named point is a label (next layer), drawn as text only.
      filter: ["all", ["==", ["geometry-type"], "Point"], ["!", ["has", "name"]]],
      paint: { "circle-radius": 5, "circle-color": color, "circle-stroke-width": 1, "circle-stroke-color": c.surface },
    });
    map.addLayer({
      id: LABEL_LAYER, type: "symbol", source: SHAPE_SOURCE,
      filter: ["all", ["==", ["geometry-type"], "Point"], ["has", "name"]],
      layout: {
        "text-field": ["get", "name"],
        "text-size": 12,
        "text-font": ["Noto Sans Regular"],
        "text-anchor": "left",
        "text-offset": [0.6, 0],
      },
      paint: {
        "text-color": ["coalesce", ["get", "color"], c.text],
        "text-halo-color": c.surface,
        "text-halo-width": 1.5,
      },
    });
  }, [ready]);

  const place = current.place;

  // The current slide's shape. Re-supplied after each style load, since a
  // swap empties the source.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource(SHAPE_SOURCE) as GeoJSONSource | undefined;
    source?.setData((place?.geometry as GeoJSON | undefined) ?? EMPTY);
  }, [ready, current.key, place]);

  // Camera: once per slide (see moveCamera). Keyed to the slide, not to `ready`, so a
  // map-mode switch never yanks the view back from wherever the viewer
  // has since panned.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const center = placeCenter(place);
    placeMarker(markerRef.current, center);
    // No place: the camera stays put.
    if (center) moveCamera(map, place, 900);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.key]);

  // Image overlays: one image source + raster layer each, under the shape
  // layers, lowest `order` first so the highest ends up on top. Keyed by
  // the overlays themselves, so consecutive slides at the same place keep
  // theirs instead of reloading them.
  const overlayKey = JSON.stringify(place?.overlays ?? []);
  useEffect(() => {
    const map = mapRef.current;
    const overlays = place?.overlays ?? [];
    if (!map || !ready || overlays.length === 0) return;
    let cancelled = false;
    const added: string[] = [];
    (async () => {
      const sorted = overlays
        .map((overlay, i) => ({ overlay, i }))
        .sort((a, b) => (a.overlay.order ?? a.i) - (b.overlay.order ?? b.i));
      for (const { overlay, i } of sorted) {
        const url = await resolveMedia(overlay.media);
        if (cancelled) return;
        if (!url) continue;
        const id = `${OVERLAY_PREFIX}${i}`;
        if (map.getSource(id)) continue;
        map.addSource(id, { type: "image", url, coordinates: overlay.corners });
        map.addLayer({ id, type: "raster", source: id }, FILL_LAYER);
        map.setPaintProperty(id, "raster-opacity", overlay.opacity ?? 1);
        overlayDatesRef.current.set(id, overlay.date);
        map.setLayoutProperty(id, "visibility", dateCoversYear(overlay.date, ohmYearRef.current) ? "visible" : "none");
        added.push(id);
      }
    })();
    return () => {
      cancelled = true;
      for (const id of added) {
        overlayDatesRef.current.delete(id);
        if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(id)) map.removeSource(id);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayKey, ready]);

  // A new map year alone: re-check each overlay's era.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    for (const [id, date] of overlayDatesRef.current) {
      if (!map.getLayer(id)) continue;
      map.setLayoutProperty(id, "visibility", dateCoversYear(date, ohmYear) ? "visible" : "none");
    }
  }, [ohmYear, ready]);

  return <div ref={setContainerEl} style={{ position: "absolute", inset: 0 }} />;
}
