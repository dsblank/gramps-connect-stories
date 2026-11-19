// The editors' words in the player's other languages (player/strings.ts),
// one file each: the story editor's, and its map editor's.
import type { EditorStrings } from "../strings.js";
import type { MapEditorStrings } from "../mapEditorStrings.js";
import * as de from "./de.js";
import * as es from "./es.js";
import * as fr from "./fr.js";
import * as nl from "./nl.js";

export interface EditorTranslation {
  editor: EditorStrings;
  mapEditor: MapEditorStrings;
}

export const TRANSLATIONS: Record<string, EditorTranslation> = { de, es, fr, nl };
