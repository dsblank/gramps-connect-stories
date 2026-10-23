// A full map for drawing and editing shapes (points, lines, polygons,
// rectangles, with terra-draw) and placing image overlays such as scanned
// old maps (move, resize, rotate, drag each corner, opacity, order). It
// edits what it's given and hands it back when asked (MapEditorHandle);
// loading and saving are the host's: Gramps Connect's MapItemEditorDialog
// reads and writes a map file on the server, the Story Editor a slide's
// place.
//
// Shapes go through map-edit's model (prepareForEditing/assembleForSaving),
// so multi-part shapes, GPS track times and properties this editor doesn't
// know survive an edit; anything terra-draw can't take is shown dashed
// ("locked") and saved back exactly as it was.
//
// Needs Mantine (like the rest of the editor), maplibre-gl, terra-draw and
// terra-draw-maplibre-gl-adapter.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import * as maplibregl from "maplibre-gl";
// maplibre's stylesheet comes with the player, which this entry includes
// (an import of it here would end up in the published declarations).
import type { Map as MapLibreMap } from "maplibre-gl";
import {
  TerraDraw, TerraDrawLineStringMode, TerraDrawPointMode, TerraDrawPolygonMode, TerraDrawRectangleMode,
  TerraDrawSelectMode,
} from "terra-draw";
import type { GeoJSONStoreFeatures, HexColor } from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import {
  Alert, Box, Button, ColorInput, Divider, Group, Kbd, List, Loader, NumberInput, SegmentedControl, Slider, Stack, Text,
  TextInput,
} from "@mantine/core";
import {
  addToSession, assembleForSaving, lockPart, mercatorBearing, mercatorDistance, prepareForEditing, rotatePoint, scalePoint,
  type EditableGeometry, type EditablePart, type EditSession, type OverlayCorners, type SavedPart,
} from "../mapEdit";
import { mapStyleUrl } from "../player/mapStyles";
import { defaultColors } from "../player/theme";
import { MAP_EDITOR_ENGLISH, type MapEditorStrings } from "./mapEditorStrings";

type DrawMode = "point" | "linestring" | "polygon" | "rectangle" | "select";

const TOOLBAR: { mode: DrawMode; label: keyof MapEditorStrings }[] = [
  { mode: "point", label: "point" },
  { mode: "linestring", label: "line" },
  { mode: "polygon", label: "polygon" },
  { mode: "rectangle", label: "rectangle" },
  { mode: "select", label: "select" },
];

// A handful of preset swatches for the color picker -- ColorInput's own
// popover still offers the full picker for anything else, this just saves
// a trip there for the common case.
const COLOR_SWATCHES = [
  "#2a78d6", "#d64545", "#3aa657", "#e0a325", "#8654c9", "#2aa7a0", "#e0678a", "#555555",
];

const EMPTY_LABEL_PREVIEW: FeatureCollection = { type: "FeatureCollection", features: [] };

/** An image overlay as the host gives and gets it: `image` is the host's
 * own name for the picture (a media handle, a story media key), turned
 * into something displayable by `resolveImage`. */
export interface MapEditorOverlay {
  image: string;
  /** Top-left, top-right, bottom-right, bottom-left, as [lng, lat]. */
  corners: OverlayCorners;
  name?: string;
  /** 0-1; undefined is fully opaque. */
  opacity?: number;
  /** Stacking rank; higher draws on top. */
  order?: number;
}

/** What's in the editor, for the host to save. */
export interface MapEditorResult {
  features: Feature[];
  overlays: MapEditorOverlay[];
}

export interface MapEditorStatus {
  /** Anything drawn or placed (shapes or images). */
  hasDrawn: boolean;
  /** Anything to save at all: drawn, placed, or locked. */
  hasContent: boolean;
}

export interface MapEditorHandle {
  /** Everything as it is now: shapes put back together (see map-edit's
   * assembleForSaving) and the image overlays. */
  getResult: () => MapEditorResult;
  /** The box around everything drawn and placed, [west, south, east,
   * north], or null with nothing there yet. */
  drawnBounds: () => [number, number, number, number] | null;
  /** Places an image in the middle of the current view, at its own aspect
   * ratio, and selects it. False if that image is already one of the
   * overlays. Throws if it can't be loaded. */
  addImage: (image: string) => Promise<boolean>;
  /** Adds shapes (an imported map file's, see parseMapFile) after what's
   * there, and frames them. */
  addFeatures: (features: Feature[]) => void;
}

export interface MapEditorProps {
  /** What to edit: null while the host is still loading it (the map shows,
   * and fills in once this arrives). Read once; later changes are
   * ignored. */
  initial: { features: Feature[]; overlays: MapEditorOverlay[] } | null;
  /** Where to look when what's loaded has nothing to frame. */
  initialView?: { center: [number, number]; zoom: number };
  /** A displayable URL for an overlay's image. */
  resolveImage: (image: string) => Promise<string>;
  /** Called with a URL from resolveImage once the editor is done with it
   * (e.g. URL.revokeObjectURL). */
  releaseImage?: (url: string) => void;
  /** Shows an Image button; the host picks one and calls addImage. */
  onAddImage?: () => void;
  onStatus?: (status: MapEditorStatus) => void;
  /** A map that wouldn't load, or a terra-draw failure. */
  onError?: (message: string) => void;
  dark?: boolean;
  /** A new shape's color until another is picked. */
  defaultColor?: string;
  /** For point labels drawn on the map. */
  labelColors?: { text: string; surface: string };
  /** Room to leave above the tool panel for the host's own bars. */
  toolbarTop?: number;
  /** Whether an image overlay has a name to edit (default true). */
  overlayNames?: boolean;
  /** More fields for the selected image overlay, below its own. */
  renderOverlayOptions?: (image: string) => ReactNode;
  strings?: Partial<MapEditorStrings>;
}

/** One placed-and-sized image overlay in this editor -- always 4 explicit
 * world corners. `id` is a local key only (React list key + maplibre
 * source/layer id prefix), not persisted.
 *
 * There's deliberately no separate "box" (north/south/east/west/rotation)
 * representation: move/resize/rotate/corner-drag all transform these same
 * 4 points directly (see mountOverlay) -- resize scales all 4 uniformly
 * from their shared center, rotate spins all 4 uniformly around it, a
 * corner drag moves just the one point -- so a plain rectangle is simply
 * the case where the 4 points happen to describe one, and resize/rotate
 * stay exactly as meaningful (and aspect-preserving) on an already-warped
 * quad as on a rectangle. The free-transform control only ever shows or
 * hides the 4 individual corner-drag handles (see showCornerHandles further
 * down) -- it never touches `corners` itself. */
interface ImageOverlayDraft extends MapEditorOverlay {
  id: string;
}

/** What's tracked per mounted image overlay -- everything needed to move
 * it (imperatively, outside React) and tear it down again. `box.corners`
 * is the live, authoritative geometry during a drag; `overlays` state
 * (committed on drag end) only needs to be right when read back and on
 * remount.
 *
 * No mousedown listener of its own -- maplibre's layer-filtered events
 * (`map.on(type, layerId, listener)`) work by hit-testing via
 * queryRenderedFeatures, which only supports vector-ish layer types
 * (circle/fill/fill-extrusion/line/symbol); a `type: "raster"` layer (what
 * an image source renders as) never matches, so a per-layer listener here
 * would simply never fire (found live: this is why clicking an image did
 * nothing at all). `startMove` is called instead by the one map-wide
 * mousedown handler in the map-setup effect, which does its own point-in-
 * box hit test against every mount's `box`. */
interface OverlayMount {
  sourceId: string;
  box: { corners: OverlayCorners };
  deleteMarker: maplibregl.Marker;
  resizeMarker: maplibregl.Marker;
  rotateMarker: maplibregl.Marker;
  /** The 4 free-transform corner handles, maplibre's own `coordinates`
   * order -- shown only while this overlay's id is in `warpHandleIds` (see
   * the selection/visibility effect below); dragging one is the only way
   * to actually turn a rectangle into a non-rectangular quad. */
  cornerMarkers: [maplibregl.Marker, maplibregl.Marker, maplibregl.Marker, maplibregl.Marker];
  startMove: (e: maplibregl.MapMouseEvent) => void;
  /** Applies a new set of corners to `box` and the live map source in one
   * step -- shared by every drag handler (move/resize/rotate/corner-drag),
   * so there's exactly one place that keeps `box` and the rendered image
   * in sync. */
  setCorners: (next: OverlayCorners) => void;
  /** Snaps every handle back onto `box`'s current corners -- called after
   * every geometry change. */
  repositionHandles: () => void;
  /** From resolveImage, given back to releaseImage on unmount, not
   * before: maplibre's `image` source keeps reading from it for as long as
   * the layer exists. */
  imageUrl: string;
}

/** See the style.load handler's own doc comment on why every image
 * overlay's raster layer is inserted directly below this one layer,
 * rather than wherever addLayer's default "on top of everything" would
 * otherwise put it. */
