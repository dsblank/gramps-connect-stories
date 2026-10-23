// Map geometry for shapes and image overlays, as plain math (no map
// library): image overlay corners moved, scaled and rotated in Web Mercator
// space so a rectangle stays one at any latitude, and bounding boxes over
// features and overlays. Moved here from Gramps Connect (its kmlMedia.ts),
// which shares it with the Story Editor; the "kml" in some names is from
// there, where KML was the first map file format.
import type { Feature, Position } from "geojson";

/** An overlay's 4 world corners, maplibre's own ImageSource `coordinates`
 * order (top-left, top-right, bottom-right, bottom-left) and type. */
export type OverlayCorners = [[number, number], [number, number], [number, number], [number, number]];

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/** [lng,lat] -> normalized Web Mercator x/y (x east-positive, y
 * *south*-positive) -- the exact projection maplibre's own map.project()
 * uses internally, reimplemented here as plain math (no maplibre-gl
 * import) so this module stays free of that ~900KB dependency (see
 * MapItemEditorDialog.tsx's own doc comment on why maplibre-gl is always
 * behind a lazy import elsewhere in Gramps Connect). Unlike raw [lng,lat],
 * Mercator x/y is locally isotropic -- equal scale in both directions at
 * any given point, which is the whole point of the projection -- making it
 * the correct space to rotate a box in; see rotatePoint. */
function mercatorFromLngLat([lng, lat]: [number, number]): [number, number] {
  const x = (180 + lng) / 360;
  const y = (180 - RAD_TO_DEG * Math.log(Math.tan(Math.PI / 4 + (lat * DEG_TO_RAD) / 2))) / 360;
  return [x, y];
}

/** mercatorFromLngLat's inverse. */
function lngLatFromMercator([x, y]: [number, number]): [number, number] {
  const lng = x * 360 - 180;
  const lat = 90 - 2 * Math.atan(Math.exp((y * 360 - 180) * DEG_TO_RAD)) * RAD_TO_DEG;
  return [lng, lat];
}

/** Rotates one point by `rotationDeg` around `center` (positive =
 * counterclockwise, matching KML's own <LatLonBox><rotation> convention)
 * -- done in Mercator-projected space (see mercatorFromLngLat), not raw
 * [lng,lat], so a rectangle stays a rectangle (right angles preserved)
 * after rotating, regardless of latitude. A naive rotation directly on
 * [lng,lat] -- this function's original implementation -- shears instead,
 * since a degree of longitude and a degree of latitude aren't the same
 * ground (or screen) distance away from the equator (found live: a square
 * image's corners visibly stopped being 90 degrees once rotated away from
 * 0). Gramps Connect's own image overlays are never meant to be opened in an
 * external viewer (their picture is an app-internal Media reference), so diverging here
 * from what Google Earth's own <LatLonBox><rotation> would render is an
 * acceptable trade for Gramps Connect always rendering its own files correctly.
 * Pass a negative `rotationDeg` to go the other way (world -> local). */
export function rotatePoint(point: [number, number], center: [number, number], rotationDeg: number): [number, number] {
  const angle = rotationDeg * DEG_TO_RAD;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const [px, py] = mercatorFromLngLat(point);
  const [cx, cy] = mercatorFromLngLat(center);
  // Mercator y increases southward -- negated here so this rotation is
  // expressed in a conventional north-up, east-right plane (dx
  // east-positive, dy north-positive), keeping "positive rotationDeg =
  // counterclockwise" the same sense every caller already expects.
  const dx = px - cx;
  const dy = -(py - cy);
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;
  return lngLatFromMercator([cx + rx, cy - ry]);
}

/** Scales the distance from `center` to `point` by `scale`, in the same
 * Mercator-projected space rotatePoint rotates in -- so scaling a
 * rectangle (or an already-warped quad) uniformly from its own center
 * preserves its exact shape/aspect ratio regardless of latitude, the same
 * way rotatePoint preserves angles. MapItemEditorDialog.tsx's resize
 * handle applies this to all 4 corners at once (see mountOverlay). */
export function scalePoint(point: [number, number], center: [number, number], scale: number): [number, number] {
  const [px, py] = mercatorFromLngLat(point);
  const [cx, cy] = mercatorFromLngLat(center);
  return lngLatFromMercator([cx + (px - cx) * scale, cy + (py - cy) * scale]);
}

/** The distance between `a` and `b` in the same Mercator-projected space
 * scalePoint scales in -- not a real-world distance (Mercator distorts
 * those away from the equator), just a consistent unit for computing a
 * resize handle's before/after scale ratio, which only ever needs to be
 * internally consistent with scalePoint's own projection, not physically
 * meaningful on its own. */
export function mercatorDistance(a: [number, number], b: [number, number]): number {
  const [ax, ay] = mercatorFromLngLat(a);
  const [bx, by] = mercatorFromLngLat(b);
  return Math.hypot(bx - ax, by - ay);
}

/** The angle (degrees, positive = counterclockwise, 0 = due east) from
 * `from` to `to` -- measured in the same Mercator-projected, north-up
 * plane rotatePoint itself rotates in, so a caller tracking "how far has
 * the user dragged this handle around the center" gets an angle that
 * matches how rotatePoint will then actually render it (unlike a plain
 * atan2 on raw [lng,lat], which suffers the same latitude-dependent skew
 * rotatePoint's own doc comment describes). */
