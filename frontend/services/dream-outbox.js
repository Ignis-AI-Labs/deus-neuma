// dream-outbox — a dream lives on the phone until the desk says it has it.
//
// A recording is written here while it is still being spoken (the take so far,
// every few seconds) and again when it stops; it leaves only after the desk
// answers that it kept it. A dropped link, a dead tab, a phone that slept: the
// dream is still here, and goes on the next send. impure (IndexedDB).
const DATABASE = 'neuma-dream-outbox-v1';
const TABLE = 'takes';

const openStore = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(DATABASE, 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore(TABLE, { keyPath: 'id' }).createIndex('wallet', 'wallet');
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const inTable = async (mode, run) => {
  const db = await openStore();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(TABLE, mode);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error || new Error('Dream outbox transaction aborted'));
      tx.onerror = () => reject(tx.error);
      const request = run(tx.objectStore(TABLE));
      if (request) request.onsuccess = () => { result = request.result; };
    });
  } finally { db.close(); }
};

/**
 * Keep (or replace) a take. `done` is false while it is still being recorded.
 * @param {{ id: string, wallet: string, blob: Blob, recordedAt: string, durationMs: number, done: boolean }} take
 */
export const keepTake = (take) => inTable('readwrite', (t) => t.put({ ...take, wallet: String(take.wallet).toLowerCase() }));

/** Every take this wallet has not yet handed to the desk, oldest first. */
export const takesOf = async (wallet) => {
  const rows = await inTable('readonly', (t) => t.index('wallet').getAll(String(wallet).toLowerCase()));
  return (rows ?? []).sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
};

/** The desk has it: let it go. */
export const releaseTake = (id) => inTable('readwrite', (t) => t.delete(id));