const OVERLAY_ANCHOR_LAYER = "image-overlay-anchor";

/** terra-draw-maplibre-gl-adapter's own fixed layer ids (its default
 * `prefixId` is "td", never overridden here -- see the `TerraDraw`
 * constructor below) -- every one of these is always created by its
 * `register()` (called via `draw.start()`), regardless of which drawing
 * modes are actually used, so this list is safe to `queryRenderedFeatures`
 * against unconditionally once `ready` is true. Used by the map's own
 * mousedown handler to tell whether a click landed on an actual drawn
 * shape before falling through to the image-overlay hit test below it. */
const TERRA_DRAW_LAYERS = ["td-polygon", "td-polygon-outline", "td-linestring", "td-point", "td-point-marker"];

/** Shapes loaded that terra-draw can't edit (see map-edit's lockPart) --
 * drawn dashed underneath, so they're still visible, and saved back
 * exactly as they were. */
const LOCKED_SOURCE = "locked-shapes";
const LOCKED_FILL_LAYER = "locked-shapes-fill";
const LOCKED_LINE_LAYER = "locked-shapes-line";

/** terra-draw's own point mode has no text-label styling (see the
 * label-preview effect below), so a labeled point's text is drawn by this
 * separate, independent geojson source/layer stacked on top of
 * terra-draw's own -- purely visual, never read back from directly
 * (getResult reads terra-draw's own snapshot, this is a mirror of it). */
const LABEL_PREVIEW_SOURCE = "label-preview";
const LABEL_PREVIEW_LAYER = "label-preview-text";

/** The tool panel sits over the map; its own background and the gaps
 * between controls let clicks through to the map below (a shape corner or
 * overlay handle that ends up under the panel's empty space would
 * otherwise be dead), the way maplibre's own control containers do. */
const TOOLBAR_CLASS = "gc-map-editor-toolbar";
const TOOLBAR_CSS = `.${TOOLBAR_CLASS} { pointer-events: none; } .${TOOLBAR_CLASS} > * { pointer-events: auto; }`;

/** The average of `corners` -- a plain centroid, not an area-weighted one,
 * which is all a resize/rotate pivot or a delete-handle position needs.
 * Corner indices are tracked by identity (index 0 is always "whichever
 * point started as top-left", however far move/resize/rotate/warp has
 * since carried it), so this stays a stable, sensible center throughout. */
function overlayCenter(corners: OverlayCorners): [number, number] {
  let lng = 0, lat = 0;
  for (const [x, y] of corners) { lng += x; lat += y; }
  return [lng / 4, lat / 4];
}

/** The rotate handle's own resting position -- beyond the midpoint of the
 * corners[0]-corners[1] edge (this overlay's "top" edge, by index, however
 * it's currently oriented), extended further out from `center` so the
 * handle doesn't crowd that edge. Since this is recomputed from the
 * *current* corners every time (not from a persisted rotation angle), it
 * naturally orbits the shape as move/resize/rotate/corner-drag change it,
 * the standard "stalk above a selected object" rotate-handle convention --
 * with no separate "unrotated" reference frame needed. */
function rotateHandleAnchor(corners: OverlayCorners, center: [number, number]): [number, number] {
  const [topLeft, topRight] = corners;
  const topMid: [number, number] = [(topLeft[0] + topRight[0]) / 2, (topLeft[1] + topRight[1]) / 2];
  return [center[0] + (topMid[0] - center[0]) * 1.5, center[1] + (topMid[1] - center[1]) * 1.5];
}

/** Whether `point` (screen pixels) falls inside the convex quad described
 * by `corners` (in order around the shape) -- a plain same-side-of-every-
 * edge cross-product test, since a rotated overlay's screen footprint
 * isn't an axis-aligned rectangle a simple min/max bounds check could
 * handle anymore. */
function pointInQuad(point: { x: number; y: number }, corners: { x: number; y: number }[]): boolean {
  let sign = 0;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (cross === 0) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

// How see-through a dragged overlay image gets, so whatever's underneath
// (other images, map features) is visible for positioning it precisely.
const OVERLAY_DRAG_OPACITY = 0.5;

// zIndex above the floating left toolbar's own 3 (see its `Stack` style
// further down) -- that toolbar is positioned absolutely over the map
// itself and grows taller once an overlay is selected (its "Edit Options"
// section), so a handle whose current corner happens to land underneath
// it would otherwise be unclickable: the toolbar, not the handle, receives
// the click. Found live: rotating an overlay a little was enough to swing
// its resize handle under that panel. Plain maplibre markers have no
// z-index of their own (auto), so this alone is enough to always win.
const OVERLAY_HANDLE_STYLE = {
  width: "20px", height: "20px", borderRadius: "50%", background: "white",
  border: "2px solid #333", display: "flex", alignItems: "center", justifyContent: "center",
  fontSize: "12px", fontWeight: "700", color: "#333", cursor: "pointer",
  boxShadow: "0 1px 3px rgba(0,0,0,0.4)", userSelect: "none", zIndex: 4,
} as const;

function loadImageElement(src: string, failed: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(failed));
    img.src = src;
  });
}

function extendBounds(bounds: maplibregl.LngLatBounds, geometry: Geometry): void {
  if (geometry.type === "Point") {
    bounds.extend(geometry.coordinates as [number, number]);
  } else if (geometry.type === "LineString") {
    for (const c of geometry.coordinates) bounds.extend(c as [number, number]);
  } else if (geometry.type === "Polygon") {
    for (const ring of geometry.coordinates) for (const c of ring) bounds.extend(c as [number, number]);
  }
}

