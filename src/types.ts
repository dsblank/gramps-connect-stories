// The shape of story.json, format 1.x -- spec/1.0/README.md is the
// normative description; these types follow it field for field. Every
// interface allows unknown keys at runtime (a 1.0 reader must accept a
// 1.3 file and ignore what it doesn't know), but the types only name the
// fields this version of the package understands.

export interface StoryDoc {
  $schema?: string;
  format: "gramps-connect-story";
  /** "MAJOR.MINOR". After readStoryZip()/upgradeStory() the major is
   * always CURRENT_MAJOR; the minor is whatever the file said. */
  version: string;
  title: string;
  slides: Slide[];
  /** Keyed by media id; slides and overlays refer to these keys. */
  media: Record<string, MediaItem>;
  language?: string;
  created?: string;
  generator?: { name: string; version?: string; url?: string };
  authors?: { name: string; url?: string }[];
  license?: string;
  presentation?: Presentation;
  extensions?: Record<string, Record<string, unknown>>;
}

export interface Presentation {
  basemap?: "standard" | "historical" | "auto" | "none";
}

export interface Slide {
  id: string;
  title?: string;
  /** Markup: **bold**, *italic*, line breaks -- nothing else. */
  text?: string;
  date?: StoryDate;
  place?: Place;
  media?: SlideMedia[];
  people?: { name: string; role?: string }[];
}

export interface StoryDate {
  /** Display form, in the story's language. */
  text: string;
  /** Extended Date/Time Format (ISO 8601-2), when the date fits it. */
  edtf?: string;
  sortYear?: number;
}

export interface Place {
  name?: string;
  /** WGS 84; lat and lon are present together or not at all. */
  lat?: number;
  lon?: number;
  /** GeoJSON FeatureCollection, Feature, or bare geometry. */
  geometry?: { type: string; [key: string]: unknown };
  overlays?: Overlay[];
}

/** [longitude, latitude] */
export type LonLat = [number, number];

export interface Overlay {
  /** Key into StoryDoc.media. */
  media: string;
  /** Top-left, top-right, bottom-right, bottom-left. */
  corners: [LonLat, LonLat, LonLat, LonLat];
  opacity?: number;
  order?: number;
  date?: StoryDate;
}

export interface SlideMedia {
  /** Key into StoryDoc.media. */
  ref: string;
  caption?: string;
  credit?: string;
}

export interface MediaItem {
  /** Path inside the zip, relative to its root. */
  src: string;
  mime: string;
  width?: number;
  height?: number;
  alt?: string;
}
