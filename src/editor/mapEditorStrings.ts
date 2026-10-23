// The map editor's words. English here; Gramps Connect passes its own
// translations (its t() is keyed by these same English texts).

export interface MapEditorStrings {
  point: string;
  line: string;
  polygon: string;
  rectangle: string;
  select: string;
  image: string;
  editOptions: string;
  labelText: string;
  regionName: string;
  fillOpacity: string;
  scale: string;
  transform: string;
  overlayName: string;
  opacity: string;
  stackingOrder: string;
  removeImage: string;
  resizeImage: string;
  rotateImage: string;
  warpCorner: string;
  basemapFailed: string;
  imageFailed: string;
  lockedOne: string;
  lockedMany: (count: number) => string;
  lockedExplain: string;
  // The help (MapEditorHelp), in the pieces it's put together from.
  helpTitle: string;
  helpDrawing: string;
  helpPoint: string;
  helpLine: string;
  helpEnterFinishes: string;
  helpEscCancels: string;
  helpRectangle: string;
  helpImage: string;
  helpImages: string;
  helpBelow: string;
  helpEditing: string;
  helpSelect: string;
  helpVertex: string;
  helpColor: string;
  helpDelete: string;
  helpOr: string;
  helpRotate: string;
  helpRotateHandle: string;
  helpImageMove: string;
  helpImageResize: string;
  helpImageRotate: string;
  helpImageTransform: string;
  helpImageRemove: string;
}

export const MAP_EDITOR_ENGLISH: MapEditorStrings = {
  point: "Point",
  line: "Line",
  polygon: "Polygon",
  rectangle: "Rectangle",
  select: "Select",
  image: "Image",
  editOptions: "Edit Options",
  labelText: "Label text",
  regionName: "Region name (optional)",
  fillOpacity: "Fill opacity",
  scale: "Scale",
  transform: "Transform",
  overlayName: "Overlay name (optional)",
  opacity: "Opacity",
  stackingOrder: "Stacking order",
  removeImage: "Remove this image",
  resizeImage: "Drag to resize (keeps its exact shape, warped or not)",
  rotateImage: "Drag to rotate",
  warpCorner: "Drag to warp this corner",
  basemapFailed: "The basemap could not be loaded.",
  imageFailed: "The image failed to load.",
  lockedOne: "1 shape can't be edited here",
  lockedMany: (count) => `${count} shapes can't be edited here`,
  lockedExplain: "For example, a region with a hole in it, or one whose outline crosses itself. It's drawn dashed, and saved exactly as it was.",
  helpTitle: "How to use this editor",
  helpDrawing: "Drawing",
  helpPoint: "Point: click once to place it.",
  helpLine: "Line, Polygon: click to place each point, then click that first point's own marker again to "
    + "finish -- it's styled differently once there's enough points to close the shape. Pressing",
  helpEnterFinishes: "finishes it too;",
  helpEscCancels: "cancels it.",
  helpRectangle: "Rectangle: click and drag from one corner to the opposite corner.",
  helpImage: "Image: pick a media object to overlay -- see",
  helpImages: "Images",
  helpBelow: "below.",
  helpEditing: "Editing a shape",
  helpSelect: "Select: click a shape to select it, then drag it or one of its handles.",
  helpVertex: "Drag a vertex to move it. To add a new point on a Line, Polygon, or Rectangle, drag the small "
    + "midpoint marker between two existing vertices outward.",
  helpColor: "The color swatch sets the next shape's color -- or, with a shape selected, changes its color.",
  helpDelete: "Delete a selected shape or image with",
  helpOr: "or",
  helpRotate: "Rotate a selected Polygon, Rectangle, or Line: hold",
  helpRotateHandle: "while dragging one of its handles.",
  helpImageMove: "Drag anywhere on an image to move it.",
  helpImageResize: "Drag its ↘ handle to resize it -- grows or shrinks from its own center, "
    + "keeping its exact shape (works the same on a warped image, too).",
  helpImageRotate: "Drag its ↻ handle to rotate it -- handy for aligning a scanned old map.",
  helpImageTransform: "Switch to \"Transform\" to also show 4 corner handles you can drag independently "
    + "(rubber-sheeting) -- for a scanned map that isn't printed at a uniform scale/orientation. "
    + "Switching back to \"Scale\" just hides those 4 handles again; move/resize/rotate keep "
    + "working on the image's exact current shape either way.",
  helpImageRemove: "Click its × handle to remove it.",
};