export const MapEditor = forwardRef<MapEditorHandle, MapEditorProps>(function MapEditor({
  initial, initialView, resolveImage, releaseImage, onAddImage, onStatus, onError, dark = false, defaultColor, labelColors,
  toolbarTop = 12, overlayNames = true, renderOverlayOptions, strings: stringOverrides,
}, ref) {
  const strings = { ...MAP_EDITOR_ENGLISH, ...stringOverrides };
  // Callbacks and words the once-per-map listeners below read, kept live.
  const live = useRef({ strings, resolveImage, releaseImage, onError });
  live.current = { strings, resolveImage, releaseImage, onError };
  const fail = (message: string) => live.current.onError?.(message);
  const release = (url: string) => live.current.releaseImage?.(url);

  // A callback ref surfaced as state, not a plain useRef -- a host may put
  // this inside a Mantine Modal, whose own children aren't necessarily
  // committed to the DOM in the same pass as this component's first render
  // (found live: a plain `useRef` read inside a `[]`-effect saw `null`
  // every time, so the map/draw setup below never ran at all). Assigning
  // the DOM node to state instead means the effect below (keyed on
  // `containerEl`) reliably fires once it's actually mounted.
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  // Image overlays live outside terra-draw entirely (see ImageOverlayDraft's
  // own doc comment) -- this is their bookkeeping, keyed by
  // ImageOverlayDraft.id, imperative like drawRef itself.
  const overlayMountsRef = useRef<Map<string, OverlayMount>>(new Map());
  const [mode, setMode] = useState<DrawMode>("select");
  // Mirrors `mode` state for the finish listener set up once below (same
  // reasoning as colorRef just under this) -- lets it tell a just-finished
  // region (polygon/rectangle) apart from a point/line, since it's
  // registered once per map rather than fresh on every `mode` change.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [ready, setReady] = useState(false);
  // The color a newly-finished shape takes (draw.on("finish") below), and
  // -- when a shape is currently selected -- what changing this recolors
  // in place.
  const [color, setColor] = useState(() => defaultColor ?? defaultColors(dark).mark);
  // Mirrors `color` state for the terra-draw styling functions/listeners
  // set up once (keyed on `containerEl`, see that effect) below -- they
  // close over this ref instead of `color` itself so a later color change
  // doesn't need the whole map/draw instance rebuilt to see it.
  const colorRef = useRef(color);
  colorRef.current = color;
  // A region's (polygon/rectangle) fill opacity, same pattern as `color`:
  // both a newly-finished region's own opacity and, while one is selected,
  // what changing this edits in place. 0.25 matches Gramps Connect's map
  // view default, so an untouched region renders the same there.
  const [opacity, setOpacity] = useState(0.25);
  const opacityRef = useRef(opacity);
  opacityRef.current = opacity;
  // The selected point/region's own `name` (a point's label text, or a
  // region's purely-descriptive name), mirroring `color`'s own pattern --
  // NOT derived from getSnapshot() on every render, since
  // updateFeatureProperties (called on every keystroke below) doesn't
  // itself trigger a re-render, which would leave a derived value stuck
  // showing whatever it read on the last unrelated render. Seeded/cleared
  // by the select/deselect listeners below instead.
  const [labelText, setLabelText] = useState("");
  // Populated fresh every render by the effect below -- lets the map-setup
  // effect's own terra-draw listeners (registered once, see colorRef's own
  // doc comment on this pattern) call the latest refreshLabelPreview
  // without closing over a stale `labelText`.
  const refreshLabelPreviewRef = useRef<(() => void) | null>(null);
  // terra-draw's own select mode only ever has zero or one feature
  // selected at a time (see TOOLBAR's "select" mode) -- this mirrors that
  // via draw.on("select"/"deselect") so the color picker knows whether a
  // change should recolor something instead of just setting the next
  // shape's color.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Mirrors `selectedId` for the canvas keydown listener set up once
  // below (Backspace-deletes-the-selection), same reasoning as colorRef.
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const labelColorsRef = useRef(labelColors ?? defaultColors(dark));
  labelColorsRef.current = labelColors ?? defaultColors(dark);
  // Keeps LABEL_PREVIEW_SOURCE (the editor's own text-rendering layer,
  // added in the style.load handler below since terra-draw's point mode
  // can't render text itself) in sync with every named point -- including,
  // for the currently selected feature only, `labelText` itself rather
  // than its last-saved `name` property, so a keystroke shows up
  // immediately instead of only once the point is deselected (terra-draw's
  // updateFeatureProperties, called on every keystroke by the text field
  // below, doesn't reliably fire draw's own "change" event).
  useEffect(() => {
    const draw = drawRef.current;
    const map = mapRef.current;
    const source = map?.getSource(LABEL_PREVIEW_SOURCE) as maplibregl.GeoJSONSource | undefined;
    const refresh = () => {
      const currentDraw = drawRef.current;
      const currentSource = mapRef.current?.getSource(LABEL_PREVIEW_SOURCE) as maplibregl.GeoJSONSource | undefined;
      if (!currentDraw || !currentSource) return;
      const features: Feature[] = [];
      for (const f of currentDraw.getSnapshot()) {
        if (f.geometry?.type !== "Point") continue;
        const isSelected = String(f.id) === selectedId;
        const name = (isSelected ? labelText : (f.properties?.name as string | undefined))?.trim();
        if (!name) continue;
        features.push({
          type: "Feature", geometry: f.geometry,
          properties: { name, color: f.properties?.color as string | undefined },
        });
      }
      currentSource.setData({ type: "FeatureCollection", features });
    };
    refreshLabelPreviewRef.current = refresh;
    if (draw && source) refresh();
  }, [labelText, selectedId]);
  // Every placed image overlay -- a wholly separate system from terra-draw
  // (which has no image geometry type), see the block of effects/handlers
  // below this component's map-setup effect.
  const [overlays, setOverlays] = useState<ImageOverlayDraft[]>([]);
  // Mirrors `overlays` for startMove's onUp (below), set up once per mount
  // and so unable to see a later opacity edit via closure alone -- same
  // colorRef/selectedIdRef pattern as elsewhere in this file.
  const overlaysRef = useRef(overlays);
  overlaysRef.current = overlays;
  // Which overlay's move/resize/delete handles are currently showing --
  // set on mousedown over that overlay's image (see mountOverlay), cleared
  // by clicking anywhere else on the map (see the map-setup effect's own
  // mousedown handler) or by deleting the selected overlay itself.
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  // Which overlays currently show their 4 free-transform corner handles
  // (in addition to the always-available delete/resize/rotate) -- purely a
  // display preference, never touched by geometry (see
  // setCornerHandlesVisible's own doc comment), so it lives here rather
  // than on ImageOverlayDraft/`overlays` state.
  const [warpHandleIds, setWarpHandleIds] = useState<Set<string>>(new Set());
  // Whether terra-draw currently holds any shape.
  const [hasFeatures, setHasFeatures] = useState(false);
  // What was set aside when loading (map-edit's model) -- the properties,
  // multi-part groups and track times terra-draw doesn't keep, put back by
  // getResult. Null with nothing loaded.
  const sessionRef = useRef<EditSession | null>(null);
  // How many of the loaded shapes terra-draw couldn't take, shown locked.
  const [lockedCount, setLockedCount] = useState(0);
  const [lockedNoticeDismissed, setLockedNoticeDismissed] = useState(false);

  const hasDrawn = hasFeatures || overlays.length > 0;
  const hasContent = hasDrawn || lockedCount > 0;
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  useEffect(() => { onStatusRef.current?.({ hasDrawn, hasContent }); }, [hasDrawn, hasContent]);

  useEffect(() => {
    if (!containerEl) return;
    const map = new maplibregl.Map({
      container: containerEl,
      style: mapStyleUrl(dark, null),
      center: [0, 20],
      zoom: 1.5,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    // maplibre's own default: holding Ctrl and dragging (or a two-finger
    // touch twist) rotates/pitches the *camera*, which collides directly
    // with terra-draw's own rotate gesture for rotating a *selected shape*
    // (see the select mode's `rotateable` flag below) -- found live,
    // holding the rotate key and dragging a vertex was spinning the whole
    // map instead of the shape. This editor has no use for a tilted/
    // rotated basemap anyway, so the camera's own rotate/pitch is disabled
    // outright rather than trying to make the two coexist.
    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();

    // Every drawing mode's color comes from the feature's own `color`
    // property, not a fixed style -- colorRef (above) is what the styling
    // functions actually read, kept live via a ref rather than closing
    // over `color` state directly, since these mode instances are built
    // once per map (this effect is keyed on `containerEl`, not `color`)
    // and terra-draw calls a styling function fresh on every render, not
    // just at construction time.
    const readColor = (feature: GeoJSONStoreFeatures): HexColor =>
      (feature.properties.color as HexColor | undefined) ?? (colorRef.current as HexColor);
    // Same pattern as readColor, for a region's own `opacity` property --
    // only polygon/rectangle modes take a `fillOpacity` style at all (point/
    // line have nothing to fill).
    const readOpacity = (feature: GeoJSONStoreFeatures): number =>
      (feature.properties.opacity as number | undefined) ?? opacityRef.current;

    const draw = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map }),
      modes: [
        new TerraDrawPointMode({ styles: { pointColor: readColor } }),
        new TerraDrawLineStringMode({ styles: { lineStringColor: readColor } }),
        new TerraDrawPolygonMode({ styles: { fillColor: readColor, fillOpacity: readOpacity, outlineColor: readColor } }),
        new TerraDrawRectangleMode({ styles: { fillColor: readColor, fillOpacity: readOpacity, outlineColor: readColor } }),
        // Dragging (both a whole feature and its individual vertices) and
        // deletion (terra-draw's own default keybinding, Delete/Backspace
        // on the current selection) are what this editor needs from
        // Select for every mode; `rotateable` additionally turns on
        // terra-draw's own built-in rotate gesture (hold R while dragging
        // a selected shape's vertex) for anything 2D enough for "rotate"
        // to mean something -- not `point`, a single vertex has nothing to
        // rotate around.
        new TerraDrawSelectMode({
          // While a feature is selected, terra-draw renders it through
          // *this* mode's own styling, not the drawing mode that created it
          // (see TerraDraw's own per-feature style dispatch: only the
          // selected feature goes through TerraDrawSelectMode.styleFeature;
          // every other feature keeps using its own mode's, which is why an
          // unselected shape's color/opacity already reflects its own
          // properties fine). Without these, the selected-state styling
          // falls back to terra-draw's fixed defaults regardless of
          // `feature.properties` -- so dragging the opacity slider (or
          // recoloring) while a shape is actively selected had no visible
          // effect until it was deselected. Found live.
          styles: {
            selectedPointColor: readColor,
            selectedLineStringColor: readColor,
            selectedPolygonColor: readColor,
            selectedPolygonOutlineColor: readColor,
            selectedPolygonFillOpacity: readOpacity,
          },
          // Half terra-draw's own default (40px) -- with labels sitting
          // right next to their point (see LABEL_PREVIEW_LAYER's
          // text-offset below) and vertices sometimes placed close
          // together, the default hit-test radius made clicking one point
          // too likely to grab a neighboring one instead. Found live.
          pointerDistance: 20,
          // Every field restated (terra-draw's own type doesn't allow a
          // partial override), only `rotate` actually changed from its
          // default -- plain "r" instead of the default Ctrl+R, an
          // awkward two-handed chord to hold through an entire drag. Bare
          // "r" is safe here the same way Backspace-delete is (see the
          // canvas keydown listener below): terra-draw's own keydown
          // listener is bound to the map canvas specifically, so it never
          // fires while typing "r" into a text field.
          keyEvents: { deselect: "Escape", delete: "Delete", rotate: ["r"], scale: ["Control", "s"] },
          flags: {
            point: { feature: { draggable: true } },
            linestring: {
              feature: {
                draggable: true, rotateable: true,
                coordinates: { draggable: true, deletable: true, midpoints: true },
              },
            },
            polygon: {
              feature: {
                draggable: true, rotateable: true,
                coordinates: { draggable: true, deletable: true, midpoints: true },
              },
            },
            rectangle: {
              feature: {
                draggable: true, rotateable: true,
                coordinates: { draggable: true, deletable: true, midpoints: true },
              },
            },
          },
        }),
      ],
    });
    drawRef.current = draw;
    draw.on("change", () => {
      // Same guidance-point exclusion as getResult's own filter below --
      // otherwise a shape's selection handles alone (nothing actually
      // drawn) would count as "has features".
      setHasFeatures(
        draw.getSnapshot().some((f) => f.geometry != null && !f.properties?.selectionPoint && !f.properties?.midPoint),
      );
      refreshLabelPreviewRef.current?.();
    });
    // Shared by the "select" listener below and the finish handler just
    // under it: selecting an existing feature and just having finished
    // drawing a new one both need the color/opacity/label widgets to catch
    // up to *that* feature's own properties, not whatever the toolbar was
    // last left showing. `id` null means deselected -- nothing to edit, so
    // the widgets themselves go away entirely (see selectedFeature/
    // selectedIsRegion in the render body below).
    function syncSelection(id: string | null) {
      setSelectedId(id);
      const feature = id ? draw.getSnapshot().find((f) => String(f.id) === id) : undefined;
      setLabelText((feature?.properties?.name as string | undefined) ?? "");
      if (feature) {
        setColor((feature.properties?.color as string | undefined) ?? colorRef.current);
        setOpacity((feature.properties?.opacity as number | undefined) ?? 0.25);
        // Mirrors the overlay mousedown handler's own deselectFeature call
        // -- an image overlay and a drawn shape are mutually exclusive
        // selections, so a shape becoming selected clears any overlay
        // selection the same way.
        setSelectedOverlayId(null);
      }
    }
    // A shape takes the toolbar's current color (and, for a region, opacity)
    // the moment it's finished drawing -- colorRef/opacityRef (not `color`/
    // `opacity` state) since this listener, like the mode instances above,
    // is registered once per map. Opacity only for polygon/rectangle (both
    // land here as "polygon"/"rectangle" -- see modeRef): a point or line
    // has no fill for it to mean anything on.
    draw.on("finish", (id) => {
      const isRegion = modeRef.current === "polygon" || modeRef.current === "rectangle";
      draw.updateFeatureProperties(
        id,
        isRegion ? { color: colorRef.current, opacity: opacityRef.current } : { color: colorRef.current },
      );
      // Every finished shape drops straight into Select mode with itself
      // selected -- lets someone place a boundary, say, and immediately
      // see/adjust its color and opacity without an extra click to the
      // Select tool and back onto the shape it just placed.
      draw.setMode("select");
      setMode("select");
      draw.selectFeature(id);
      syncSelection(String(id));
    });
    draw.on("select", (id) => syncSelection(String(id)));
    draw.on("deselect", () => syncSelection(null));

    // terra-draw's own delete keybinding only recognizes the literal
    // "Delete" key (terra-draw-maplibre-gl-adapter's default keyEvents) --
    // on a Mac laptop keyboard, the key labelled "delete" actually sends
    // "Backspace" (only Fn+Delete sends "Delete"), so without this a Mac
    // user's most natural keypress would silently do nothing. Bound to
    // the same canvas element terra-draw's own keydown listener uses
    // (getMapEventElement() in that adapter), so -- like terra-draw's own
    // handler -- this only fires while the map canvas has focus, never
    // while typing in a text field.
    const canvas = map.getCanvas();
    const onCanvasKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Backspace" || !selectedIdRef.current) return;
      try {
        draw.removeFeatures([selectedIdRef.current]);
      } catch {
        // Selection may already be stale (e.g. removed some other way) --
        // nothing more to do.
      }
      setSelectedId(null);
    };
    canvas.addEventListener("keydown", onCanvasKeyDown);

    // Some WebKit-based environments (found live: a desktop build's native
    // window) never dispatch PointerEvents for mouse input, even though
    // ordinary MouseEvents work fine there -- map pan/zoom and the
    // image-overlay drag below both ride on mousedown/mousemove/mouseup and
    // both work. terra-draw's own Select mode listens *exclusively* for
    // pointerdown/pointermove/pointerup on the map canvas (see
    // TerraDrawBaseAdapter), so without a bridge, selecting a shape to drag
    // it silently does nothing on such a platform while every other
    // gesture in this editor keeps working. Detected once at runtime -- a
    // "mousedown" on the canvas not followed by a real "pointerdown" within
    // a frame means this environment isn't dispatching pointer events for
    // mouse input at all, so from then on every mouse event on the canvas
    // is re-dispatched as the equivalent pointer event. terra-draw's own
    // listeners only read clientX/clientY/button/isPrimary/target, none of
    // which require an actual PointerEvent instance -- a MouseEvent with
    // `isPrimary` patched on satisfies them exactly the same.
    let sawNativePointerdown = false;
    let pointerBridgeActive = false;
    let pendingFirstMouseDown: MouseEvent | null = null;
    const onNativePointerDown = () => { sawNativePointerdown = true; };
    canvas.addEventListener("pointerdown", onNativePointerDown, { once: true });
    const dispatchAsPointerEvent = (type: string, e: MouseEvent) => {
      const synthetic = new MouseEvent(type, {
        bubbles: true, cancelable: true, view: window,
        clientX: e.clientX, clientY: e.clientY, button: e.button, buttons: e.buttons,
      });
      Object.defineProperty(synthetic, "isPrimary", { value: true });
      canvas.dispatchEvent(synthetic);
    };
    const onMouseDownBridge = (e: MouseEvent) => {
      if (pointerBridgeActive) { dispatchAsPointerEvent("pointerdown", e); return; }
      if (sawNativePointerdown) return;
      pendingFirstMouseDown = e;
      requestAnimationFrame(() => {
        if (sawNativePointerdown || !pendingFirstMouseDown) return;
        pointerBridgeActive = true;
        dispatchAsPointerEvent("pointerdown", pendingFirstMouseDown);
        pendingFirstMouseDown = null;
      });
    };
    const onMouseMoveBridge = (e: MouseEvent) => { if (pointerBridgeActive) dispatchAsPointerEvent("pointermove", e); };
    const onMouseUpBridge = (e: MouseEvent) => { if (pointerBridgeActive) dispatchAsPointerEvent("pointerup", e); };
    canvas.addEventListener("mousedown", onMouseDownBridge);
    canvas.addEventListener("mousemove", onMouseMoveBridge);
    canvas.addEventListener("mouseup", onMouseUpBridge);

    // Selects whichever image overlay (if any) was clicked, deselects
    // otherwise, and kicks off that overlay's move-drag -- all in one
    // map-wide handler rather than a per-overlay one, since raster/image
    // layers can't be hit-tested via maplibre's layer-filtered events (see
    // OverlayMount's own doc comment). Does its own point-in-quad check
    // (a rotated overlay's screen footprint isn't axis-aligned) against
    // every mounted overlay's live geometry, topmost (last-added) first,
    // mirroring how they're actually layered on screen.
    map.on("mousedown", (e) => {
      // Marker handles (delete/resize/rotate/corner) are DOM elements
      // appended into maplibre's own canvas container, not the canvas
      // itself -- they still receive this same "mousedown" event, so
      // without this check a click that landed on one would also match the
      // point-in-quad test below (a handle sits right at or near the box's
      // own edge) and start a move, fighting the marker's own native drag
      // (found live: dragging the resize handle just moved the image
      // instead of resizing it -- the same bug recurred for the 4 warp-
      // mode corner handles until they were added to this same check).
      // Bail out entirely for a click on any handle and let its own
      // listener (Marker's built-in drag, or the delete element's own
      // click handler) run uncontested.
      const target = e.originalEvent.target;
      if (target instanceof Node) {
        for (const mount of overlayMountsRef.current.values()) {
          if (
            mount.deleteMarker.getElement().contains(target)
            || mount.resizeMarker.getElement().contains(target)
            || mount.rotateMarker.getElement().contains(target)
            || mount.cornerMarkers.some((marker) => marker.getElement().contains(target))
          ) return;
        }
      }
      // A drawn shape (point/line/region) always renders above every image
      // overlay in this editor (see OVERLAY_ANCHOR_LAYER's own doc
      // comment), but the point-in-quad test below has no notion of that --
      // it only asks "is this pixel inside some overlay's bounds", so a
      // shape drawn on top of (or overlapping) an image used to have its
      // clicks hijacked into moving that image out from under it instead of
      // ever reaching terra-draw's own selection. Found live: a rectangle
      // sitting over an image overlay was simply unclickable. Checking what
      // maplibre actually rendered at this pixel first -- rather than
      // reimplementing terra-draw's own per-geometry-type hit testing here
      // -- defers to terra-draw whenever a shape is really the topmost
      // thing at this point, same as a sighted user would expect from what
      // they're looking at.
      if (map.queryRenderedFeatures(e.point, { layers: TERRA_DRAW_LAYERS }).length > 0) return;
      const mounts = [...overlayMountsRef.current.entries()].reverse();
      for (const [id, mount] of mounts) {
        const corners = mount.box.corners.map((c) => map.project(c));
        if (pointInQuad(e.point, corners)) {
          // An image overlay and a drawn shape are mutually exclusive
          // selections -- deselect any terra-draw feature first, or its
          // own color/name/opacity controls would keep showing alongside
          // this overlay's, none of them meaningful for the other's kind
          // of item. Found live.
          if (selectedIdRef.current) draw.deselectFeature(selectedIdRef.current);
          setSelectedOverlayId(id);
          mount.startMove(e);
          return;
        }
      }
      setSelectedOverlayId(null);
    });

    // A failed style/tile fetch is the one thing that can leave this view
    // blank for a reason the user can't guess.
    map.on("error", (e) => {
      const message = (e.error as Error | undefined)?.message ?? "";
      if (/style|sprite|tile|fetch|network|Failed/i.test(message)) fail(message || live.current.strings.basemapFailed);
    });

    map.on("style.load", () => {
      // draw.start() registers terra-draw's own sources/layers on the map,
      // which maplibre only allows once the style has actually finished
      // loading -- wrapped so a failure here (a version mismatch, a mode
      // misconfiguration, ...) surfaces as a visible error instead of
      // leaving `ready` false forever.
      try {
        // A permanent, invisible layer added before draw.start() -- image
        // overlays (mountOverlay below) always insert themselves directly
        // below this anchor, so they stay under terra-draw's own shape
        // layers (added next, appended above everything as normal) no
        // matter what order shapes/images actually get added in during the
        // session: images first, geometries on top, matching how a photo
        // of an old map should sit relative to pins/routes drawn over it.
        map.addLayer({ id: OVERLAY_ANCHOR_LAYER, type: "background", paint: { "background-opacity": 0 } });
        map.addSource(LOCKED_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({
          id: LOCKED_FILL_LAYER, type: "fill", source: LOCKED_SOURCE,
          filter: ["==", ["geometry-type"], "Polygon"],
          paint: { "fill-color": ["coalesce", ["get", "color"], "#888888"], "fill-opacity": 0.15 },
        });
        map.addLayer({
          id: LOCKED_LINE_LAYER, type: "line", source: LOCKED_SOURCE,
          filter: ["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "LineString"]],
          paint: { "line-color": ["coalesce", ["get", "color"], "#888888"], "line-width": 2, "line-dasharray": [2, 2] },
        });
        draw.start();
        draw.setMode("select");
        // Added after draw.start() so it stacks above terra-draw's own
        // point layer -- see LABEL_PREVIEW_SOURCE's own doc comment on why
        // this mirror exists at all. refreshLabelPreviewRef is populated by
        // the effect above; called once here too, in case any features
        // were already loaded before this handler ran.
        const colors = labelColorsRef.current;
        map.addSource(LABEL_PREVIEW_SOURCE, { type: "geojson", data: EMPTY_LABEL_PREVIEW });
        map.addLayer({
          id: LABEL_PREVIEW_LAYER,
          type: "symbol",
          source: LABEL_PREVIEW_SOURCE,
          layout: {
            "text-field": ["get", "name"],
            "text-size": 12,
            "text-font": ["Noto Sans Regular"],
            // Offset right rather than centered on the point -- centered
            // text sat directly on top of the point, making it hard to see
            // (and, in the real map views, click) the point itself.
            "text-anchor": "left",
            "text-offset": [0.6, 0],
          },
          paint: {
            "text-color": ["coalesce", ["get", "color"], colors.text],
            "text-halo-color": colors.surface,
            "text-halo-width": 1.5,
          },
        });
        refreshLabelPreviewRef.current?.();
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err));
      } finally {
        setReady(true);
      }
    });

    return () => {
      draw.stop();
      canvas.removeEventListener("keydown", onCanvasKeyDown);
      canvas.removeEventListener("pointerdown", onNativePointerDown);
      canvas.removeEventListener("mousedown", onMouseDownBridge);
      canvas.removeEventListener("mousemove", onMouseMoveBridge);
      canvas.removeEventListener("mouseup", onMouseUpBridge);
      // Markers aren't part of the map's own style/source tree -- map.remove()
      // below doesn't clean these up on its own.
      for (const mount of overlayMountsRef.current.values()) {
        mount.deleteMarker.remove();
        mount.resizeMarker.remove();
        mount.rotateMarker.remove();
        for (const marker of mount.cornerMarkers) marker.remove();
        release(mount.imageUrl);
      }
      overlayMountsRef.current.clear();
      map.remove();
      mapRef.current = null;
      drawRef.current = null;
    };
    // `dark` only matters for the very first style URL -- a scheme flip
    // while this editor happens to be open isn't worth a style reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerEl]);

  // Mounts one image overlay onto the live map: a maplibre `image` source +
  // `raster` layer (created once, then moved/resized via setCoordinates
  // rather than recreated) plus its handles and a whole-image move
  // gesture. Called both when a new image is added and when the initial
  // overlays are loaded in (the effect below).
  async function mountOverlay(overlay: ImageOverlayDraft) {
    const map = mapRef.current;
    if (!map) return;
    const sourceId = `img-${overlay.id}`;
    const box: { corners: OverlayCorners } = { corners: overlay.corners };
    const imageUrl = await live.current.resolveImage(overlay.image);
    map.addSource(sourceId, { type: "image", url: imageUrl, coordinates: box.corners });
    // beforeId keeps this under terra-draw's own shape layers -- see
    // OVERLAY_ANCHOR_LAYER's own doc comment.
    map.addLayer({ id: sourceId, type: "raster", source: sourceId }, OVERLAY_ANCHOR_LAYER);
    map.setPaintProperty(sourceId, "raster-opacity", overlay.opacity ?? 1);

    // The live geometry during a drag -- `overlays` state (below) is only
    // synced at gesture end, both for perf (no re-render per drag frame)
    // and because it's only read back at the end, not mid-drag.
    const setCorners = (next: OverlayCorners) => {
      box.corners = next;
      (map.getSource(sourceId) as maplibregl.ImageSource | undefined)?.setCoordinates(box.corners);
    };
    const commit = () => {
      setOverlays((prev) => prev.map((o) => (o.id === overlay.id ? { ...o, corners: box.corners } : o)));
    };

    // Not added to the map yet -- all handles are selection-gated (see the
    // sync effect below), same as terra-draw's own vertex handles only
    // showing up once a shape is actually selected, rather than cluttering
    // every image on screen with several more controls all the time.
    const words = live.current.strings;
    const deleteEl = document.createElement("div");
    deleteEl.textContent = "×";
    deleteEl.title = words.removeImage;
    Object.assign(deleteEl.style, OVERLAY_HANDLE_STYLE);
    const deleteMarker = new maplibregl.Marker({ element: deleteEl, anchor: "center" });
    deleteEl.addEventListener("click", (e) => {
      e.stopPropagation();
      unmountOverlay(overlay.id);
      setOverlays((prev) => prev.filter((o) => o.id !== overlay.id));
      setSelectedOverlayId((current) => (current === overlay.id ? null : current));
    });

    const resizeEl = document.createElement("div");
    resizeEl.textContent = "↘";
    resizeEl.title = words.resizeImage;
    Object.assign(resizeEl.style, OVERLAY_HANDLE_STYLE);
    const resizeMarker = new maplibregl.Marker({ element: resizeEl, anchor: "center", draggable: true });
    // Captured at the start of each drag: the corners and the handle's own
    // distance from their shared center right then, so every subsequent
    // "drag" frame computes one clean scale factor relative to the drag's
    // own start (distance-now / distance-then) rather than compounding a
    // per-frame ratio, which would drift.
    let resizeStartCorners: OverlayCorners = box.corners;
    let resizeStartDist = 1;
    resizeMarker.on("dragstart", () => {
      resizeStartCorners = box.corners;
      const center = overlayCenter(resizeStartCorners);
      const p = resizeMarker.getLngLat();
      resizeStartDist = Math.max(1e-9, mercatorDistance(center, [p.lng, p.lat]));
    });
    resizeMarker.on("drag", () => {
      // Scales every corner's distance from their shared center by the
      // same factor (in Mercator-projected space -- see scalePoint's own
      // doc comment), so this works identically whether the current
      // corners describe a plain rectangle or an already-warped quad: the
      // exact shape is preserved either way, just bigger or smaller. No
      // separate "aspect ratio" to track at all -- a uniform scale from
      // center can't distort it.
      const center = overlayCenter(resizeStartCorners);
      const p = resizeMarker.getLngLat();
      const scale = Math.max(0.02, mercatorDistance(center, [p.lng, p.lat]) / resizeStartDist);
      setCorners(resizeStartCorners.map((c) => scalePoint(c, center, scale)) as OverlayCorners);
      repositionHandles();
    });
    resizeMarker.on("dragend", commit);

    const rotateEl = document.createElement("div");
    rotateEl.textContent = "↻";
    rotateEl.title = words.rotateImage;
    Object.assign(rotateEl.style, OVERLAY_HANDLE_STYLE);
    const rotateMarker = new maplibregl.Marker({ element: rotateEl, anchor: "center", draggable: true });
    // Same start-of-drag capture as resize, but for an angle instead of a
    // distance: every "drag" frame rotates the *start* corners by
    // (current handle bearing - start handle bearing), an incremental
    // delta from center rather than an absolute angle -- there's no
    // persisted "rotation" field to be absolute relative to anymore (see
    // rotateHandleAnchor's own doc comment on why that's fine).
    let rotateStartCorners: OverlayCorners = box.corners;
    let rotateStartAngle = 0;
    rotateMarker.on("dragstart", () => {
      rotateStartCorners = box.corners;
      const center = overlayCenter(rotateStartCorners);
      const p = rotateMarker.getLngLat();
      rotateStartAngle = mercatorBearing(center, [p.lng, p.lat]);
    });
    rotateMarker.on("drag", () => {
      const center = overlayCenter(rotateStartCorners);
      const p = rotateMarker.getLngLat();
      const delta = mercatorBearing(center, [p.lng, p.lat]) - rotateStartAngle;
      setCorners(rotateStartCorners.map((c) => rotatePoint(c, center, delta)) as OverlayCorners);
      repositionHandles();
    });
    rotateMarker.on("dragend", commit);

    // Free-transform's 4 independent corner handles -- one per index of
    // maplibre's own `coordinates` order (top-left, top-right,
    // bottom-right, bottom-left). Each drag writes only its own corner,
    // leaving the other 3 exactly where they were -- the actual "rubber
    // sheet" warp, as opposed to resize/rotate's whole-shape transforms.
    const cornerMarkers = [0, 1, 2, 3].map((i) => {
      const el = document.createElement("div");
      el.title = words.warpCorner;
      Object.assign(el.style, OVERLAY_HANDLE_STYLE);
      const marker = new maplibregl.Marker({ element: el, anchor: "center", draggable: true });
      marker.on("drag", () => {
        const corners = [...box.corners] as OverlayCorners;
        const p = marker.getLngLat();
        corners[i] = [p.lng, p.lat];
        setCorners(corners);
        repositionHandles();
      });
      marker.on("dragend", commit);
      return marker;
    }) as [maplibregl.Marker, maplibregl.Marker, maplibregl.Marker, maplibregl.Marker];

    // Snaps every handle back onto the box's current corners -- called
    // after every geometry change (move, resize, rotate, corner drag) so
    // they stay glued to the image instead of drifting back to a stale
    // position. Delete/resize/rotate always track the actual corners (no
    // separate "rect" representation to fall back to); the 4 corner
    // handles are additionally repositioned here too, since a resize or
    // rotate gesture moves them right along with everything else.
    const repositionHandles = () => {
      const [topLeft, topRight, bottomRight, bottomLeft] = box.corners;
      const center = overlayCenter(box.corners);
      deleteMarker.setLngLat(center);
      resizeMarker.setLngLat(bottomRight);
      rotateMarker.setLngLat(rotateHandleAnchor(box.corners, center));
      cornerMarkers[0].setLngLat(topLeft);
      cornerMarkers[1].setLngLat(topRight);
      cornerMarkers[2].setLngLat(bottomRight);
      cornerMarkers[3].setLngLat(bottomLeft);
    };

    // Move -- dragging anywhere on the image itself (not a small handle;
    // the image can be much bigger than one). Called by the map-wide
    // mousedown handler in the map-setup effect once its own point-in-box
    // test picks this overlay out (see OverlayMount's own doc comment on
    // why that test exists instead of a listener here). Tracked via plain
    // document listeners rather than map-scoped ones so a fast drag that
    // leaves the map div doesn't get stuck without a mouseup.
    const startMove = (e: maplibregl.MapMouseEvent) => {
      e.preventDefault();
      map.dragPan.disable();
      // Nearly-transparent while being dragged so whatever's underneath
      // (other images, the base map) stays visible for positioning --
      // restored on mouseup.
      map.setPaintProperty(sourceId, "raster-opacity", OVERLAY_DRAG_OPACITY);
      // In screen pixels, not raw lng/lat degrees -- a fixed degree offset
      // covers a different on-screen distance depending on latitude (Web
      // Mercator isn't uniformly scaled north-south), so translating this
      // way visibly grew/shrank the image as it crossed latitudes mid-drag,
      // even though its own lat/lng span never actually changed. Found
      // live. Projecting each corner once up front, shifting all of them by
      // the same pixel delta the cursor has moved, and unprojecting back
      // keeps the dragged image's on-screen size constant -- the same
      // "work in projected space, not raw degrees" fix rotatePoint/
      // scalePoint already apply to rotate/resize (see their own doc
      // comments), just via maplibre's own project/unproject here, since
      // screen pixels (not zoom-independent normalized Mercator units) are
      // exactly what a mouse drag is measured in.
      const startPoint = e.point;
      const startScreenCorners = box.corners.map((corner) => map.project(corner));
      const container = map.getContainer();
      const onMove = (moveEvent: MouseEvent) => {
        const rect = container.getBoundingClientRect();
        const dx = moveEvent.clientX - rect.left - startPoint.x;
        const dy = moveEvent.clientY - rect.top - startPoint.y;
        const newCorners = startScreenCorners.map((screenCorner) => {
          const lngLat = map.unproject([screenCorner.x + dx, screenCorner.y + dy]);
          return [lngLat.lng, lngLat.lat] as [number, number];
        });
        setCorners(newCorners as OverlayCorners);
        repositionHandles();
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        map.dragPan.enable();
        // Restores this overlay's own opacity (not necessarily fully
        // opaque) -- overlaysRef, not the `overlay` param captured at
        // mount time, so an opacity edit made since this overlay was
        // mounted is still honored.
        const current = overlaysRef.current.find((o) => o.id === overlay.id);
        map.setPaintProperty(sourceId, "raster-opacity", current?.opacity ?? 1);
        commit();
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    };

    repositionHandles();
    overlayMountsRef.current.set(overlay.id, {
      sourceId, box, deleteMarker, resizeMarker, rotateMarker, cornerMarkers, startMove, setCorners, repositionHandles, imageUrl,
    });
  }

  function unmountOverlay(id: string) {
    const map = mapRef.current;
    const mount = overlayMountsRef.current.get(id);
    if (!map || !mount) return;
    mount.deleteMarker.remove();
    mount.resizeMarker.remove();
    mount.rotateMarker.remove();
    for (const marker of mount.cornerMarkers) marker.remove();
    if (map.getLayer(mount.sourceId)) map.removeLayer(mount.sourceId);
    if (map.getSource(mount.sourceId)) map.removeSource(mount.sourceId);
    release(mount.imageUrl);
    overlayMountsRef.current.delete(id);
  }

  /** Shows or hides one overlay's 4 free-transform corner handles -- the
   * "Scale" / "Transform" SegmentedControl's onChange. Purely a display
   * preference (see warpHandleIds' own doc comment): move/resize/rotate/
   * delete always work the same way regardless of this, uniformly
   * transforming whatever the current corners are (see mountOverlay), so
   * picking either option never touches geometry at all. */
  function setCornerHandlesVisible(id: string, visible: boolean) {
    setWarpHandleIds((prev) => {
      const next = new Set(prev);
      if (visible) next.add(id); else next.delete(id);
      return next;
    });
  }

  // Shows the selected overlay's delete/resize/rotate handles (always) and
  // its 4 free-transform corner handles (only while its id is in
  // warpHandleIds), hides every other overlay's -- mountOverlay creates
  // every marker detached (not added to the map), so a freshly-added or
  // freshly-loaded overlay correctly starts with nothing showing until
  // it's actually clicked.
  const showCornerHandles = selectedOverlayId !== null && warpHandleIds.has(selectedOverlayId);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const [id, mount] of overlayMountsRef.current) {
      if (id !== selectedOverlayId) {
        mount.deleteMarker.remove();
        mount.resizeMarker.remove();
        mount.rotateMarker.remove();
        for (const marker of mount.cornerMarkers) marker.remove();
        continue;
      }
      mount.deleteMarker.addTo(map);
      mount.resizeMarker.addTo(map);
      mount.rotateMarker.addTo(map);
      for (const marker of mount.cornerMarkers) (showCornerHandles ? marker.addTo(map) : marker.remove());
    }
  }, [selectedOverlayId, showCornerHandles]);

  const selectedOverlay = overlays.find((o) => o.id === selectedOverlayId) ?? null;

  /** Patches the selected overlay's name/opacity/order in `overlays` state
   * -- and, for opacity, also pushes the change straight onto the live
   * mounted layer for immediate visual feedback, the same way color
   * changes update terra-draw's own selected feature in place. No-op with
   * nothing selected. */
  function updateSelectedOverlay(patch: Partial<Pick<ImageOverlayDraft, "name" | "opacity" | "order">>) {
    if (!selectedOverlayId) return;
    setOverlays((prev) => prev.map((o) => (o.id === selectedOverlayId ? { ...o, ...patch } : o)));
    if (patch.opacity !== undefined) {
      const mount = overlayMountsRef.current.get(selectedOverlayId);
      if (mount) mapRef.current?.setPaintProperty(mount.sourceId, "raster-opacity", patch.opacity);
    }
  }

  // Loads what's to be edited once the map/draw instance is ready and the
  // host has it, then frames it -- shapes and image overlays together (an
  // overlay-only item has no shape to frame), or the host's initialView
  // when there's nothing to frame.
  const loaded = useRef(false);
  useEffect(() => {
    if (!ready || !initial || loaded.current) return;
    const draw = drawRef.current;
    const map = mapRef.current;
    if (!draw || !map) return;
    loaded.current = true;
    const bounds = new maplibregl.LngLatBounds();
    if (initial.features.length > 0) {
      const session = prepareForEditing(initial.features);
      sessionRef.current = session;
      for (const geometry of showShapes(session, session)) extendBounds(bounds, geometry);
    }
    const drafts = initial.overlays.map((overlay): ImageOverlayDraft => ({ ...overlay, id: crypto.randomUUID() }));
    setOverlays(drafts);
    for (const draft of drafts) {
      // One image that won't load shouldn't keep the rest from editing.
      mountOverlay(draft).catch(() => {});
      for (const corner of draft.corners) bounds.extend(corner);
    }
    if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 60, maxZoom: 17, duration: 0 });
    else if (initialView) map.jumpTo(initialView);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, initial]);

  /** Puts a session's parts on the canvas -- `added`, the ones new to it
   * (all of them on load, an import's after) -- locking any terra-draw
   * refuses (a polygon that crosses itself, say) so the save keeps it.
   * Returns every new part's geometry, for framing. */
  function showShapes(session: EditSession, added: EditSession): Geometry[] {
    const draw = drawRef.current;
    const map = mapRef.current;
    if (!draw || !map) return [];
    // Split into single, 2D parts with everything terra-draw won't keep
    // set aside (map-edit's model), so a multi-part shape, a GPS track or
    // a property this editor doesn't know survives the save.
    const parts: EditablePart[] = [...added.parts];
    const results = draw.addFeatures(parts.map((part) => ({
      type: "Feature" as const,
      geometry: part.geometry,
      properties: {
        mode: part.mode, sourceKey: part.sourceKey, color: part.color, name: part.name,
        ...(part.mode === "polygon" ? { opacity: part.opacity } : {}),
      },
    })) as GeoJSONStoreFeatures[]);
    results.forEach((result, i) => {
      if (!result.valid) lockPart(session, parts[i].sourceKey);
    });
    const locked = [...session.locked.values()];
    setLockedCount(locked.length);
    (map.getSource(LOCKED_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: locked.map((part) => ({ type: "Feature", geometry: part.geometry, properties: { color: part.color } })),
    });
    return [...parts, ...added.locked.values()].map((part) => part.geometry);
  }

  function handleModeChange(next: DrawMode) {
    // Guarded, not just disabled on the button below: terra-draw's own
    // setMode() throws ("Terra Draw is not enabled") until draw.start() has
    // actually run (the style.load handler above), and a click landing in
    // that window before `ready` flips would otherwise be an uncaught
    // exception -- found live.
    if (!ready) return;
    setMode(next);
    // Switching drawing tools while an image overlay is selected leaves it
    // selected otherwise -- the overlay mousedown handler and syncSelection
    // (map-setup effect above) only clear it from the *other* direction
    // (a shape getting selected), not a mere tool change with nothing
    // clicked yet.
    setSelectedOverlayId(null);
    drawRef.current?.setMode(next);
  }

  useImperativeHandle(ref, () => ({
    getResult() {
      // Geometry plus the editor's own color/name (and, for a region,
      // opacity) and the part's sourceKey -- terra-draw's other bookkeeping
      // properties (mode, id, ...) mean nothing outside the editor.
      // Everything set aside when loading is put back by assembleForSaving.
      //
      // Also excluded: terra-draw's own selection-mode guidance points --
      // the small vertex/midpoint handle dots it draws on a shape's corners
      // and edges while selected. Select mode stores those as ordinary
      // Point features in the same snapshot (tagged `selectionPoint`/
      // `midPoint`), so saving mid-selection without this filter wrote them
      // into the file as if they were real map-item points. Found live.
      const savedParts: SavedPart[] = (drawRef.current?.getSnapshot() ?? [])
        .filter((f) => f.geometry != null && !f.properties?.selectionPoint && !f.properties?.midPoint)
        .map((f) => {
          // Trimmed, and omitted entirely rather than written as "" -- a
          // label point placed but never typed into should round-trip as a
          // plain, nameless point (the presence of `name` is itself what
          // marks a point as a label), not an invisible label with empty
          // text.
          const name = (f.properties?.name as string | undefined)?.trim();
          // Opacity only for a region (Polygon) -- meaningless on a point/
          // line, which have nothing to fill (see readOpacity/opacityRef).
          const regionOpacity = f.geometry.type === "Polygon"
            ? (f.properties?.opacity as number | undefined) ?? opacityRef.current
            : undefined;
          const sourceKey = f.properties?.sourceKey;
          return {
            ...(typeof sourceKey === "string" ? { sourceKey } : {}),
            geometry: f.geometry as EditableGeometry,
            color: (f.properties?.color as string | undefined) ?? colorRef.current,
            ...(name ? { name } : {}),
            ...(regionOpacity !== undefined ? { opacity: regionOpacity } : {}),
          };
        });
      const session = sessionRef.current ?? { parts: [], sources: new Map(), locked: new Map() };
      return {
        features: assembleForSaving(session, savedParts),
        overlays: overlaysRef.current.map(({ image, corners, name, opacity, order }) => ({ image, corners, name, opacity, order })),
      };
    },
    drawnBounds() {
      const bounds = new maplibregl.LngLatBounds();
      for (const f of drawRef.current?.getSnapshot() ?? []) {
        if (f.geometry == null || f.properties?.selectionPoint || f.properties?.midPoint) continue;
        extendBounds(bounds, f.geometry as Geometry);
      }
      for (const overlay of overlaysRef.current) for (const corner of overlay.corners) bounds.extend(corner);
      return bounds.isEmpty() ? null : (bounds.toArray().flat() as [number, number, number, number]);
    },
    async addImage(image: string) {
      // The same image placed twice has no use: in Gramps Connect an
      // overlay's dates are its place's, so a second copy couldn't even be
      // given a different era -- it would just always show (or not) in
      // lockstep with the first.
      if (overlaysRef.current.some((o) => o.image === image)) return false;
      const map = mapRef.current;
      if (!map) return false;
      // Only to measure the image's own pixel dimensions: mountOverlay
      // asks for it again for its persistent `image` source.
      const url = await live.current.resolveImage(image);
      const element = await loadImageElement(url, live.current.strings.imageFailed).finally(() => release(url));
      const aspect = element.naturalWidth / element.naturalHeight;
      const centerScreen = map.project(map.getCenter());
      const halfWidthPx = 130;
      const halfHeightPx = halfWidthPx / aspect;
      const topLeft = map.unproject([centerScreen.x - halfWidthPx, centerScreen.y - halfHeightPx]);
      const bottomRight = map.unproject([centerScreen.x + halfWidthPx, centerScreen.y + halfHeightPx]);
      const draft: ImageOverlayDraft = {
        id: crypto.randomUUID(),
        image,
        corners: [
          [topLeft.lng, topLeft.lat], [bottomRight.lng, topLeft.lat],
          [bottomRight.lng, bottomRight.lat], [topLeft.lng, bottomRight.lat],
        ],
        // Leaves room to insert between existing overlays later without
        // renumbering.
        order: overlaysRef.current.length * 10,
      };
      setOverlays((prev) => [...prev, draft]);
      // Awaited so the overlay's mount exists before selecting it --
      // selecting one before it's mounted would have nothing for the
      // handle-visibility effect above to find. Auto-selected so its
      // resize/move handles are immediately visible: the initial placement
      // is only ever an approximation.
      await mountOverlay(draft);
      setSelectedOverlayId(draft.id);
      return true;
    },
    addFeatures(features: Feature[]) {
      const map = mapRef.current;
      if (!map || features.length === 0) return;
      const session = sessionRef.current ?? { parts: [], sources: new Map(), locked: new Map() };
      sessionRef.current = session;
      const bounds = new maplibregl.LngLatBounds();
      for (const geometry of showShapes(session, addToSession(session, features))) extendBounds(bounds, geometry);
      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 60, maxZoom: 17 });
    },
    // mountOverlay and friends read only refs: a fresh handle each render
    // is fine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }));

  // Cheap to recompute on every render (getSnapshot() is just an array
  // read) rather than mirrored into its own state -- selectedId already
  // triggers a re-render via draw.on("select"/"deselect") above, so this
  // stays in sync for free.
  const selectedFeature = selectedId ? drawRef.current?.getSnapshot().find((f) => String(f.id) === selectedId) : undefined;
  const selectedIsPoint = selectedFeature?.geometry?.type === "Point";
  // Covers both polygon and rectangle tools -- a rectangle is stored as a
  // Polygon feature under the hood.
  const selectedIsRegion = selectedFeature?.geometry?.type === "Polygon";

  function renderModeButton(entry: { mode: DrawMode; label: keyof MapEditorStrings }) {
    return (
      <Button
        key={entry.mode}
        size="xs"
        variant={mode === entry.mode ? "filled" : "default"}
        disabled={!ready}
        onClick={() => handleModeChange(entry.mode)}
      >
        {strings[entry.label] as string}
      </Button>
    );
  }

  return (
    <Box style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <style>{TOOLBAR_CSS}</style>
      <div ref={setContainerEl} style={{ position: "absolute", inset: 0 }} />

      {/* Left toolbar: which terra-draw mode is active, then the selected
          item's own options. */}
      <Stack
        gap={4}
        p={6}
        className={TOOLBAR_CLASS}
        style={{
          position: "absolute", top: toolbarTop, left: 12, zIndex: 3, borderRadius: 8,
          background: dark ? "rgba(20,20,20,0.75)" : "rgba(255,255,255,0.85)",
        }}
      >
        {/* Point/Line/Polygon/Rectangle -- the terra-draw creation tools,
            TOOLBAR's own order minus its trailing "select" entry, which
            renders last below. */}
        {TOOLBAR.filter((entry) => entry.mode !== "select").map(renderModeButton)}
        {/* Not a terra-draw mode (there's no drawing gesture for it, just
            the host's picker), so it never shows as "active" the way the
            others do -- but it's one more kind of thing to add, same as
            Point/Line/Rectangle, and more than one image is supported. */}
        {onAddImage && (
          <Button size="xs" variant="default" disabled={!ready} onClick={onAddImage}>
            {strings.image}
          </Button>
        )}
        {TOOLBAR.filter((entry) => entry.mode === "select").map(renderModeButton)}

        <Divider my={2} />
        <Text size="xs" fw={600} c="dimmed">{strings.editOptions}</Text>

        {/* Only a selected drawn shape (point/line/region) offers this --
            hidden, not just disabled, the rest of the time: a picker with
            nothing to recolor is more confusing left sitting there than
            gone. */}
        {selectedFeature && (
          <ColorInput
            size="xs"
            value={color}
            onChange={(next) => {
              setColor(next);
              const draw = drawRef.current;
              if (draw && selectedId) draw.updateFeatureProperties(selectedId, { color: next });
            }}
            swatches={COLOR_SWATCHES}
            disabled={!ready}
            popoverProps={{ withinPortal: true, zIndex: 1000 }}
          />
        )}
        {/* A point's `name` places a text label on the map -- a label is
            always its own point. A region's `name` is purely descriptive,
            the same as an image overlay's own. */}
        {(selectedIsPoint || selectedIsRegion) && (
          <TextInput
            size="xs"
            placeholder={selectedIsPoint ? strings.labelText : strings.regionName}
            value={labelText}
            onChange={(e) => {
              setLabelText(e.currentTarget.value);
              const draw = drawRef.current;
              if (draw && selectedId) draw.updateFeatureProperties(selectedId, { name: e.currentTarget.value });
            }}
            disabled={!ready}
          />
        )}
        {/* Only a selected region (polygon/rectangle) offers this, same
            reasoning as the color picker above. */}
        {selectedIsRegion && (
          <Stack gap={2}>
            <Text size="xs" c="dimmed">{strings.fillOpacity}</Text>
            <Slider
              size="xs"
              min={0.1}
              max={1}
              step={0.05}
              label={(v) => `${Math.round(v * 100)}%`}
              value={opacity}
              onChange={(v) => {
                setOpacity(v);
                const draw = drawRef.current;
                if (draw && selectedId) draw.updateFeatureProperties(selectedId, { opacity: v });
              }}
              disabled={!ready}
            />
          </Stack>
        )}
        {/* Only a selected image overlay offers this -- purely shows or
            hides the 4 corner-drag handles (see setCornerHandlesVisible's
            own doc comment). */}
        {selectedOverlayId && (
          <SegmentedControl
            size="xs"
            value={showCornerHandles ? "transform" : "scale"}
            onChange={(value) => setCornerHandlesVisible(selectedOverlayId, value === "transform")}
            disabled={!ready}
            data={[
              { label: strings.scale, value: "scale" },
              { label: strings.transform, value: "transform" },
            ]}
          />
        )}
        {/* The selected image overlay's own name/opacity/order. Opacity
            applies live (see updateSelectedOverlay). */}
        {selectedOverlay && (
          <>
            {overlayNames && (
              <TextInput
                size="xs"
                placeholder={strings.overlayName}
                value={selectedOverlay.name ?? ""}
                onChange={(e) => updateSelectedOverlay({ name: e.currentTarget.value })}
                disabled={!ready}
              />
            )}
            <Stack gap={2}>
              <Text size="xs" c="dimmed">{strings.opacity}</Text>
              <Slider
                size="xs"
                min={0.1}
                max={1}
                step={0.05}
                label={(v) => `${Math.round(v * 100)}%`}
                value={selectedOverlay.opacity ?? 1}
                onChange={(v) => updateSelectedOverlay({ opacity: v })}
                disabled={!ready}
              />
            </Stack>
            <NumberInput
              size="xs"
              label={strings.stackingOrder}
              hideControls={false}
              value={selectedOverlay.order ?? 0}
              onChange={(v) => updateSelectedOverlay({ order: Number(v) || 0 })}
              disabled={!ready}
            />
            {renderOverlayOptions?.(selectedOverlay.image)}
          </>
        )}
      </Stack>

      {!ready && (
        <Group justify="center" align="center" style={{ position: "absolute", inset: 0, zIndex: 2 }}>
          <Loader size="sm" />
        </Group>
      )}

      {lockedCount > 0 && !lockedNoticeDismissed && (
        <Alert
          color="yellow"
          title={lockedCount === 1 ? strings.lockedOne : strings.lockedMany(lockedCount)}
          withCloseButton
          onClose={() => setLockedNoticeDismissed(true)}
          style={{ position: "absolute", bottom: 12, right: 12, zIndex: 3, maxWidth: 360 }}
        >
          {strings.lockedExplain}
        </Alert>
      )}
    </Box>
  );
});

