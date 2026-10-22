// Where a slide is on the map: its point, or the box around its shape and
// overlays -- pure geometry, no map library.
import type { LonLat, Place } from "../types";

export type Bounds = [west: number, south: number, east: number, north: number];

function visit(coords: unknown, bounds: Bounds): void {
  if (!Array.isArray(coords)) return;
  if (coords.length >= 2 && typeof coords[0] === "number" && typeof coords[1] === "number") {
    const [lon, lat] = coords as number[];
    bounds[0] = Math.min(bounds[0], lon);
    bounds[1] = Math.min(bounds[1], lat);
    bounds[2] = Math.max(bounds[2], lon);
    bounds[3] = Math.max(bounds[3], lat);
    return;
  }
  for (const child of coords) visit(child, bounds);
}

/** Every coordinate in a GeoJSON object, whatever its nesting. */
function visitGeoJson(node: unknown, bounds: Bounds): void {
  if (!node || typeof node !== "object") return;
  const obj = node as { type?: string; coordinates?: unknown; geometry?: unknown; geometries?: unknown[]; features?: unknown[] };
  if (obj.coordinates !== undefined) visit(obj.coordinates, bounds);
  if (obj.geometry) visitGeoJson(obj.geometry, bounds);
  for (const g of obj.geometries ?? []) visitGeoJson(g, bounds);
  for (const f of obj.features ?? []) visitGeoJson(f, bounds);
}

/** The box around a place's shape and overlays, or null when it has
 * neither (or they hold no coordinates). */
export function placeBounds(place: Place | undefined): Bounds | null {
  if (!place) return null;
  const bounds: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
  visitGeoJson(place.geometry, bounds);
  for (const overlay of place.overlays ?? []) visit(overlay.corners as LonLat[], bounds);
  return Number.isFinite(bounds[0]) ? bounds : null;
}

/** Where to put the pin: the place's own point, else the middle of its
 * shape and overlays. Null for a slide with no position at all. */
export function placeCenter(place: Place | undefined): LonLat | null {
  if (place?.lat !== undefined && place.lon !== undefined) return [place.lon, place.lat];
  const bounds = placeBounds(place);
  return bounds ? [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2] : null;
}
