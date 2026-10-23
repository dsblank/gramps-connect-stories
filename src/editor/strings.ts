// The editor's own words. English here; a host with its own translations
// (Gramps Connect) passes StoryEditor's `strings` instead.

export interface EditorStrings {
  story: string;
  storySettings: string;
  title: string;
  language: string;
  languageHint: string;
  map: string;
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
  photos: string;
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
  photos: "Photos",
  undo: "Undo",
  redo: "Redo",
  present: "Present",
  preview: "Preview",
  problems: (count) => (count === 1 ? "1 problem to fix before saving" : `${count} problems to fix before saving`),
  openingSlide: "Opening slide",
};
