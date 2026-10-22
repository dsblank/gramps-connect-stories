// The player's own words -- the few on its buttons and map control, never
// the story's -- in a handful of languages, chosen by the story's language
// and then the browser's. A host with its own translations passes
// StoryPlayer's `strings` instead.

export interface PlayerStrings {
  previous: string;
  next: string;
  close: string;
  mapMode: string;
  auto: string;
  standard: string;
  historical: string;
  /** The Auto mode's readout. */
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

const TABLE: Record<string, PlayerStrings> = {
  en: ENGLISH,
  de: {
    previous: "Zurück",
    next: "Weiter",
    close: "Schließen",
    mapMode: "Karte",
    auto: "Automatisch",
    standard: "Standard",
    historical: "Historisch",
    historicalMapYear: (year) => `Historische Karte, ${year}`,
    noDateStandardMap: "Kein Datum hier — Standardkarte",
    historicalYear: "Jahr der historischen Karte",
  },
  es: {
    previous: "Anterior",
    next: "Siguiente",
    close: "Cerrar",
    mapMode: "Mapa",
    auto: "Automático",
    standard: "Estándar",
    historical: "Histórico",
    historicalMapYear: (year) => `Mapa histórico, ${year}`,
    noDateStandardMap: "Sin fecha aquí — mapa estándar",
    historicalYear: "Año del mapa histórico",
  },
  fr: {
    previous: "Précédent",
    next: "Suivant",
    close: "Fermer",
    mapMode: "Carte",
    auto: "Auto",
    standard: "Standard",
    historical: "Historique",
    historicalMapYear: (year) => `Carte historique, ${year}`,
    noDateStandardMap: "Pas de date ici — carte standard",
    historicalYear: "Année de la carte historique",
  },
  nl: {
    previous: "Vorige",
    next: "Volgende",
    close: "Sluiten",
    mapMode: "Kaart",
    auto: "Automatisch",
    standard: "Standaard",
    historical: "Historisch",
    historicalMapYear: (year) => `Historische kaart, ${year}`,
    noDateStandardMap: "Geen datum hier — standaardkaart",
    historicalYear: "Jaar van de historische kaart",
  },
};

/** The best table for a list of BCP 47 tags, most preferred first:
 * "de-CH" matches "de"; English when nothing does. */
export function stringsFor(...languages: (string | undefined)[]): PlayerStrings {
  for (const tag of languages) {
    const base = tag?.toLowerCase().split(/[-_]/)[0];
    if (base && TABLE[base]) return TABLE[base];
  }
  return ENGLISH;
}

/** Languages with a built-in table. */
export const PLAYER_LANGUAGES = Object.keys(TABLE);
