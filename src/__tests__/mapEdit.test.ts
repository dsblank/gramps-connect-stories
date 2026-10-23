import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Feature } from "geojson";
import { IMAGE_OVERLAY_PROPERTY, isKmlRegion, mapItemToGeoJson, MEDIA_HANDLE_PREFIX, overlaySourceOfText, parseMapFile } from "../mapEdit/mapFile";
import { cornersFromBox, kmlBounds, kmlOverlayBounds, mercatorBearing, mercatorDistance, rotatePoint, scalePoint, unionBounds } from "../mapEdit/geometry";
import { addToSession, assembleForSaving, lockPart, prepareForEditing, type SavedPart } from "../mapEdit/model";

const feature = (geometry: Feature["geometry"], properties: Record<string, unknown> = {}): Feature =>
  ({ type: "Feature", geometry, properties });

/** The canvas saving every part exactly as loaded -- what an editor session
 * with no changes produces. */
const unchanged = (session: ReturnType<typeof prepareForEditing>): SavedPart[] =>
  session.parts.map(({ sourceKey, geometry, name, color, opacity }) => ({ sourceKey, geometry, name, color, opacity }));

describe("prepareForEditing / assembleForSaving", () => {
  it("round-trips an untouched file without losing anything but elevation", () => {
    const track = feature(
      { type: "LineString", coordinates: [[1, 2, 30], [3, 4, 31], [5, 6, 32]] },
      { name: "Walk", desc: "To the grave", link: { href: "https://example.org" }, _gpxType: "trk",
        coordinateProperties: { times: ["t1", "t2", "t3"] } },
    );
    const session = prepareForEditing([track]);
    assert.deepEqual(session.parts[0].geometry, { type: "LineString", coordinates: [[1, 2], [3, 4], [5, 6]] });
    assert.deepEqual(assembleForSaving(session, unchanged(session)), [{
      type: "Feature",
      geometry: { type: "LineString", coordinates: [[1, 2], [3, 4], [5, 6]] },
      // Nested values kept as they are; the parser's _gpxType isn't.
      properties: { name: "Walk", desc: "To the grave", link: { href: "https://example.org" },
        coordinateProperties: { times: ["t1", "t2", "t3"] } },
    }]);
  });

  it("drops a track's times once its points change", () => {
    const session = prepareForEditing([feature(
      { type: "LineString", coordinates: [[1, 2], [3, 4], [5, 6]] },
      { coordinateProperties: { times: ["t1", "t2", "t3"] } },
    )]);
    const [part] = unchanged(session);
    const moved = { ...part, geometry: { type: "LineString" as const, coordinates: [[1, 2], [3, 9], [5, 6]] } };
    assert.ok(!("coordinateProperties" in (assembleForSaving(session, [moved])[0].properties ?? {})));
  });

  it("splits a multi-segment track for editing and rejoins it with its times", () => {
    const session = prepareForEditing([feature(
      { type: "MultiLineString", coordinates: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]] },
      { name: "Trip", coordinateProperties: { times: [["a", "b"], ["c", "d"]] } },
    )]);
    assert.deepEqual(session.parts.map((p) => p.geometry.type), ["LineString", "LineString"]);
    const [saved] = assembleForSaving(session, unchanged(session).reverse());
    assert.deepEqual(saved.geometry, { type: "MultiLineString", coordinates: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]] });
    assert.equal(saved.properties?.name, "Trip");
    assert.deepEqual(saved.properties?.coordinateProperties, { times: [["a", "b"], ["c", "d"]] });
  });

  it("makes a part restyled apart from its siblings its own shape, keeping their shared properties", () => {
    const session = prepareForEditing([feature(
      { type: "MultiPolygon", coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]], [[[5, 5], [6, 5], [6, 6], [5, 5]]]] },
      { name: "Parish", color: "#ff0000", source: "survey" },
    )]);
    const [a, b] = unchanged(session);
    const saved = assembleForSaving(session, [a, { ...b, color: "#0000ff" }]);
    assert.deepEqual(saved.map((f) => [f.geometry.type, f.properties?.color, f.properties?.source]),
      [["Polygon", "#ff0000", "survey"], ["Polygon", "#0000ff", "survey"]]);
  });

  it("drops a part the user deleted, and adds a newly drawn shape last", () => {
    const session = prepareForEditing([feature({ type: "MultiPoint", coordinates: [[0, 0], [1, 1]] }, { name: "Graves" })]);
    const [first] = unchanged(session);
    const drawn: SavedPart = { geometry: { type: "Point", coordinates: [9, 9] }, color: "#00ff00" };
    const saved = assembleForSaving(session, [drawn, first]);
    assert.deepEqual(saved.map((f) => f.geometry), [
      { type: "Point", coordinates: [0, 0] },
      { type: "Point", coordinates: [9, 9] },
    ]);
  });

  it("locks a polygon with a hole, and saves it back exactly as loaded", () => {
    const holed = { type: "Polygon" as const, coordinates: [
      [[0, 0], [10, 0], [10, 10], [0, 0]],
      [[2, 2], [3, 2], [3, 3], [2, 2]],
    ] };
    const session = prepareForEditing([feature(holed, { name: "Field" })]);
    assert.deepEqual(session.parts, []);
    assert.equal(session.locked.size, 1);
    assert.deepEqual(assembleForSaving(session, []), [{ type: "Feature", geometry: holed, properties: { name: "Field" } }]);
  });

  it("keeps a part terra-draw refused, alongside the parts it took", () => {
    const session = prepareForEditing([feature({ type: "MultiPoint", coordinates: [[0, 0], [1, 1]] }, { name: "Graves" })]);
    lockPart(session, session.parts[1].sourceKey);
    const [saved] = assembleForSaving(session, unchanged(session));
    assert.deepEqual(saved.geometry, { type: "MultiPoint", coordinates: [[0, 0], [1, 1]] });
  });

  it("adds an imported file's shapes after the loaded ones", () => {
    const session = prepareForEditing([
      feature({ type: "Point", coordinates: [0, 0] }, { name: "Church" }),
      feature({ type: "MultiPoint", coordinates: [[1, 1], [2, 2]] }, { name: "Graves" }),
    ]);
    const added = addToSession(session, [feature({ type: "LineString", coordinates: [[3, 3], [4, 4]] }, { name: "Road", surveyed: 1850 })]);
    assert.deepEqual(added.parts.map((p) => p.name), ["Road"]);
    assert.equal(session.parts.length, 4);
    const saved = assembleForSaving(session, unchanged(session).reverse());
    assert.deepEqual(saved.map((f) => f.properties?.name), ["Church", "Graves", "Road"]);
    assert.equal(saved[2].properties?.surveyed, 1850);
    assert.equal(saved[1].geometry.type, "MultiPoint");
  });

  it("rounds coordinates to terra-draw's 9 decimal places", () => {
    const session = prepareForEditing([feature({ type: "Point", coordinates: [1.123456789123, 2.000000000049] })]);
    assert.deepEqual(session.parts[0].geometry, { type: "Point", coordinates: [1.123456789, 2] });
  });
});

