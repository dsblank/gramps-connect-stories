// The Auto / Standard / Historical map picker, in plain HTML. A host app
// with its own UI kit can supply its own control instead (StoryPlayer's
// renderMapModeControl), taking the same props.
import type { PlayerColors, PlayerStrings } from "./theme";

/** "standard" is today's map; "historical" a map of the year the viewer
 * picks; "auto" a map of each slide's own year as the story moves. */
export type MapMode = "auto" | "standard" | "historical";

export interface MapModeControlProps {
  mode: MapMode;
  onModeChange: (mode: MapMode) => void;
  /** What Auto resolves to on this slide, or null with no date to use. */
  autoYear: number | null;
  /** The viewer's own pick, live while mode is "historical". */
  year: number;
  onYearChange: (year: number) => void;
  yearBounds: [number, number];
}

export function MapModeControl({ mode, onModeChange, autoYear, year, onYearChange, yearBounds, strings, colors }:
  MapModeControlProps & { strings: PlayerStrings; colors: PlayerColors }) {
  const modes: [MapMode, string][] = [["auto", strings.auto], ["standard", strings.standard], ["historical", strings.historical]];
  const font = { fontSize: 12, fontFamily: "inherit" };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, whiteSpace: "nowrap" }}>
      <div role="radiogroup" aria-label={strings.mapMode} style={{ display: "flex", border: `1px solid ${colors.border}`, borderRadius: 6, overflow: "hidden", background: colors.surface }}>
        {modes.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            onClick={() => onModeChange(value)}
            style={{
              ...font, padding: "4px 10px", border: "none", cursor: "pointer",
              background: mode === value ? colors.mark : "transparent",
              color: mode === value ? "#ffffff" : colors.text,
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === "auto" && (
        <span style={{ ...font, color: colors.muted }}>
          {autoYear != null ? strings.historicalMapYear(autoYear) : strings.noDateStandardMap}
        </span>
      )}
      {mode === "historical" && (
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="range"
            min={yearBounds[0]}
            max={yearBounds[1]}
            step={1}
            value={year}
            onChange={(e) => onYearChange(Number(e.currentTarget.value))}
            aria-label={strings.historicalYear}
            style={{ width: 150, accentColor: colors.mark }}
          />
          <input
            type="number"
            min={yearBounds[0]}
            max={yearBounds[1]}
            step={1}
            value={year}
            onChange={(e) => {
              const value = Number(e.currentTarget.value);
              if (Number.isFinite(value) && e.currentTarget.value !== "") onYearChange(Math.round(value));
            }}
            aria-label={strings.historicalYear}
            style={{ ...font, width: 70, padding: "3px 4px", border: `1px solid ${colors.border}`, borderRadius: 4, background: colors.surface, color: colors.text }}
          />
        </span>
      )}
    </div>
  );
}
