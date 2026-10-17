// council-store.js — the witness's OWN record of every council.
//
// The sovereign truth of a council lives in each member's encrypted lane
// (their session file, written from their seat). This store is the witness's
// readable copy in their user realm — the same doctrine as chats: a
// filesystem location the witness controls and can prove is local.
//
//   <realm>/<wallet>/councils/<councilId>.jsonl
//
// Line one is the meta record (members, witnessName, created); every line
// after is one utterance. Append-only. A dissolved council is a CLOSED
// sitting, not a deleted one — this file is why it can be reopened and
// picked up like any other conversation.
//
// Best-effort boundary, stated plainly: if the meta line failed to write
// at convening (realm unwritable at that moment), later turns may still
// append here — a meta-less record is skipped from the shelf and cannot
// be reopened, though every member's own lane still holds the sitting.

import fs from 'fs/promises';
import path from 'path';
import { walletDir } from './user-realm.js';
import { createLogger } from './logger.js';

const log = createLogger('CouncilStore');

const COUNCIL_ID_RE = /^council-\d+$/;

const councilsDir = (wallet) => path.join(walletDir(wallet), 'councils');

const councilPath = (wallet, councilId) => {
  if (!COUNCIL_ID_RE.test(String(councilId))) {
    throw new Error(`malformed council id: ${councilId}`);
  }
  return path.join(councilsDir(wallet), `${councilId}.jsonl`);
};

/** Open a new council's record with its meta line. */
// impure
export const createCouncilRecord = async (wallet, { councilId, members, witnessName }) => {
  const p = councilPath(wallet, councilId);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.appendFile(
    p,
    `${JSON.stringify({ kind: 'meta', councilId, members, witnessName, createdAt: new Date().toISOString() })}\n`,
  );
};

/** One utterance enters the witness's record. `undelivered` marks words the
 *  floor never reached (CQ-029 #193) — kept in the record, never replayed. */
// impure
export const appendCouncilTurn = async (wallet, councilId, { speaker, name, content, undelivered = false }) => {
  await fs.appendFile(
    councilPath(wallet, councilId),
    `${JSON.stringify({ speaker, name, content, ...(undelivered ? { undelivered: true } : {}), at: new Date().toISOString() })}\n`,
  );
};

/** Read one council back: its meta and every utterance (tail-limited). */
// impure
export const readCouncilRecord = async (wallet, councilId, { limit = 500 } = {}) => {
  let raw;
  try {
    raw = await fs.readFile(councilPath(wallet, councilId), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  const lines = raw.split('\n').filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
  const meta = lines.find((l) => l.kind === 'meta') ?? null;
  if (!meta) return null;
  const turns = lines.filter((l) => l.kind !== 'meta').slice(-limit);
  return { meta, turns };
};

/** Every council this wallet has sat, newest last activity first. */
// impure
export const listCouncilRecords = async (wallet) => {
  let files;
  try {
    files = await fs.readdir(councilsDir(wallet));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const councils = [];
  for (const f of files) {
    if (!f.endsWith('.jsonl')) continue;
    const councilId = f.slice(0, -'.jsonl'.length);
    if (!COUNCIL_ID_RE.test(councilId)) continue;
    try {
      const record = await readCouncilRecord(wallet, councilId, { limit: 1 });
      if (!record) continue;
      const stat = await fs.stat(councilPath(wallet, councilId));
      councils.push({
        councilId,
        members: record.meta.members,
        witnessName: record.meta.witnessName,
        createdAt: record.meta.createdAt,
        lastAt: stat.mtime.toISOString(),
      });
    } catch (err) {
      // One unreadable record must not hide the shelf — log and move on.
      log.warn('council record unreadable — skipped from the list', { councilId, error: err.message });
    }
  }
  return councils.sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
};
