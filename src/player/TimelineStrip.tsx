// "A line with years on it, and a dot": where the current slide sits among
// the story's dated slides, with click-to-jump per dot. SVG, since a story
// has at most a few dozen dated slides and SVG rescales for free.
import { useEffect, useRef, useState } from "react";
import { axisTicks, storyDomain, tickLabel, xForYear } from "./timelineLayout";
import { PIN_PATH_D, type PlayerColors } from "./theme";

export const TIMELINE_HEIGHT = 70;
const MARGIN = 28;
/** Where each pin's tip touches the axis. */
const AXIS_Y = 42;
const LABEL_Y = 62;
const CURRENT_SCALE = 0.95;

export interface TimelinePoint {
  index: number;
  year: number;
}

export function TimelineStrip({ points, currentIndex, onSelect, colors }: {
  points: TimelinePoint[];
  currentIndex: number;
  onSelect: (index: number) => void;
  colors: PlayerColors;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const plotWidth = Math.max(0, width - MARGIN * 2);
  const domain = storyDomain(points.map((p) => p.year));
  const ticks = plotWidth > 0 ? axisTicks(domain, plotWidth) : [];

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute", left: 0, right: 0, bottom: 0, height: TIMELINE_HEIGHT, background: colors.surface,
        // Above the slide panel, whose fading background would otherwise
        // wash out any dot beneath it.
        zIndex: 2,
      }}
    >
      {width > 0 && (
        <svg width={width} height={TIMELINE_HEIGHT} style={{ display: "block", overflow: "visible" }}>
          <line x1={MARGIN} y1={AXIS_Y} x2={width - MARGIN} y2={AXIS_Y} stroke={colors.border} strokeWidth={1} />
          {ticks.map((tick) => (
            <text key={tick.x} x={MARGIN + tick.x} y={LABEL_Y} fontSize={15} fill={colors.muted} textAnchor="middle">
              {tick.label}
            </text>
          ))}
          {points.map((point) => {
            const cx = MARGIN + xForYear(point.year, domain, plotWidth);
            const current = point.index === currentIndex;
            return current ? (
              <path
                key={point.index}
                d={PIN_PATH_D}
                transform={`translate(${cx - 12 * CURRENT_SCALE} ${AXIS_Y - 24 * CURRENT_SCALE}) scale(${CURRENT_SCALE})`}
                fill={colors.mark}
                stroke={colors.text}
                strokeWidth={1.5}
                style={{ cursor: "pointer" }}
                onClick={() => onSelect(point.index)}
              >
                <title>{tickLabel(point.year)}</title>
              </path>
            ) : (
              <circle
                key={point.index}
                cx={cx}
                cy={AXIS_Y}
                r={3.5}
                fill={colors.mark}
                stroke={colors.surface}
                strokeWidth={1.5}
                style={{ cursor: "pointer" }}
                onClick={() => onSelect(point.index)}
              >
                <title>{tickLabel(point.year)}</title>
              </circle>
            );
          })}
        </svg>
      )}
    </div>
  );
}
