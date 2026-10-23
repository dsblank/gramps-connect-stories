// A date as typed ("about 1850", "um 1850") to its precise form (EDTF),
// read the way Gramps reads dates, in the story's language: the player
// needs the precise form for the timeline and for picking historical maps.
import { loadLocale, parseDate, resolveLocaleCode, toEdtf } from "@gramps-connect/gramps-date";

/** Turns date text into EDTF, or undefined when the text isn't a date
 * that has one ("spring 1850", a non-Gregorian date). */
export type DateTextParser = (text: string, language: string | undefined) => Promise<string | undefined>;

/** The default parser: gramps-date in the story's language (loaded on first
 * use), English when the story has none or gramps-date doesn't know it. */
export const suggestEdtf: DateTextParser = async (text, language) => {
  if (!text.trim()) return undefined;
  const code = (language && resolveLocaleCode(language.replace(/-/g, "_"))) || "en";
  if (code !== "en" && !(await loadLocale(code))) return undefined;
  try {
    return toEdtf(parseDate(text, { locale: code }));
  } catch {
    return undefined;
  }
};
