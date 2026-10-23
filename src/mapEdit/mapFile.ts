// Reading and writing map files: KML, GPX and GeoJSON in (read into GeoJSON
// features, with each format's own colours where they're reliable), and
// GeoJSON out, with image overlays as Polygon features marked
// IMAGE_OVERLAY_PROPERTY. A GeoJSON overlay's `image` names its picture;
// read back, it becomes the same feature @tmcw/togeojson makes of a KML
// GroundOverlay, with the picture behind MEDIA_HANDLE_PREFIX. Moved here
// from Gramps Connect (kmlMedia.ts and mapFileWrite.ts), which shares it
// with the Story Editor. GPX and KML need a DOMParser (a browser, or jsdom).
//
// GeoJSON keeps every property as JSON and multi-part shapes as they are,
// with no format translation to lose anything in; a GPS track's per-point
// times ride along in `coordinateProperties.times`, the same place
// @tmcw/togeojson's GPX/KML readers put them.
import type { Feature, FeatureCollection, GeoJsonObject, Geometry, Position } from "geojson";
import { gpx, kml } from "@tmcw/togeojson";
import type { OverlayCorners } from "./geometry";

/** An image overlay's picture, as a Media handle behind this marker (not a
 * real URL: an app-internal reference, since a resolvable link would need
 * an expiring auth token baked in) -- in a KML GroundOverlay's href, and
 * what asGroundOverlay makes of a GeoJSON one's `image`. */
export const MEDIA_HANDLE_PREFIX = "media-handle:";

/** A GeoJSON or GPX file's own colours, in the simplestyle convention
 * (`stroke`/`fill`/`fill-opacity`/`marker-color`, which both GeoJSON tools
 * and @tmcw/togeojson's gpx() use), copied onto the `color`/`opacity`
 * properties every map layer actually reads (see MapCanvas.tsx's
 * KML_FILL_LAYER). Fills only what's missing, so an explicit `color` wins.
 * Not applied to KML: Gramps Connect's own KML carries `color` already, and
 * leaving foreign KML alone keeps every existing overlay looking the same. */
function applySimplestyle(feature: Feature): Feature {
  const props = feature.properties ?? {};
  const isRegion = feature.geometry?.type === "Polygon" || feature.geometry?.type === "MultiPolygon";
  const color = props.color ?? (isRegion ? props.fill ?? props.stroke : props.stroke ?? props["marker-color"]);
  const opacity = props.opacity ?? (isRegion ? props["fill-opacity"] : undefined);
  if (color === props.color && opacity === props.opacity) return feature;
  return { ...feature, properties: { ...props, color, opacity } };
}

/** A GeoJSON file's features: a FeatureCollection, a single Feature or a
 * bare Geometry are all valid GeoJSON documents. */
function geoJsonFeatures(doc: GeoJsonObject): Feature<Geometry | null>[] {
  if (doc.type === "FeatureCollection") return (doc as { features?: Feature<Geometry | null>[] }).features ?? [];
  if (doc.type === "Feature") return [doc as Feature<Geometry | null>];
  return [{ type: "Feature", geometry: doc as Geometry, properties: {} }];
}

/** Gramps Connect's GeoJSON image overlay (see mapItemToGeoJson), turned into
 * the same feature @tmcw/togeojson makes of a KML <gx:LatLonQuad>
 * GroundOverlay -- so fetchAllKmlImageOverlays and everything that skips
 * overlays read both formats the same way. */
function asGroundOverlay(feature: Feature): Feature {
  const props = feature.properties ?? {};
  if (props[IMAGE_OVERLAY_PROPERTY] !== true || typeof props.image !== "string") return feature;
  const { [IMAGE_OVERLAY_PROPERTY]: _marker, image, ...rest } = props;
  return {
    ...feature,
    properties: { ...rest, "@geometry-type": "groundoverlay", icon: `${MEDIA_HANDLE_PREFIX}${image}` },
  };
}

/** A map file's text, as GeoJSON features. The format is read off the
 * content (GeoJSON is JSON; GPX and KML differ by root element) rather
 * than the media object's stored mime, which a file attached by another
 * client may not have set to anything Gramps Connect recognizes. Throws on
 * unparseable text; features with no geometry are dropped -- a KML
 * Placemark without Point/LineString/Polygon (see @tmcw/togeojson's
 * KMLOptions.skipNullGeometry), or a GeoJSON Feature with `geometry: null`,
 * is of no use to a caller here, so dropped rather than threaded through
 * as `Feature<Geometry | null>` everywhere downstream. */
export function parseMapFile(text: string): Feature[] {
  const hasGeometry = (f: Feature<Geometry | null>): f is Feature => f.geometry != null;
  if (text.trimStart().startsWith("{")) {
    return geoJsonFeatures(JSON.parse(text) as GeoJsonObject).filter(hasGeometry).map(asGroundOverlay).map(applySimplestyle);
  }
  const dom = new DOMParser().parseFromString(text, "text/xml");
  if (dom.documentElement.localName === "gpx") {
    return gpx(dom).features.filter(hasGeometry).map(applySimplestyle);
  }
  return kml(dom).features.filter(hasGeometry);
}

/** An overlay file's SOURCE_PROPERTY, if it's GeoJSON that has one. */
export function overlaySourceOfText(text: string): string | undefined {
  if (!text.trimStart().startsWith("{")) return undefined;
  try {
    const source = (JSON.parse(text) as Record<string, unknown>)[SOURCE_PROPERTY];
    return typeof source === "string" ? source : undefined;
  } catch {
    return undefined;
  }
}

