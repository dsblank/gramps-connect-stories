// The Gramps Connect Story Viewer's mark, linking to the viewer: for
// StoryPlayer's `brand` slot on standalone pages (the viewer site, a page
// a program writes around a story), so whoever is watching can find where
// it came from.
import type { CSSProperties } from "react";

export const VIEWER_NAME = "Gramps Connect Story Viewer";
export const VIEWER_URL = "https://dsblank.github.io/gramps-connect-stories/";

/** The Gramps Connect icon (app/public/favicon.svg): a three-box pedigree
 * on a blue tile, which holds up on light and dark headers alike. */
export function ViewerIcon({ size = 24 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="15" fill="#1866ba" />
      <g transform="translate(9.6 9.6) scale(0.7)">
        <path d="M25 32h7M32 15v34M32 15h7M32 49h7" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
        <g fill="#fff">
          <rect x="1" y="24" width="24" height="16" rx="4" />
          <rect x="39" y="7" width="24" height="16" rx="4" />
          <rect x="39" y="41" width="24" height="16" rx="4" />
        </g>
      </g>
    </svg>
  );
}

export interface ViewerBrandProps {
  /** Where the link goes; the viewer site by default. */
  href?: string;
  /** "_blank" (the default) opens it beside the story, not in its place. */
  target?: string;
  size?: number;
}

/** The icon, as a link to the viewer. */
export function ViewerBrand({ href = VIEWER_URL, target = "_blank", size = 24 }: ViewerBrandProps) {
  const style: CSSProperties = { display: "flex", lineHeight: 0, borderRadius: 6 };
  return (
    <a
      href={href}
      target={target}
      rel={target === "_blank" ? "noopener" : undefined}
      title={VIEWER_NAME}
      aria-label={VIEWER_NAME}
      style={style}
    >
      <ViewerIcon size={size} />
    </a>
  );
}
