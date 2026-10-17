/** Unsent words have one durable owner: an atomic, conversation-scoped store. */
const DATABASE = 'neuma-portal-outbox-v1';
const TABLE = 'words';

/** An incomplete binding can never authorize replay into a later sitting. Pure. */
export const portalOutboxScope = (wallet, binding) =>
  wallet && binding?.neumaId && binding?.sessionId
    ? JSON.stringify([String(wallet).toLowerCase(), binding.neumaId, binding.sessionId])
    : null;

// impure — browser storage; failure is surfaced to the caller.
const openStore = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(DATABASE, 1);
  request.onupgradeneeded = () => {
    const table = request.result.createObjectStore(TABLE, { keyPath: 'messageId' });
    table.createIndex('scope', 'scope');
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const transaction = async (run) => {
  const db = await openStore();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(TABLE, 'readwrite');
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error || new Error('Outbox transaction aborted'));
      tx.onerror = () => reject(tx.error);
      try { run(tx.objectStore(TABLE)); } catch (error) { tx.abort(); reject(error); }
    });
  } finally { db.close(); }
};

/** Persist one unsent frame without replacing another window's words. impure. */
export const queuePortalWord = (scope, frame) => {
  if (!scope || !frame?.messageId) return Promise.reject(new Error('No conversation for queued words'));
  return transaction((table) => table.put({ messageId: frame.messageId, scope, frame }));
};

/**
 * Consume only successfully handed-off words. The readwrite transaction is
 * exclusive across tabs; the synchronous deliver callback rechecks the live
 * binding before each send. Socket handoff is not a durable server receipt.
 * impure (IndexedDB and caller's synchronous socket send).
 */
export const drainPortalWords = (scope, deliver) => {
  if (!scope) return Promise.resolve();
  return transaction((table) => {
    const request = table.index('scope').getAll(scope);
    request.onsuccess = () => {
      const rows = request.result.sort((a, b) => a.frame.timestamp - b.frame.timestamp);
      for (const row of rows) {
        if (!deliver(row.frame)) break;
        table.delete(row.messageId);
      }
    };
  });
};