// isKmlRegion is what Gramps Connect's fetchAllKmlRegions (OverlayLayersPanel.tsx's list)
// and MapCanvas.tsx's shapes effect both gate their region handling on -- kept
// in sync via this one shared function after a real bug (found live,
// 2026-09-09) where a country-level outline (a disjoint MultiPolygon,
// round-tripped through a KML <MultiGeometry> and @tmcw/togeojson as a
// GeometryCollection of Polygons -- see that function's own doc comment)
// drew on the map but never appeared in OverlayLayersPanel.tsx's controls,
// because only the panel's own Polygon-only check excluded it.
describe("isKmlRegion", () => {
  // Real features here never carry a null geometry (fetchKmlFeatures
  // filters those out before isKmlRegion ever sees one -- see kmlMedia.ts),
  // hence the cast: this helper builds one anyway, to prove isKmlRegion's
  // own `feature.geometry?.type` optional chaining is more than decoration.
  function feature(geometry: Feature["geometry"] | null): Feature {
    return { type: "Feature", properties: {}, geometry } as Feature;
  }

  it("accepts a plain Polygon", () => {
    assert.equal(isKmlRegion(feature({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] })), true);
  });

  it("accepts a GeometryCollection containing a Polygon (a disjoint outline's actual shape)", () => {
    assert.equal(
      isKmlRegion(
        feature({
          type: "GeometryCollection",
          geometries: [
            { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
            { type: "Polygon", coordinates: [[[10, 10], [11, 10], [11, 11], [10, 10]]] },
          ],
        })
      )
    , true);
  });

  it("rejects a GeometryCollection with no Polygon sub-geometry", () => {
    assert.equal(
      isKmlRegion(
        feature({
          type: "GeometryCollection",
          geometries: [{ type: "Point", coordinates: [0, 0] }, { type: "LineString", coordinates: [[0, 0], [1, 1]] }],
        })
      )
    , false);
  });

  it("rejects a bare LineString or Point", () => {
    assert.equal(isKmlRegion(feature({ type: "LineString", coordinates: [[0, 0], [1, 1]] })), false);
    assert.equal(isKmlRegion(feature({ type: "Point", coordinates: [0, 0] })), false);
  });

  it("rejects a null geometry", () => {
    assert.equal(isKmlRegion(feature(null)), false);
  });
});

