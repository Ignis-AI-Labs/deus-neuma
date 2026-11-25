// timeline-refold-pure — the pure half of timeline-refold.js (the reducer imports no network code).

/** pure — the messages after a take that just opened at `index` leave the view (they followed its older take). */
export const cutAfter = (messages, index) => (index >= 0 && index < messages.length - 1 ? messages.slice(0, index + 1) : messages);

/** pure — the record's messages on the screen's own ids: a point already shown keeps the id it had. */
export const keepIds = (fresh, shown) => {
  const held = new Map(shown.filter((m) => m.turnId).map((m) => [`${m.role}|${m.turnId}`, m.id]));
  const used = new Set();
  return fresh.map((m) => {
    const id = m.turnId ? held.get(`${m.role}|${m.turnId}`) : null;
    if (!id || used.has(id)) return m;
    used.add(id);
    return { ...m, id };
  });
};