/** How to use the map editor, for the host to show where it likes (Gramps
 * Connect: an info button's modal). */
export function MapEditorHelp({ strings: stringOverrides, images = true }: { strings?: Partial<MapEditorStrings>; images?: boolean }) {
  const strings = { ...MAP_EDITOR_ENGLISH, ...stringOverrides };
  return (
    <Stack gap="md">
      <Text size="sm" fw={600}>{strings.helpDrawing}</Text>
      <List spacing={4} size="sm">
        <List.Item>{strings.helpPoint}</List.Item>
        <List.Item>
          {strings.helpLine}{" "}
          <Kbd>Enter</Kbd> {strings.helpEnterFinishes} <Kbd>Esc</Kbd> {strings.helpEscCancels}
        </List.Item>
        <List.Item>{strings.helpRectangle}</List.Item>
        {images && (
          <List.Item>{strings.helpImage} <Text span fw={600}>{strings.helpImages}</Text>{" "}
            {strings.helpBelow}
          </List.Item>
        )}
      </List>
      <Text size="sm" fw={600}>{strings.helpEditing}</Text>
      <List spacing={4} size="sm">
        <List.Item>{strings.helpSelect}</List.Item>
        <List.Item>{strings.helpVertex}</List.Item>
        <List.Item>{strings.helpColor}</List.Item>
        <List.Item>
          {strings.helpDelete} <Kbd>Delete</Kbd> {strings.helpOr} <Kbd>Backspace</Kbd>.
        </List.Item>
        <List.Item>
          {strings.helpRotate} <Kbd>R</Kbd>{" "}
          {strings.helpRotateHandle}
        </List.Item>
      </List>
      {images && (
        <>
          <Text size="sm" fw={600}>{strings.helpImages}</Text>
          <List spacing={4} size="sm">
            <List.Item>{strings.helpImageMove}</List.Item>
            <List.Item>{strings.helpImageResize}</List.Item>
            <List.Item>{strings.helpImageRotate}</List.Item>
            <List.Item>{strings.helpImageTransform}</List.Item>
            <List.Item>{strings.helpImageRemove}</List.Item>
          </List>
        </>
      )}
    </Stack>
  );
}
