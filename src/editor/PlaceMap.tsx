// A small map for setting a place's point: click to put the pin there,
// drag the pin to move it. It starts at the point, or (with none yet) at
// the story's other places, or the whole world.
import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import type { LonLat } from "../types";
import type { Bounds } from "../player/geo";
import { mapStyleUrl } from "../player/mapStyles";
import { defaultColors, PIN_PATH_D } from "../player/theme";
import { roundDegrees } from "./model";

export interface PlaceMapProps {
  point: LonLat | null;
  /** Where to look when there's no point yet. */
  around?: Bounds | null;
  dark?: boolean;
  label: string;
  onPick: (point: LonLat) => void;
}

export function PlaceMap({ point, around, dark = false, label, onPick }: PlaceMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<MapLibreMarker | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const pick = (lngLat: { lng: number; lat: number }) => onPickRef.current([roundDegrees(lngLat.lng), roundDegrees(lngLat.lat)]);
  // The first point and surroundings only: moving is the effect below.
  const start = useRef({ point, around });

  useEffect(() => {
    if (!container.current) return;
    const { point: first, around: box } = start.current;
    const map = new maplibregl.Map({
      container: container.current,
      style: mapStyleUrl(dark, null),
      ...(first ? { center: first, zoom: 9 } : box ? { bounds: box, fitBoundsOptions: { padding: 30, maxZoom: 9 } } : { center: [10, 30], zoom: 0.5 }),
      attributionControl: { compact: true },
      // Scrolling the form past the map shouldn't zoom it.
      cooperativeGestures: true,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.getCanvas().style.cursor = "crosshair";
    map.on("click", (e) => pick(e.lngLat));
    mapRef.current = map;
    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark]);

  // The pin follows the point, however it changed; the view follows only
  // when the pin would be out of sight.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!point) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (!markerRef.current) {
      const el = document.createElement("div");
      const c = defaultColors(dark);
      el.innerHTML = `<svg viewBox="0 0 24 24" width="28" height="28" style="display:block;cursor:grab">`
        + `<path d="${PIN_PATH_D}" fill="${c.mark}" stroke="${c.surface}" stroke-width="1.5" /></svg>`;
      const marker = new maplibregl.Marker({ element: el, anchor: "bottom", draggable: true }).setLngLat(point).addTo(map);
      marker.on("dragend", () => pick(marker.getLngLat()));
      markerRef.current = marker;
    } else {
      markerRef.current.setLngLat(point);
    }
    if (!map.getBounds().contains(point)) map.easeTo({ center: point, zoom: Math.max(map.getZoom(), 8) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [point?.[0], point?.[1], dark]);

  return (
    <div
      ref={container} role="application" aria-label={label}
      style={{ height: 240, borderRadius: 6, overflow: "hidden", border: "1px solid var(--mantine-color-default-border)" }}
    />
  );
}
