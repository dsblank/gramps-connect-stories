// @gramps-connect/story/map-edit: the map editor's model, map files and
// geometry -- plain functions, no React or map library, shared by the
// Story Editor and Gramps Connect's own map editor.
export {
  addToSession, assembleForSaving, lockPart, prepareForEditing,
  type EditableGeometry, type EditablePart, type EditMode, type EditSession, type SavedPart,
} from "./model";
export {
  IMAGE_OVERLAY_PROPERTY, isKmlLine, isKmlRegion, lineCoordsOf, mapItemToGeoJson, MEDIA_HANDLE_PREFIX, overlaySourceOfText,
  parseMapFile, polygonRingsOf, SOURCE_PROPERTY, type ImageOverlay,
} from "./mapFile";
export {
  cornersFromBox, kmlBounds, kmlCenter, kmlOverlayBounds, kmlOverlayCenter, mercatorBearing, mercatorDistance, rotatePoint,
  scalePoint, unionBounds, type OverlayCorners,
} from "./geometry";
