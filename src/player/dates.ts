// What the player needs from a story's dates: which years an EDTF value
// covers (to show a historical map overlay only in its own era), and a
// position on the timeline finer than a whole year when the date allows.
import type { StoryDate } from "../types";

export interface YearRange {
  /** Undefined for an open start ("../1850"). */
  min?: number;
  /** Undefined for an open end ("1850/.."). */
  max?: number;
}

const DATE = /^(-?\d{4})(?:-(\d{2}|XX))?(?:-(\d{2}|XX))?[~?%]?$/;

function yearOf(part: string): number | null {
  const match = DATE.exec(part.trim());
  return match ? Number(match[1]) : null;
}

/** The years an EDTF date covers, or null when it can't be read (which
 * callers treat the same as having no date). Handles single dates
 * ("1850", "1850-03-12", "1850~"), intervals ("1850/1860", "../1850",
 * "1850/..") and one-of sets ("[1850..1860]"). */
export function edtfYearRange(edtf: string | undefined): YearRange | null {
  if (!edtf) return null;
  const value = edtf.trim();
  const set = /^\[(.+)\.\.(.+)\]$/.exec(value);
  if (set) {
    const min = yearOf(set[1]);
    const max = yearOf(set[2]);
    return min !== null && max !== null ? { min: Math.min(min, max), max: Math.max(min, max) } : null;
  }
  if (value.includes("/")) {
    const [startText, endText] = value.split("/");
    const openStart = startText === ".." || startText === "";
    const openEnd = endText === ".." || endText === "";
    const start = openStart ? undefined : yearOf(startText);
    const end = openEnd ? undefined : yearOf(endText);
    if (start === null || end === null) return null;
    if (start === undefined && end === undefined) return null;
    if (start !== undefined && end !== undefined) return { min: Math.min(start, end), max: Math.max(start, end) };
    return { min: start, max: end };
  }
  const year = yearOf(value);
  return year === null ? null : { min: year, max: year };
}

/** Whether something dated `date` belongs on a map of `year`. No date, an
 * unreadable one, or no year to compare against (a standard, non-historical
 * map) all mean visible: an undated overlay is never hidden. */
export function dateCoversYear(date: StoryDate | undefined, year: number | null): boolean {
  if (!date || year === null) return true;
  const range = edtfYearRange(date.edtf);
  if (!range) return true;
  if (range.min !== undefined && year < range.min) return false;
  if (range.max !== undefined && year > range.max) return false;
  return true;
}

/** A slide's position on the timeline, as a fractional year: its
 * `sortYear`, nudged within the year by the EDTF month and day when they
 * agree with it -- so two events in the same year don't land on the exact
 * same spot. Null for a slide that isn't on the timeline. */
export function timelineYear(date: StoryDate | undefined): number | null {
  if (!date) return null;
  const match = date.edtf ? DATE.exec(date.edtf.trim()) : null;
  const sortYear = date.sortYear ?? (match ? Number(match[1]) : undefined);
  if (sortYear === undefined) return null;
  if (!match || Number(match[1]) !== sortYear) return sortYear;
  const month = match[2] && match[2] !== "XX" ? Number(match[2]) : 0;
  const day = match[3] && match[3] !== "XX" ? Number(match[3]) : 0;
  if (!month) return sortYear;
  return sortYear + (month - 1) / 12 + (day ? (day - 1) / 365 : 0);
}
