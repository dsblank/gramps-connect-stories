// The Story Editor page's own words (edit.html: its landing page, Open,
// Save, ...), in the editor's languages, picked by the browser's.
import { editorLanguage } from "../src/editor/strings";

export interface PageStrings {
  pageTitle: string;
  landingBefore: string;
  landingAfter: string;
  openStory: string;
  newStory: string;
  backToViewer: string;
  storyFiles: string;
  untitledStory: string;
  draftNotKept: string;
  unsaved: string;
  open: string;
  new: string;
  save: string;
  saveAs: string;
  close: string;
  savedTo: (fileName: string) => string;
  downloaded: (fileName: string) => string;
  saveFailed: (error: string) => string;
  fetchFailed: (src: string, status: number) => string;
  discardTitle: string;
  discardText: string;
  keepEditing: string;
  discard: string;
}

const ENGLISH: PageStrings = {
  pageTitle: "Story Editor",
  landingBefore: "Change a family-history story (",
  landingAfter: "): its slides' titles, dates, places, text and photos, and their order. "
    + "Your story stays on your computer: nothing is uploaded.",
  openStory: "Open a story…",
  newStory: "New story",
  backToViewer: "Back to the Story Viewer",
  storyFiles: "Story",
  untitledStory: "Untitled story",
  draftNotKept: "This browser won't keep your changes between visits: save before closing the page.",
  unsaved: "Unsaved changes",
  open: "Open…",
  new: "New",
  save: "Save",
  saveAs: "Save as…",
  close: "Close",
  savedTo: (fileName) => `Saved to ${fileName}.`,
  downloaded: (fileName) => `Downloaded ${fileName}.`,
  saveFailed: (error) => `Couldn't save: ${error}`,
  fetchFailed: (src, status) => `Couldn't fetch ${src} (${status}).`,
  discardTitle: "Discard unsaved changes?",
  discardText: "The changes since you last saved this story will be lost.",
  keepEditing: "Keep editing",
  discard: "Discard",
};

