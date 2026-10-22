// No bundled types upstream -- just the one function mapStyles.ts calls.
declare module "@openhistoricalmap/maplibre-gl-dates" {
  import type { Map as MapLibreMap } from "maplibre-gl";

  export function filterByDate(map: MapLibreMap, date: Date | string): void;
}
