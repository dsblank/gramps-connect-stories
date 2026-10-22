// Layout math for the timeline strip along the bottom of a story -- pure
// numbers, no DOM.

/** The year range the strip covers, with a little padding, so a lone dot
 * (or two dots in the same year) still sits on a real span. */
export function storyDomain(years: number[]): [number, number] {
  const min = Math.min(...years);
  const max = Math.max(...years);
  if (max - min < 1) return [min - 5, min + 5];
  const padding = (max - min) * 0.05;
  return [min - padding, max + padding];
}

/** Where a year lands across a `width`-px strip for `domain`. */
export function xForYear(year: number, domain: [number, number], width: number): number {
  const [start, end] = domain;
  const span = end - start;
  if (!(span > 0)) return width / 2;
  return ((year - start) / span) * width;
}

export interface AxisTick {
  x: number;
  label: string;
}

/** Candidate tick spacings in years, coarse to fine. */
const TICK_STEPS = [1000, 500, 250, 100, 50, 25, 10, 5, 2, 1];
/** Aim for roughly this many labelled ticks. */
const TARGET_TICKS = 8;

export function axisTicks(domain: [number, number], width: number): AxisTick[] {
  const [start, end] = domain;
  const span = end - start;
  if (!(span > 0) || width <= 0) return [];
  const step = TICK_STEPS.find((candidate) => span / candidate >= TARGET_TICKS) ?? 1;
  const ticks: AxisTick[] = [];
  for (let year = Math.ceil(start / step) * step; year < end; year += step) {
    ticks.push({ x: ((year - start) / span) * width, label: tickLabel(year) });
  }
  return ticks;
}

/** Negative years are BC: genealogical calendars have no year 0. */
export function tickLabel(year: number): string {
  const whole = Math.floor(year);
  return whole < 0 ? `${-whole} BC` : String(whole);
}
