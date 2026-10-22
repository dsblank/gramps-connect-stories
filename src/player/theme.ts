// The player's look, as plain values a host can override: colors (a host
// app passes its own theme's, so the story matches it) and the few words
// the player's own controls show.

export interface PlayerColors {
  /** Page and strip background. */
  surface: string;
  text: string;
  muted: string;
  border: string;
  /** The pin, timeline dots and default shape color. */
  mark: string;
  /** The slide panel's solid color, fading in over the map. */
  panel: string;
}

/** The marks' blue clears 3:1 against both surfaces. */
export function defaultColors(dark: boolean): PlayerColors {
  return dark
    ? { surface: "#242424", text: "#c9c9c9", muted: "#828282", border: "#424242", mark: "#3987e5", panel: "rgb(20,20,20)" }
    : { surface: "#ffffff", text: "#000000", muted: "#868e96", border: "#dee2e6", mark: "#2a78d6", panel: "rgb(255,255,255)" };
}

export interface PlayerStrings {
  previous: string;
  next: string;
  close: string;
  mapMode: string;
  auto: string;
  standard: string;
  historical: string;
  /** "Historical map, {year}" as the Auto mode's readout. */
  historicalMapYear: (year: number) => string;
  noDateStandardMap: string;
  historicalYear: string;
}

export const ENGLISH: PlayerStrings = {
  previous: "Previous",
  next: "Next",
  close: "Close",
  mapMode: "Map",
  auto: "Auto",
  standard: "Standard",
  historical: "Historical",
  historicalMapYear: (year) => `Historical map, ${year}`,
  noDateStandardMap: "No date here — standard map",
  historicalYear: "Historical map year",
};

/** A map pin (round top, point at the bottom) in a 24x24 box with its tip
 * at (12, 24): the map marker and the current timeline dot share it, and
 * every use aligns that tip to the point it marks. */
export const PIN_PATH_D = "M12 0C7.03 0 3 4.03 3 9c0 6.25 9 15 9 15s9-8.75 9-15c0-4.97-4.03-9-9-9z";
