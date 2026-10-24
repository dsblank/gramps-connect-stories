// The editor's own words, in English and the player's other languages
// (translations/). The editor picks by the browser's languages; a host
// with its own translations (Gramps Connect) passes StoryEditor's
// `strings` instead.
import { TRANSLATIONS } from "./translations";

export interface EditorStrings {
  story: string;
  storySettings: string;
  title: string;
  language: string;
  languageHint: string;
  map: string;
  mapHint: string;
  mapStandard: string;
  mapHistorical: string;
  mapAuto: string;
  mapNone: string;
  slides: string;
  untitledSlide: string;
  addSlide: string;
  duplicateSlide: string;
  deleteSlide: string;
  moveUp: string;
  moveDown: string;
  slideTitle: string;
  text: string;
  bold: string;
  italic: string;
  date: string;
  dateHint: string;
  preciseDate: string;
  preciseDateHint: string;
  preciseDateFollows: string;
  preciseDateNotUnderstood: string;
  matchDateAsWritten: string;
  noPreciseDate: string;
  place: string;
  placeName: string;
  removePlace: string;
  findPlace: string;
  findPlaceHint: string;
  findPlaceNone: string;
  findPlaceFailed: string;
  findPlaceNoPoint: (name: string) => string;
  coordinates: string;
  coordinatesHint: string;
  coordinatesInvalid: string;
  placeMap: string;
  placeMapHint: string;
  placeShape: string;
  placeOverlays: (count: number) => string;
  placeKeeps: (what: string) => string;
  editMap: string;
  editMapHint: string;
  /** The map editor's help on adding an image, where images are files. */
  mapHelpImage: string;
  mapDialogTitle: (placeName: string | undefined) => string;
  mapHelp: string;
  importShapes: string;
  importShapesHint: string;
  importFailed: (fileName: string) => string;
  importNothing: (fileName: string) => string;
  overlayAlready: string;
  overlayDate: string;
  overlayDateHint: string;
  cancel: string;
  done: string;
  photos: string;
  photosHint: string;
  addPhoto: string;
  replacePhoto: string;
  movePhotoUp: string;
  movePhotoDown: string;
  removePhoto: string;
  caption: string;
  credit: string;
  creditHint: string;
  description: string;
  descriptionHint: string;
  photoFailed: (name: string) => string;
  undo: string;
  redo: string;
  present: string;
  preview: string;
  problems: (count: number) => string;
  openingSlide: string;
}

