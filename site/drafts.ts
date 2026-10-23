// The story being edited, kept in this browser (IndexedDB) so a reload or a
// closed tab doesn't lose it -- and the way the viewer hands a story to the
// editor page. One draft at a time. Nothing here leaves the browser.
import type { StoryDoc } from "../src/index";

export interface Draft {
  doc: StoryDoc;
  files: Map<string, Uint8Array>;
  /** The file it came from or was last saved to, if known. */
  fileName?: string;
  /** For saving back in place (File System Access API, Chrome and Edge). */
  handle?: FileSystemFileHandle;
  /** story.json as last saved or opened: unsaved changes are any difference. */
  savedJson?: string;
  updated: number;
}

const DB = "gramps-connect-story-editor";
const STORE = "drafts";
const KEY = "current";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = action(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

/** The saved draft, or null (also when this browser won't keep one, e.g. a
 * private window with storage blocked). */
export async function loadDraft(): Promise<Draft | null> {
  try {
    return (await run<Draft | undefined>("readonly", (s) => s.get(KEY))) ?? null;
  } catch {
    return null;
  }
}

/** Keeps the draft; false if this browser wouldn't. */
export async function saveDraft(draft: Draft): Promise<boolean> {
  try {
    await run("readwrite", (s) => s.put(draft, KEY));
    return true;
  } catch {
    return false;
  }
}

export async function clearDraft(): Promise<void> {
  try {
    await run("readwrite", (s) => s.delete(KEY));
  } catch {
    // Nothing kept, nothing to clear.
  }
}
