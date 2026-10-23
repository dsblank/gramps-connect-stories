// Presents a story: one slide at a time, with a full-bleed map behind the
// slides when any of them has a place (modeled on a Knight Lab StoryMapJS
// slide), or a plain centered card when none does, plus a timeline strip
// when two or more slides are dated. Fills its container; the host decides
// whether that's a fullscreen modal, a page, or a box on a blog.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type TouchEvent } from "react";
import type { MediaItem, Slide, StoryDoc } from "../types";
import { timelineYear } from "./dates";
import { placeCenter, storyPlaces } from "./geo";
import { MapBackground, type MapSlide } from "./MapBackground";
import { MapModeControl, type MapMode, type MapModeControlProps } from "./MapModeControl";
import { parseStoryText } from "./text";
import { stringsFor, type PlayerStrings } from "./strings";
import { defaultColors, type PlayerColors } from "./theme";
import { TIMELINE_HEIGHT, TimelineStrip, type TimelinePoint } from "./TimelineStrip";

/** How much of the width the slide panel takes over a map; the map
 * centers each point in what's left. */
const PANEL_FRACTION = 0.62;
const BAR_HEIGHT = 56;

export interface StoryPlayerProps {
  story: StoryDoc;
  /** A URL the browser can load for a media key: a blob: URL for a file
   * out of a zip, or anything else the host serves. The host owns these
   * URLs (and revoking them); the player may ask for the same key again.
   * Null when it can't be had: the slide shows without it. */
  resolveMedia: (key: string, item: MediaItem) => Promise<string | null>;
  dark?: boolean;
  colors?: Partial<PlayerColors>;
  /** The player's own words. By default, the built-in table for the
   * story's language, else the browser's, else English (strings.ts). */
  strings?: Partial<PlayerStrings>;
  /** Shows a close button that calls this. */
  onClose?: () => void;
  /** Arrow keys move between slides: true listens on the whole window (a
   * fullscreen presentation), "focus" only while the player has focus (one
   * of several on a page), false not at all. Default true. */
  keyboard?: boolean | "focus";
  /** Called with the new index whenever the slide changes. */
  onSlideChange?: (index: number) => void;
  /** Replaces the built-in map-mode control, e.g. with one from the host's
   * own UI kit. */
  renderMapModeControl?: (props: MapModeControlProps) => ReactNode;
  /** Shown before the title, e.g. ViewerBrand on a standalone page. */
  brand?: ReactNode;
  /** The host's own buttons, at the right of the title bar (before the
   * close button), e.g. the viewer site's Edit. */
  actions?: ReactNode;
  initialSlide?: number;
}

/** The story's basemap hint (spec section 6) as the control's starting mode:
 * "historical" -- a map of each slide's era -- is what the control calls
 * Auto; "auto" (viewer's choice) starts on the standard map. */
function initialMapMode(story: StoryDoc): MapMode {
  return story.presentation?.basemap === "historical" ? "auto" : "standard";
}

function SlideText({ text, colors }: { text: string; colors: PlayerColors }) {
  return (
    <>
      {parseStoryText(text).map((lines, p) => (
        <p key={p} dir="auto" style={{ margin: "0 0 0.6em", color: colors.text, lineHeight: 1.55 }}>
          {lines.map((spans, l) => (
            <span key={l}>
              {l > 0 && <br />}
              {spans.map((span, s) => {
                if (span.bold) return <b key={s}>{span.text}</b>;
                if (span.italic) return <i key={s}>{span.text}</i>;
                return <span key={s}>{span.text}</span>;
              })}
            </span>
          ))}
        </p>
      ))}
    </>
  );
}

