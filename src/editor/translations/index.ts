// The editors' words in the player's other languages (player/strings.ts),
// one file each: the story editor's, and its map editor's.
import type { EditorStrings } from "../strings";
import type { MapEditorStrings } from "../mapEditorStrings";
import * as de from "./de";
import * as es from "./es";
import * as fr from "./fr";
import * as nl from "./nl";

export interface EditorTranslation {
  editor: EditorStrings;
  mapEditor: MapEditorStrings;
}

export const TRANSLATIONS: Record<string, EditorTranslation> = { de, es, fr, nl };