/** Every Polygon ring inside `feature` -- itself (a plain Polygon), or each
 * Polygon sub-geometry of a GeometryCollection. A country-level Wikidata/
 * Commons outline (e.g. the United States) is often a disjoint shape --
 * islands/territories a single Polygon ring can't express -- unlike a
 * state's simpler single-ring Polygon. A KML file stores one as a
 * <MultiGeometry> of several <Polygon>s, and @tmcw/togeojson reads *any* multi-child
 * Placemark geometry back as a GeometryCollection (never reconstituting
 * MultiPolygon) -- so that's the shape that actually reaches here, not
 * "MultiPolygon" itself (confirmed live, 2026-09-09, round-tripping a
 * synthetic MultiPolygon through both libraries). A non-Polygon sub-geometry
 * (there shouldn't be one -- Gramps Connect never writes anything else into a
 * region's own Placemark) is simply skipped rather than failing the whole
 * feature. `[]` for anything else (a Point, a bare LineString route, ...),
 * meaning "not a region" to every caller below. */
export function polygonRingsOf(feature: Feature): Position[][] {
  if (feature.geometry?.type === "Polygon") return [feature.geometry.coordinates[0]];
  if (feature.geometry?.type === "GeometryCollection") {
    return feature.geometry.geometries.filter((g) => g.type === "Polygon").map((g) => g.coordinates[0]);
  }
  return [];
}

/** True for a feature fetchAllKmlRegions/MapCanvas.tsx's own shapes effect
 * both treat as one drawable/controllable region -- see polygonRingsOf.
 * Exported so MapCanvas.tsx's key/hidden/opacity stamping can use the exact
 * same test fetchAllKmlRegions does: the two must never drift, or a row's
 * key stops matching the feature it's meant to control -- found live as a
 * place whose outline drew on the map (MapLibre's GeoJSON source splits a
 * GeometryCollection into one sub-feature per geometry before rendering,
 * each individually typed "Polygon") but never showed up in
 * OverlayLayersPanel.tsx's list. */
export function isKmlRegion(feature: Feature): boolean {
  return polygonRingsOf(feature).length > 0;
}

/** Every vertex of `feature` if it's a line: a LineString, a MultiLineString
 * (a GPX track with several segments) or a GeometryCollection of only
 * LineStrings (how @tmcw/togeojson reads a KML MultiGeometry -- see
 * polygonRingsOf). `[]` for anything else, meaning "not a line". */
export function lineCoordsOf(feature: Feature): Position[] {
  const geometry = feature.geometry;
  if (geometry?.type === "LineString") return geometry.coordinates;
  if (geometry?.type === "MultiLineString") return geometry.coordinates.flat();
  if (geometry?.type === "GeometryCollection" && geometry.geometries.length > 0
    && geometry.geometries.every((g) => g.type === "LineString")) {
    return geometry.geometries.flatMap((g) => (g.type === "LineString" ? g.coordinates : []));
  }
  return [];
}

/** True for a feature fetchAllKmlLines lists and MapCanvas.tsx's shapes
 * effect lets the panel hide/dim -- shared for the same reason as
 * isKmlRegion: the two must never drift apart. A region is never a line. */
export function isKmlLine(feature: Feature): boolean {
  return !isKmlRegion(feature) && lineCoordsOf(feature).length > 0;
}

/** An image overlay, as MapItemEditorDialog.tsx tracks one -- always 4
 * explicit world corners; see kmlMedia.ts's KmlImageOverlay, which this
 * mirrors on the write side. */
export interface ImageOverlay {
  handle: string;
  corners: OverlayCorners;
  name?: string;
  opacity?: number;
  order?: number;
}

/** The property marking a feature as an image overlay rather than a shape:
 * its Polygon is the image's 4 corners (top-left, top-right, bottom-right,
 * bottom-left, closed), and `image` is the picture's Media handle. This
 * app's own convention -- plain GeoJSON has no image overlays -- read back
 * by parseMapFile. */
export const IMAGE_OVERLAY_PROPERTY = "gramps:image-overlay";

function overlayFeature(overlay: ImageOverlay): Feature {
  const ring = [...overlay.corners, overlay.corners[0]];
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [ring] },
    properties: {
      [IMAGE_OVERLAY_PROPERTY]: true,
      image: overlay.handle,
      ...(overlay.name ? { name: overlay.name } : {}),
      ...(overlay.opacity !== undefined && overlay.opacity !== 1 ? { opacity: overlay.opacity } : {}),
      ...(overlay.order !== undefined ? { order: overlay.order } : {}),
    },
  };
}

/** Records which Media object an overlay was made from (mapOverlays.ts) --
 * a "foreign member" of the FeatureCollection, which GeoJSON allows. */
export const SOURCE_PROPERTY = "gramps:source";

/** Every shape plus every image overlay, as one GeoJSON FeatureCollection.
 * Overlays go last: kmlMedia.ts's region/line row indexes count every
 * feature in the file but MapCanvas.tsx's leave overlays out, and the two
 * only agree while no overlay comes before a shape. */
export function mapItemToGeoJson(features: Feature[], overlays: ImageOverlay[] = [], source?: string): string {
  const collection: FeatureCollection & { [SOURCE_PROPERTY]?: string } = {
    type: "FeatureCollection",
    ...(source ? { [SOURCE_PROPERTY]: source } : {}),
    features: [...features, ...overlays.map(overlayFeature)],
  };
  return JSON.stringify(collection);
}