function SlidePhoto({ mediaKey, item, caption, credit, resolveMedia, colors }: {
  mediaKey: string;
  item: MediaItem;
  caption?: string;
  credit?: string;
  resolveMedia: StoryPlayerProps["resolveMedia"];
  colors: PlayerColors;
}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(null);
    let cancelled = false;
    resolveMedia(mediaKey, item).then((url) => { if (!cancelled) setSrc(url); }, () => {});
    return () => {
      cancelled = true;
    };
  }, [mediaKey, item, resolveMedia]);
  if (!src) return null;
  return (
    <figure style={{ margin: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <img
        src={src}
        alt={item.alt ?? ""}
        width={item.width}
        height={item.height}
        style={{ maxHeight: "42vh", maxWidth: "100%", width: "auto", height: "auto", objectFit: "contain", borderRadius: 4 }}
      />
      {(caption || credit) && (
        <figcaption style={{ fontSize: 13, color: colors.muted }}>
          {[caption, credit && `© ${credit}`].filter(Boolean).join(" · ")}
        </figcaption>
      )}
    </figure>
  );
}

function SlideContent({ slide, story, resolveMedia, colors }: {
  slide: Slide | undefined;
  story: StoryDoc;
  resolveMedia: StoryPlayerProps["resolveMedia"];
  colors: PlayerColors;
}) {
  // The format allows several photos per slide; the player shows the
  // first one that exists.
  const photo = slide?.media?.find((m) => Object.prototype.hasOwnProperty.call(story.media, m.ref));
  const eyebrow = [slide?.date?.text, slide?.place?.name].filter(Boolean).join(" · ");
  return (
    <>
      {photo && (
        <SlidePhoto
          mediaKey={photo.ref}
          item={story.media[photo.ref]}
          caption={photo.caption}
          credit={photo.credit}
          resolveMedia={resolveMedia}
          colors={colors}
        />
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center", maxWidth: 640, textAlign: "center" }}>
        {eyebrow && <div dir="auto" style={{ fontSize: 14, color: colors.muted }}>{eyebrow}</div>}
        {slide?.title && <div dir="auto" style={{ fontSize: 20, fontWeight: 700, color: colors.text }}>{slide.title}</div>}
        {slide?.text && <div><SlideText text={slide.text} colors={colors} /></div>}
      </div>
    </>
  );
}

function RoundButton({ label, onClick, disabled, size, children, style }: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  size: number;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: size, height: size, borderRadius: "50%", border: "none",
        background: "#25262b", color: "#ffffff", fontSize: size >= 48 ? 22 : 18,
        cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.35 : 0.8,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 0, fontFamily: "inherit",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function NavArrows({ index, total, onPrev, onNext, variant, strings, colors }: {
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  /** "edge": large buttons at the screen edges, dark so they stay legible
   * over any map. "inline": small buttons and an "n / N" counter. */
  variant: "inline" | "edge";
  strings: PlayerStrings;
  colors: PlayerColors;
}) {
  if (variant === "edge") {
    const edge: CSSProperties = { position: "absolute", top: "50%", transform: "translateY(-50%)", zIndex: 2 };
    return (
      <>
        <RoundButton label={strings.previous} size={56} disabled={index === 0} onClick={onPrev} style={{ ...edge, left: 24 }}>←</RoundButton>
        <RoundButton label={strings.next} size={56} disabled={index === total - 1} onClick={onNext} style={{ ...edge, right: 24 }}>→</RoundButton>
      </>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, marginTop: 16 }}>
      <RoundButton label={strings.previous} size={34} disabled={index === 0} onClick={onPrev}>←</RoundButton>
      <span style={{ fontSize: 14, color: colors.muted }}>{index + 1} / {total}</span>
      <RoundButton label={strings.next} size={34} disabled={index === total - 1} onClick={onNext}>→</RoundButton>
    </div>
  );
}

export function StoryPlayer({
  story, resolveMedia, dark = false, colors: colorOverrides, strings: stringOverrides, onClose,
  keyboard = true, onSlideChange, renderMapModeControl, brand, actions, initialSlide = 0,
}: StoryPlayerProps) {
  const colors = useMemo(() => ({ ...defaultColors(dark), ...colorOverrides }), [dark, colorOverrides]);
  const strings = useMemo(
    () => ({
      ...stringsFor(story.language, typeof navigator === "undefined" ? undefined : navigator.language),
      ...stringOverrides,
    }),
    [story.language, stringOverrides],
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const slides = story.slides;
  const [index, setIndex] = useState(initialSlide);
  const slide = slides[index];

  useEffect(() => {
    setIndex(Math.min(Math.max(initialSlide, 0), Math.max(slides.length - 1, 0)));
  }, [story, initialSlide, slides.length]);

  const datedSlides = useMemo(() => {
    const points: TimelinePoint[] = [];
    slides.forEach((s, i) => {
      const year = timelineYear(s.date);
      if (year !== null) points.push({ index: i, year });
    });
    return points;
  }, [slides]);
  const showTimeline = datedSlides.length >= 2;

  // Map modes: "auto" follows the current slide's year as the story moves.
  const [mapMode, setMapMode] = useState<MapMode>(() => initialMapMode(story));
  const [historicalYear, setHistoricalYear] = useState(() => new Date().getFullYear());
  const currentYear = timelineYear(slide?.date);
  const autoYear = currentYear !== null ? Math.floor(currentYear) : null;
  const yearBounds = useMemo<[number, number]>(() => {
    if (datedSlides.length === 0) {
      const thisYear = new Date().getFullYear();
      return [thisYear - 200, thisYear];
    }
    const years = datedSlides.map((d) => d.year);
    return [Math.floor(Math.min(...years)), Math.ceil(Math.max(...years))];
  }, [datedSlides]);
  // Entering Historical starts the slider on this slide's year.
  const wasHistoricalRef = useRef(false);
  useEffect(() => {
    if (mapMode === "historical" && !wasHistoricalRef.current) setHistoricalYear(autoYear ?? yearBounds[1]);
    wasHistoricalRef.current = mapMode === "historical";
  }, [mapMode, autoYear, yearBounds]);
  const ohmYear = mapMode === "standard" ? null : mapMode === "auto" ? autoYear : historicalYear;

  const goPrev = () => setIndex((i) => Math.max(i - 1, 0));
  const goNext = () => setIndex((i) => Math.min(i + 1, slides.length - 1));

  const onSlideChangeRef = useRef(onSlideChange);
  onSlideChangeRef.current = onSlideChange;
  useEffect(() => {
    onSlideChangeRef.current?.(index);
  }, [index]);

  useEffect(() => {
    if (!keyboard) return;
    const target: HTMLElement | Window | null = keyboard === "focus" ? rootRef.current : window;
    if (!target) return;
    function onKey(e: Event) {
      const key = (e as KeyboardEvent).key;
      const from = e.target as HTMLElement | null;
      // Not while typing a year into the map control.
      if (from && (from.tagName === "INPUT" || from.tagName === "TEXTAREA" || from.isContentEditable)) return;
      if (key === "ArrowRight") setIndex((i) => Math.min(i + 1, slides.length - 1));
      if (key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    }
    target.addEventListener("keydown", onKey);
    return () => target.removeEventListener("keydown", onKey);
  }, [keyboard, slides.length]);

  // A horizontal swipe on the slide (not the map, which a drag pans)
  // moves between slides.
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const swipeHandlers = {
    onTouchStart: (e: TouchEvent) => {
      const t = e.touches[0];
      swipeStart.current = e.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null;
    },
    onTouchEnd: (e: TouchEvent) => {
      const start = swipeStart.current;
      swipeStart.current = null;
      const t = e.changedTouches[0];
      if (!start || !t) return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx < 0) goNext();
      else goPrev();
    },
  };

  // Stable per slide, so a re-render for an unrelated reason (a map-mode
  // click) never looks like a new slide to the map's camera.
  const places = useMemo(() => storyPlaces(slides.map((s) => s.place)), [slides]);
  const mapSlide = useMemo<MapSlide>(() => ({
    key: slide?.id ?? String(index),
    place: slide?.place,
    // The opening card, with no place of its own, shows where the story goes.
    overview: index === 0 && !placeCenter(slide?.place) ? places : null,
  }), [slide, index, places]);
  const firstCenter = useMemo(() => {
    if (story.presentation?.basemap === "none") return null;
    for (const s of slides) {
      const center = placeCenter(s.place);
      if (center) return center;
    }
    return null;
  }, [story, slides]);

  const modeControlProps: MapModeControlProps = {
    mode: mapMode, onModeChange: setMapMode, autoYear, year: historicalYear, onYearChange: setHistoricalYear, yearBounds,
  };
  const mediaResolver = useMemo(() => (key: string) => {
    const item = Object.prototype.hasOwnProperty.call(story.media, key) ? story.media[key] : undefined;
    return item ? resolveMedia(key, item) : Promise.resolve(null);
  }, [story, resolveMedia]);

  const content = <SlideContent slide={slide} story={story} resolveMedia={resolveMedia} colors={colors} />;
  const timeline = showTimeline && (
    <TimelineStrip points={datedSlides} currentIndex={index} onSelect={setIndex} colors={colors} />
  );

  return (
    <div
      ref={rootRef}
      lang={story.language}
      tabIndex={keyboard === "focus" ? 0 : undefined}
      style={{
        position: "relative", width: "100%", height: "100%", overflow: "hidden",
        background: colors.surface, color: colors.text,
      }}
    >
      {/* Title bar: translucent, so it reads over the map too. */}
      <div
        style={{
          position: "absolute", top: 0, left: 0, right: 0, height: BAR_HEIGHT, zIndex: 3,
          background: dark ? "rgba(20,20,20,0.55)" : "rgba(255,255,255,0.55)",
        }}
      />
      <div
        dir="auto"
        style={{
          position: "absolute", top: 0, left: 20, height: BAR_HEIGHT, maxWidth: "26%", zIndex: 3,
          display: "flex", alignItems: "center", gap: 10, fontWeight: 600,
        }}
      >
        {brand && <span style={{ flex: "none", display: "flex" }}>{brand}</span>}
        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{story.title}</span>
      </div>
      {/* Centered on the whole bar, as a toolbar for the presentation; the
          full-width wrapper lets clicks through to anything under it. */}
      {firstCenter && (
        <div
          style={{
            position: "absolute", top: 0, left: 0, right: 0, height: BAR_HEIGHT, zIndex: 3,
            display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none",
          }}
        >
          <div style={{ pointerEvents: "auto" }}>
            {renderMapModeControl
              ? renderMapModeControl(modeControlProps)
              : <MapModeControl {...modeControlProps} strings={strings} colors={colors} />}
          </div>
        </div>
      )}
      {actions && (
        <div
          style={{
            position: "absolute", top: 0, right: onClose ? 60 : 12, height: BAR_HEIGHT, zIndex: 3,
            display: "flex", alignItems: "center", gap: 8,
          }}
        >
          {actions}
        </div>
      )}
      {onClose && (
        <RoundButton
          label={strings.close} size={36} onClick={onClose}
          style={{ position: "absolute", top: 10, right: 12, zIndex: 3 }}
        >
          ×
        </RoundButton>
      )}

      {firstCenter ? (
        <div style={{ position: "absolute", inset: 0 }}>
          <MapBackground
            initialCenter={firstCenter}
            current={mapSlide}
            dark={dark}
            colors={colors}
            panelFraction={PANEL_FRACTION}
            ohmYear={ohmYear}
            resolveMedia={mediaResolver}
          />
          <div
            style={{
              position: "absolute", top: 0, bottom: 0, right: 0, width: `${PANEL_FRACTION * 100}%`, zIndex: 1,
              padding: `${BAR_HEIGHT}px 32px ${showTimeline ? TIMELINE_HEIGHT : 32}px`, boxSizing: "border-box",
              display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 16,
              overflowY: "auto",
              // Transparent where the panel starts, mid-screen, and solid
              // well before the centered content, so text never sits on map.
              background: `linear-gradient(to right, transparent 0%, ${colors.panel} 22%)`,
            }}
            {...swipeHandlers}
          >
            {content}
          </div>
          <NavArrows index={index} total={slides.length} onPrev={goPrev} onNext={goNext} variant="edge" strings={strings} colors={colors} />
          {timeline}
        </div>
      ) : (
        <div
          style={{
            position: "absolute", inset: 0, overflowY: "auto", boxSizing: "border-box",
            padding: `${BAR_HEIGHT + 16}px 24px ${showTimeline ? TIMELINE_HEIGHT + 16 : 24}px`,
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16,
          }}
          {...swipeHandlers}
        >
          {content}
          <NavArrows index={index} total={slides.length} onPrev={goPrev} onNext={goNext} variant="inline" strings={strings} colors={colors} />
          {timeline}
        </div>
      )}
    </div>
  );
}
