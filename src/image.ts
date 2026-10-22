// Re-encodes an image for presentation (spec/1.0/README.md section 5):
// scaled to fit a long-edge limit and written through a canvas, which also
// drops every bit of EXIF/GPS metadata the original carried. Browser-only
// (createImageBitmap + OffscreenCanvas); the sizing and format decisions are
// split out as plain functions so they can be tested anywhere.

export type ImagePurpose = "photo" | "overlay";

export interface OptimizeOptions {
  /** "photo" (default): slide pictures, 1600px, WebP. "overlay": map
   * overlays, 2048px, PNG when they have transparency. */
  purpose?: ImagePurpose;
  /** Overrides the purpose's long-edge limit. Never scales up. */
  maxEdge?: number;
  /** Lossy quality, 0-1. Default 0.82. */
  quality?: number;
}

export interface OptimizedImage {
  blob: Blob;
  mime: "image/webp" | "image/jpeg" | "image/png";
  /** File extension without the dot, matching `mime`. */
  ext: "webp" | "jpg" | "png";
  width: number;
  height: number;
}

export const DEFAULT_MAX_EDGE: Record<ImagePurpose, number> = { photo: 1600, overlay: 2048 };

/** Scales (width, height) down to fit within maxEdge on the longer side,
 * keeping the aspect ratio; never scales up. */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxEdge) return { width, height };
  const scale = maxEdge / longEdge;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Which encodings to try, best first. An overlay with transparency must
 * keep its alpha channel, and lossless PNG keeps hard map edges clean;
 * everything else goes lossy. JPEG is the fallback for a browser that
 * can't encode WebP (convertToBlob silently returns PNG then). */
export function encodingCandidates(purpose: ImagePurpose, hasAlpha: boolean): OptimizedImage["mime"][] {
  if (hasAlpha) return purpose === "overlay" ? ["image/png"] : ["image/webp", "image/png"];
  return ["image/webp", "image/jpeg"];
}

const EXT: Record<OptimizedImage["mime"], OptimizedImage["ext"]> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
};

/** Any pixel not fully opaque. Checked on the already-scaled canvas, so the
 * cost is bounded by maxEdge, not by the original's size. */
function canvasHasAlpha(ctx: OffscreenCanvasRenderingContext2D, width: number, height: number): boolean {
  const data = ctx.getImageData(0, 0, width, height).data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}

export async function optimizeImage(input: Blob, options: OptimizeOptions = {}): Promise<OptimizedImage> {
  const purpose = options.purpose ?? "photo";
  const maxEdge = options.maxEdge ?? DEFAULT_MAX_EDGE[purpose];
  const quality = options.quality ?? 0.82;

  // imageOrientation "from-image" applies the EXIF rotation before the
  // metadata is lost, so a sideways phone photo stays upright.
  const bitmap = await createImageBitmap(input, { imageOrientation: "from-image" });
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, maxEdge);
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2D canvas context available.");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);
    const hasAlpha = canvasHasAlpha(ctx, width, height);

    for (const mime of encodingCandidates(purpose, hasAlpha)) {
      const blob = await canvas.convertToBlob({ type: mime, quality });
      if (blob.type === mime) return { blob, mime, ext: EXT[mime], width, height };
    }
    // Every browser can encode PNG; it's convertToBlob's own fallback.
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return { blob, mime: "image/png", ext: "png", width, height };
  } finally {
    bitmap.close();
  }
}