export function mercatorBearing(from: [number, number], to: [number, number]): number {
  const [fx, fy] = mercatorFromLngLat(from);
  const [tx, ty] = mercatorFromLngLat(to);
  return Math.atan2(-(ty - fy), tx - fx) * RAD_TO_DEG;
}

/** An axis-aligned box plus a rotation about its own center's 4 world
 * corners -- KML's own <LatLonBox><rotation> model. Only ever needed to
 * interpret an *old* overlay saved before Gramps Connect always wrote
 * explicit corners (see its fetchAllKmlImageOverlays); the map editor
 * itself only ever deals with corners directly, never this box shape. */
export function cornersFromBox(
  box: { north: number; south: number; east: number; west: number; rotation: number },
): OverlayCorners {
  const center: [number, number] = [(box.west + box.east) / 2, (box.north + box.south) / 2];
  const corners: [number, number][] = [
    [box.west, box.north], [box.east, box.north], [box.east, box.south], [box.west, box.south],
  ];
  return corners.map((p) => rotatePoint(p, center, box.rotation)) as OverlayCorners;
}

function visitCoordinates(coords: unknown, bounds: [number, number, number, number]): void {
  if (typeof (coords as Position)[0] === "number") {
    const [lng, lat] = coords as Position;
    if (lng < bounds[0]) bounds[0] = lng;
    if (lat < bounds[1]) bounds[1] = lat;
    if (lng > bounds[2]) bounds[2] = lng;
    if (lat > bounds[3]) bounds[3] = lat;
    return;
  }
  for (const c of coords as unknown[]) visitCoordinates(c, bounds);
}

/** Every coordinate's bounding box across a set of KML features, as
 * [west, south, east, north] -- maplibre's own LngLatBoundsLike corner
 * order, so a caller can hand this straight to fitBounds/cameraForBounds to
 * frame a field boundary or a route at whatever zoom actually fits it,
 * rather than guessing one. Null when the features carry no coordinates at
 * all (an empty file, or every fetch above failed). */
export function kmlBounds(features: Feature[]): [west: number, south: number, east: number, north: number] | null {
  const bounds: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const feature of features) {
    const geometry = feature.geometry;
    if (!geometry) continue;
    if (geometry.type === "GeometryCollection") {
      for (const g of geometry.geometries) if ("coordinates" in g) visitCoordinates(g.coordinates, bounds);
      continue;
    }
    visitCoordinates(geometry.coordinates, bounds);
  }
  return Number.isFinite(bounds[0]) ? bounds : null;
}

/** The center of kmlBounds -- a plain bbox center rather than an
 * area-weighted centroid, which is all a "roughly where does this file sit"
 * marker position needs. */
export function kmlCenter(features: Feature[]): [lat: number, long: number] | null {
  const bounds = kmlBounds(features);
  if (!bounds) return null;
  return [(bounds[1] + bounds[3]) / 2, (bounds[0] + bounds[2]) / 2];
}

/** Same bbox as kmlBounds, but over a set of image overlays' corners instead
 * of vector features -- overlays (GroundOverlay/region placemarks) carry no
 * Point/LineString/Polygon geometry for kmlBounds to find anything in, since
 * fetchAllKmlFeatures excludes them entirely. Lets a caller fit the camera to
 * an overlay-only KML attachment the same way it would a vector one. */
export function kmlOverlayBounds(
  overlays: { corners: OverlayCorners }[],
): [west: number, south: number, east: number, north: number] | null {
  if (overlays.length === 0) return null;
  const bounds: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const overlay of overlays) {
    for (const [lng, lat] of overlay.corners) {
      if (lng < bounds[0]) bounds[0] = lng;
      if (lat < bounds[1]) bounds[1] = lat;
      if (lng > bounds[2]) bounds[2] = lng;
      if (lat > bounds[3]) bounds[3] = lat;
    }
  }
  return bounds;
}

/** Combines two nullable bboxes (as returned by kmlBounds/kmlOverlayBounds)
 * into the box that encloses both -- a place's KML attachment(s) can carry
 * vector shapes and image overlays side by side, and framing the camera to
 * just one kind would clip whichever the caller didn't ask for. Either side
 * missing (no shapes, or no overlays) just passes the other through; both
 * missing is null, same as either input alone would be. */
export function unionBounds(
  a: [west: number, south: number, east: number, north: number] | null,
  b: [west: number, south: number, east: number, north: number] | null,
): [west: number, south: number, east: number, north: number] | null {
  if (!a) return b;
  if (!b) return a;
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

/** Same bbox-center guess as kmlCenter, but over a set of image overlays'
 * corners instead of vector features -- useVisualData.ts's fallback for a
 * PendingKmlPlace whose only KML attachment is a GroundOverlay (an
 * overlay-only file: no Point/LineString/Polygon placemark for kmlCenter to
 * find anything in, since fetchAllKmlFeatures excludes GroundOverlay
 * placemarks entirely). Without this, a place with only an image overlay
 * attached and no lat/long of its own never gets a derived position and so
 * never renders on the map until someone sets its coordinates by hand
 * (found live). */
export function kmlOverlayCenter(overlays: { corners: OverlayCorners }[]): [lat: number, long: number] | null {
  const bounds = kmlOverlayBounds(overlays);
  if (!bounds) return null;
  return [(bounds[1] + bounds[3]) / 2, (bounds[0] + bounds[2]) / 2];
}