// GPX and KML need a DOMParser, so Gramps Connect's tests (jsdom) cover
// those; GeoJSON needs none.
describe("parseMapFile (GeoJSON)", () => {
  it("reads a FeatureCollection, taking simplestyle colours", () => {
    const features = parseMapFile(JSON.stringify({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { stroke: "#ff0000" }, geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } },
        {
          type: "Feature",
          properties: { fill: "#00ff00", stroke: "#000000", "fill-opacity": 0.5 },
          geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
        },
        { type: "Feature", properties: { color: "#123456", stroke: "#ff0000" }, geometry: { type: "Point", coordinates: [0, 0] } },
        { type: "Feature", properties: { name: "no shape" }, geometry: null },
      ],
    }));
    assert.equal(features.length, 3);
    assert.equal(features[0].properties?.color, "#ff0000");
    assert.equal(features[1].properties?.color, "#00ff00");
    assert.equal(features[1].properties?.opacity, 0.5);
    // An explicit `color` wins over simplestyle.
    assert.equal(features[2].properties?.color, "#123456");
  });

  it("accepts a single Feature or a bare Geometry", () => {
    const point = { type: "Point", coordinates: [3, 4] };
    assert.deepEqual(parseMapFile(JSON.stringify({ type: "Feature", properties: null, geometry: point }))[0].geometry, point);
    assert.deepEqual(parseMapFile(`  ${JSON.stringify(point)}`)[0].geometry, point);
  });

  it("throws on unparseable GeoJSON", () => {
    assert.throws(() => parseMapFile("{not json"));
  });

  it("reads back what mapItemToGeoJson writes: shapes, then overlays as ground overlays", () => {
    const shape: Feature = { type: "Feature", properties: { name: "Farm" }, geometry: { type: "Point", coordinates: [1, 2] } };
    const corners: [[number, number], [number, number], [number, number], [number, number]] = [[0, 1], [1, 1], [1, 0], [0, 0]];
    const text = mapItemToGeoJson([shape], [{ handle: "img1", corners, name: "1850 map", opacity: 0.6, order: 10 }], "src1");
    assert.equal(overlaySourceOfText(text), "src1");
    const [readShape, overlay] = parseMapFile(text);
    assert.deepEqual(readShape, shape);
    assert.equal(overlay.properties?.["@geometry-type"], "groundoverlay");
    assert.equal(overlay.properties?.icon, `${MEDIA_HANDLE_PREFIX}img1`);
    assert.equal(overlay.properties?.[IMAGE_OVERLAY_PROPERTY], undefined);
    assert.deepEqual(overlay.geometry, { type: "Polygon", coordinates: [[...corners, corners[0]]] });
  });
});

describe("overlay geometry", () => {
  const close = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);

  it("rotates and scales about a centre, and back again", () => {
    const center: [number, number] = [8.5, 47.4];
    const p: [number, number] = [8.6, 47.45];
    assert.ok(close(rotatePoint(rotatePoint(p, center, 30), center, -30), p));
    assert.ok(close(scalePoint(scalePoint(p, center, 2), center, 0.5), p));
    // Twice as far, measured the way scalePoint scales.
    assert.ok(Math.abs(mercatorDistance(center, scalePoint(p, center, 2)) / mercatorDistance(center, p) - 2) < 1e-9);
    // A quarter turn counterclockwise from due east is due north.
    assert.ok(Math.abs(mercatorBearing(center, rotatePoint([8.6, 47.4], center, 90)) - 90) < 1e-9);
  });

  it("keeps a rotated box's corners square at any latitude", () => {
    const corners = cornersFromBox({ west: 8, south: 60, east: 9, north: 60.5, rotation: 25 });
    const [a, b, , d] = corners;
    const bearingAB = mercatorBearing(a, b);
    const bearingAD = mercatorBearing(a, d);
    assert.ok(Math.abs(Math.abs(bearingAB - bearingAD) - 90) < 1e-6);
  });

  it("bounds features, overlays and both", () => {
    const features: Feature[] = [
      { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[0, 0], [2, 3]] } },
      { type: "Feature", properties: {}, geometry: { type: "GeometryCollection", geometries: [{ type: "Point", coordinates: [-1, 1] }] } },
    ];
    assert.deepEqual(kmlBounds(features), [-1, 0, 2, 3]);
    assert.equal(kmlBounds([]), null);
    const overlays = [{ corners: [[5, 6], [7, 6], [7, 4], [5, 4]] as [[number, number], [number, number], [number, number], [number, number]] }];
    assert.deepEqual(kmlOverlayBounds(overlays), [5, 4, 7, 6]);
    assert.deepEqual(unionBounds(kmlBounds(features), kmlOverlayBounds(overlays)), [-1, 0, 7, 6]);
    assert.deepEqual(unionBounds(null, [1, 2, 3, 4]), [1, 2, 3, 4]);
  });
});