const TABLE: Record<string, PageStrings> = {
  de: {
    pageTitle: "Geschichten-Editor",
    landingBefore: "Bearbeiten Sie eine Familiengeschichte (",
    landingAfter: "): Titel, Daten, Orte, Texte und Fotos ihrer Folien und deren Reihenfolge. "
      + "Ihre Geschichte bleibt auf Ihrem Computer: Nichts wird hochgeladen.",
    openStory: "Geschichte öffnen…",
    newStory: "Neue Geschichte",
    backToViewer: "Zurück zum Geschichten-Betrachter",
    storyFiles: "Geschichte",
    untitledStory: "Geschichte ohne Titel",
    draftNotKept: "Dieser Browser behält Ihre Änderungen nicht bis zum nächsten Besuch: Speichern Sie, bevor Sie die Seite schließen.",
    unsaved: "Ungespeicherte Änderungen",
    open: "Öffnen…",
    new: "Neu",
    save: "Speichern",
    saveAs: "Speichern unter…",
    close: "Schließen",
    savedTo: (fileName) => `In ${fileName} gespeichert.`,
    downloaded: (fileName) => `${fileName} heruntergeladen.`,
    saveFailed: (error) => `Speichern fehlgeschlagen: ${error}`,
    fetchFailed: (src, status) => `${src} konnte nicht abgerufen werden (${status}).`,
    discardTitle: "Ungespeicherte Änderungen verwerfen?",
    discardText: "Die Änderungen seit dem letzten Speichern dieser Geschichte gehen verloren.",
    keepEditing: "Weiter bearbeiten",
    discard: "Verwerfen",
  },
  es: {
    pageTitle: "Editor de historias",
    landingBefore: "Modifique una historia familiar (",
    landingAfter: "): los títulos, fechas, lugares, textos y fotos de sus diapositivas, y su orden. "
      + "Su historia se queda en su ordenador: no se sube nada.",
    openStory: "Abrir una historia…",
    newStory: "Nueva historia",
    backToViewer: "Volver al visor de historias",
    storyFiles: "Historia",
    untitledStory: "Historia sin título",
    draftNotKept: "Este navegador no guardará sus cambios entre visitas: guarde antes de cerrar la página.",
    unsaved: "Cambios sin guardar",
    open: "Abrir…",
    new: "Nueva",
    save: "Guardar",
    saveAs: "Guardar como…",
    close: "Cerrar",
    savedTo: (fileName) => `Guardada en ${fileName}.`,
    downloaded: (fileName) => `${fileName} descargada.`,
    saveFailed: (error) => `No se pudo guardar: ${error}`,
    fetchFailed: (src, status) => `No se pudo obtener ${src} (${status}).`,
    discardTitle: "¿Descartar los cambios sin guardar?",
    discardText: "Se perderán los cambios hechos desde la última vez que guardó esta historia.",
    keepEditing: "Seguir editando",
    discard: "Descartar",
  },
  fr: {
    pageTitle: "Éditeur d’histoires",
    landingBefore: "Modifiez une histoire familiale (",
    landingAfter: ") : les titres, dates, lieux, textes et photos de ses diapositives, et leur ordre. "
      + "Votre histoire reste sur votre ordinateur : rien n’est envoyé.",
    openStory: "Ouvrir une histoire…",
    newStory: "Nouvelle histoire",
    backToViewer: "Retour à la visionneuse d’histoires",
    storyFiles: "Histoire",
    untitledStory: "Histoire sans titre",
    draftNotKept: "Ce navigateur ne gardera pas vos modifications d’une visite à l’autre : enregistrez avant de fermer la page.",
    unsaved: "Modifications non enregistrées",
    open: "Ouvrir…",
    new: "Nouvelle",
    save: "Enregistrer",
    saveAs: "Enregistrer sous…",
    close: "Fermer",
    savedTo: (fileName) => `Enregistrée dans ${fileName}.`,
    downloaded: (fileName) => `${fileName} téléchargée.`,
    saveFailed: (error) => `Impossible d’enregistrer : ${error}`,
    fetchFailed: (src, status) => `Impossible de récupérer ${src} (${status}).`,
    discardTitle: "Abandonner les modifications non enregistrées ?",
    discardText: "Les modifications faites depuis le dernier enregistrement de cette histoire seront perdues.",
    keepEditing: "Continuer à modifier",
    discard: "Abandonner",
  },
  nl: {
    pageTitle: "Verhaaleditor",
    landingBefore: "Wijzig een familieverhaal (",
    landingAfter: "): de titels, datums, plaatsen, teksten en foto's van de dia's, en hun volgorde. "
      + "Uw verhaal blijft op uw computer: er wordt niets geüpload.",
    openStory: "Een verhaal openen…",
    newStory: "Nieuw verhaal",
    backToViewer: "Terug naar de verhaalviewer",
    storyFiles: "Verhaal",
    untitledStory: "Verhaal zonder titel",
    draftNotKept: "Deze browser bewaart uw wijzigingen niet tussen bezoeken: sla op voordat u de pagina sluit.",
    unsaved: "Niet-opgeslagen wijzigingen",
    open: "Openen…",
    new: "Nieuw",
    save: "Opslaan",
    saveAs: "Opslaan als…",
    close: "Sluiten",
    savedTo: (fileName) => `Opgeslagen in ${fileName}.`,
    downloaded: (fileName) => `${fileName} gedownload.`,
    saveFailed: (error) => `Opslaan mislukt: ${error}`,
    fetchFailed: (src, status) => `${src} kon niet worden opgehaald (${status}).`,
    discardTitle: "Niet-opgeslagen wijzigingen weggooien?",
    discardText: "De wijzigingen sinds u dit verhaal voor het laatst hebt opgeslagen, gaan verloren.",
    keepEditing: "Verder bewerken",
    discard: "Weggooien",
  },
};

/** The page's words, and the language they're in: the editor's (see
 * editorLanguage), so the page and the editor never disagree. */
export function pageStringsFor(languages: readonly string[]): { lang: string; strings: PageStrings } {
  const lang = editorLanguage(languages);
  return lang && lang !== "en" && Object.prototype.hasOwnProperty.call(TABLE, lang)
    ? { lang, strings: TABLE[lang] }
    : { lang: "en", strings: ENGLISH };
}
