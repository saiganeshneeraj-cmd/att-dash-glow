// IndexedDB-backed cache for AttendEdge.
// Gives us local-first paint: read once synchronously into memory, then
// mirror every state change back to disk in the background so a fresh visit
// paints from cache before Supabase responds.
import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "attendedge-cache";
const DB_VERSION = 1;
const STORE = "state";

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (typeof indexedDB === "undefined") return null;
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      },
    });
  }
  return dbPromise;
}

const keyFor = (userId: string | null | undefined) => userId || "__local__";

export async function loadCached<T>(userId: string | null | undefined): Promise<T | null> {
  try {
    const db = await getDB();
    if (!db) return null;
    return (await db.get(STORE, keyFor(userId))) ?? null;
  } catch {
    return null;
  }
}

export async function saveCached<T>(userId: string | null | undefined, value: T): Promise<void> {
  try {
    const db = await getDB();
    if (!db) return;
    await db.put(STORE, value, keyFor(userId));
  } catch {
    /* quota / private mode — ignore */
  }
}
