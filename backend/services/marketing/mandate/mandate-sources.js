// mandate-sources — the door from a PAUSED mandate or a HOLD to what tripped
// it or what is held (show-dont-tell-audit.md, finding 15: "SEE IT →"). The
// records already carry their source: a pause names the post that tripped it
// (`pause.ref.queueId`) or the CMO's own lane (`pause.ref.laneId`: its own
// words or acts, in its chat); a hold names the chat that read the hostile
// text (`sessionId`), and the posts named in it (`postIds`: a reply staged to
// one of them is what waits).
//
// A door is the desk's door contract (frontend RelinkShell/doors/): `{kind,
// …where}`. THIS HOUSE ONLY: a queue door is offered only for an entry of the
// house's own queue (`entries` is houseEntries(house)), and a chat door only
// for the lane the house's own record names. No source on record, no door —
// never a guess.
//
// Pure.

/** A queue entry of this house, as the door to its card; null when it is not this house's. */
const queueDoor = (entries, id) => {
  const entry = id ? (entries || []).find((e) => e.id === id) : null;
  return entry ? Object.freeze({ kind: 'queue', channelId: entry.channelId, entryId: entry.id }) : null;
};

/**
 * What tripped a paused mandate, as a door. Pure.
 * @param {?object} mandate - the house's current mandate
 * @param {object[]} entries - the house's own queue
 * @returns {?{kind: string}}
 */
export const pauseSource = (mandate, entries) => {
  const ref = mandate?.status === 'paused' ? mandate.pause?.ref : null;
  if (!ref) return null;
  if (ref.queueId) return queueDoor(entries, ref.queueId);
  // The lane's own words or acts tripped it: they are in its chat (the seat's own lane, nothing else).
  if (ref.laneId && ref.laneId === mandate.laneId) return Object.freeze({ kind: 'chat', neumaId: ref.laneId });
  return null;
};

/**
 * What a hold keeps waiting, as a door: the chat that read the text, else a
 * reply staged to a post the text named. Pure.
 * @param {?object} hold
 * @param {object[]} entries - the house's own queue
 * @returns {?{kind: string}}
 */
export const holdSource = (hold, entries) => {
  if (!hold?.laneId) return null;
  if (hold.sessionId) return Object.freeze({ kind: 'chat', neumaId: hold.laneId, sessionId: hold.sessionId });
  const named = new Set(hold.postIds || []);
  const reply = (entries || []).find((e) => e.kind === 'reply' && e.status === 'draft' && named.has(String(e.reply?.toPostId)));
  return reply ? queueDoor(entries, reply.id) : null;
};
