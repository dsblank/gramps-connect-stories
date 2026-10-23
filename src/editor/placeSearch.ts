// Finding a place by name, for the place field's opt-in search: Wikidata's
// own search, then the chosen item's coordinates (P625). Both endpoints
// allow any origin and need no key. This is the only thing the editor
// sends anywhere, and only when asked to: it sends the name typed.
// (Gramps Connect's place lookup walks the same API further, up the
// "located in" chain, to build a place hierarchy; a story place is just a
// name and a point.)

const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const WIKIDATA_ENTITY_DATA = "https://www.wikidata.org/wiki/Special:EntityData";

export interface PlaceSearchResult {
  /** The Wikidata item, e.g. "Q72". */
  id: string;
  label: string;
  /** Usually names the region and country, which tells same-named places
   * apart. */
  description?: string;
}

export interface PlaceSearch {
  search: (term: string, language: string | undefined, signal?: AbortSignal) => Promise<PlaceSearchResult[]>;
  /** The result's position, or null when it has none. */
  point: (result: PlaceSearchResult, signal?: AbortSignal) => Promise<{ lat: number; lon: number } | null>;
}

/** "fr_CA" or "fr-CA" -> "fr-ca", Wikidata's form. */
function wikidataLanguage(language: string | undefined): string {
  return (language ?? "").trim().toLowerCase().replace(/_/g, "-") || "en";
}

export async function searchWikidataPlaces(term: string, language?: string, signal?: AbortSignal): Promise<PlaceSearchResult[]> {
  const code = wikidataLanguage(language);
  const params = new URLSearchParams({
    action: "wbsearchentities", search: term, language: code, uselang: code, format: "json", limit: "7",
    origin: "*", // what makes an anonymous api.php GET answer cross-origin
  });
  const res = await fetch(`${WIKIDATA_API}?${params}`, { signal });
  if (!res.ok) throw new Error(`Wikidata search failed (${res.status})`);
  const data = (await res.json()) as { search?: { id: string; label?: string; description?: string }[] };
  return (data.search ?? []).map((hit) => ({
    id: hit.id,
    label: hit.label ?? hit.id,
    ...(hit.description ? { description: hit.description } : {}),
  }));
}

export async function wikidataPoint(result: PlaceSearchResult, signal?: AbortSignal): Promise<{ lat: number; lon: number } | null> {
  const res = await fetch(`${WIKIDATA_ENTITY_DATA}/${encodeURIComponent(result.id)}.json`, { signal });
  if (!res.ok) throw new Error(`Wikidata fetch failed for ${result.id} (${res.status})`);
  const data = (await res.json()) as {
    entities?: Record<string, { claims?: Record<string, { mainsnak?: { datavalue?: { value?: unknown } } }[]> }>;
  };
  // A redirected item comes back under its new id: take whichever is there.
  const entity = data.entities?.[result.id] ?? Object.values(data.entities ?? {})[0];
  const value = entity?.claims?.P625?.[0]?.mainsnak?.datavalue?.value as { latitude?: number; longitude?: number } | undefined;
  if (typeof value?.latitude !== "number" || typeof value.longitude !== "number") return null;
  return { lat: value.latitude, lon: value.longitude };
}

export const WIKIDATA_PLACE_SEARCH: PlaceSearch = { search: searchWikidataPlaces, point: wikidataPoint };