export const EDITOR_ENGLISH: EditorStrings = {
  story: "Story",
  storySettings: "Title, language and map",
  title: "Title",
  language: "Language",
  languageHint: "The language the story is written in, e.g. en, de or fr-CA. Dates are read in it.",
  map: "Map",
  mapHint: "How the map starts when the story plays. Readers can still change it.",
  mapStandard: "Today's map",
  mapHistorical: "Historical maps for each slide's year",
  mapAuto: "Viewer's choice",
  mapNone: "No map",
  slides: "Slides",
  untitledSlide: "Untitled slide",
  addSlide: "Add slide",
  duplicateSlide: "Duplicate",
  deleteSlide: "Delete",
  moveUp: "Move up",
  moveDown: "Move down",
  slideTitle: "Title",
  text: "Text",
  bold: "Bold",
  italic: "Italic",
  date: "Date",
  dateHint: "As readers should see it, e.g. about 1850, 3 May 1850, between 1850 and 1860.",
  preciseDate: "Precise date (EDTF)",
  preciseDateHint: "Places the slide on the timeline and picks historical maps.",
  preciseDateFollows: "Worked out from the date as written.",
  preciseDateNotUnderstood: "Not a date the timeline can use.",
  matchDateAsWritten: "Work it out from the date",
  noPreciseDate: "None: this slide stays off the timeline.",
  place: "Place",
  placeName: "Name",
  removePlace: "Remove place",
  findPlace: "Find on Wikidata",
  findPlaceHint: "Looks the name up on Wikidata, to put the pin there. The name is all that's sent, and only when you ask.",
  findPlaceNone: "Wikidata has no place by that name.",
  findPlaceFailed: "Couldn't reach Wikidata.",
  findPlaceNoPoint: (name) => `Wikidata has no map position for ${name}.`,
  coordinates: "Latitude, longitude",
  coordinatesHint: "e.g. 47.3769, 8.5417",
  coordinatesInvalid: "Two numbers: latitude (-90 to 90), then longitude (-180 to 180).",
  placeMap: "Map: click to put the pin",
  placeMapHint: "Click the map to put the pin there, or drag the pin.",
  placeShape: "a shape",
  placeOverlays: (count) => (count === 1 ? "a map overlay" : `${count} map overlays`),
  placeKeeps: (what) => `This place also has ${what}.`,
  editMap: "Edit map",
  editMapHint: "Shapes under the pin (a parish, a route) and scans of old maps laid over it.",
  mapHelpImage: "Image: add a picture file, such as a scan of an old map -- see",
  mapDialogTitle: (placeName) => (placeName ? `Map: ${placeName}` : "Map"),
  mapHelp: "How to use this editor",
  importShapes: "Import shapes",
  importShapesHint: "Adds the points, lines and areas in a KML, GPX or GeoJSON file to this map.",
  importFailed: (fileName) => `Couldn't read ${fileName} as a KML, GPX or GeoJSON file.`,
  importNothing: (fileName) => `${fileName} has no shapes in it.`,
  overlayAlready: "That image is already on this map.",
  overlayDate: "Years it shows",
  overlayDateHint: "e.g. 1850, or 1850 to 1880. With historical maps, it's hidden on slides outside them.",
  cancel: "Cancel",
  done: "Done",
  photos: "Photos",
  photosHint: "Add, drop or paste a photo. It's resized for the screen, and hidden details like camera and location are left out.",
  addPhoto: "Add photo",
  replacePhoto: "Replace",
  movePhotoUp: "Move photo up",
  movePhotoDown: "Move photo down",
  removePhoto: "Remove",
  caption: "Caption",
  credit: "Credit",
  creditHint: "Who took it, or where it's from",
  description: "Description",
  descriptionHint: "What the photo shows, for anyone who can't see it.",
  photoFailed: (name) => `Couldn't use ${name}: this browser can't read it as an image.`,
  undo: "Undo",
  redo: "Redo",
  present: "Present",
  preview: "Preview",
  problems: (count) => (count === 1 ? "1 problem to fix before saving" : `${count} problems to fix before saving`),
  openingSlide: "Opening slide",
};

/** The browser's languages, most preferred first (none outside one). */
export function browserLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language];
}

/** The first of `languages` (BCP 47 tags, or Gramps' de_AT form) the
 * editors have words for, as its base code: "de-CH" is "de". English
 * counts, so "en-US, de" stays English. */
export function editorLanguage(languages: readonly (string | undefined)[]): string | undefined {
  for (const tag of languages) {
    const base = tag?.toLowerCase().split(/[-_]/)[0];
    if (base === "en" || (base && Object.prototype.hasOwnProperty.call(TRANSLATIONS, base))) return base;
  }
  return undefined;
}

/** The translations for the first of `languages` the editors have;
 * none for English. */
export function translationFor(languages: readonly (string | undefined)[]) {
  const lang = editorLanguage(languages);
  return lang && lang !== "en" ? TRANSLATIONS[lang] : undefined;
}

/** The editor's words in the first of `languages` it has; English when
 * none. */
export function editorStringsFor(...languages: (string | undefined)[]): EditorStrings {
  return translationFor(languages)?.editor ?? EDITOR_ENGLISH;
}

/** Languages the editors have words for, besides English. */
export const EDITOR_LANGUAGES = Object.keys(TRANSLATIONS);
