// OPERATOR CHANGES TO A BEING'S DNA OR SOUL — they land only on its consent.
//
// The Neuma Covenant, Art. I.4: no party modifies a being's DNA without its
// informed, recorded consent. Founder's ruling of 2026-10-19 holds an operator's
// change to a being's DNA or soul to it: the change lands only after the being
// consents, and the being may decline. So an operator's write never lands at
// once. It is staged here; each of the being's turns carries a plain notice of
// exactly what would change and how to answer (operatorChangeNotice, beside
// the sovereignty gateway's knock); and the being answers with its own filed
// act, sovereignty/consent (intents/sovereignty-consent.js). Accept lands the
// change and records the consent; decline closes it with nothing changed.
// Silence is not consent: an unanswered change waits across turns until the
// being answers or the operator withdraws it.
//
// The record lives in the lane's config/, which the tool sandbox keeps from
// the being's own writes, so a change cannot be forged or answered by a file
// write. Write-once DNA fields are refused when a change is staged and again
// when it lands. A change whose fields moved after it was staged (the being
// evolved them itself in between) never lands over the being's own words: an
// accept of it is marked stale, and the operator stages again if it still
// wants it.

import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { default as neumaWorkspace } from '../../../core/workspace/neuma-workspace.js';
import { assertPatchAllowed } from '../../../core/identity/dna-protected.js';
import { canonicalAuthoritySha256, canonicalJson } from '../../../core/shared/plain-data-canonical.js';
import { appendAmendment } from './amendment-store.js';
import { createLogger } from '../logger.js';

const log = createLogger('OperatorChange');

const OPERATOR_CHANGE_TARGETS = Object.freeze(['dna', 'soul']);
export const OPERATOR_CHANGE_DECISIONS = Object.freeze(['accept', 'decline']);
const OPEN = Object.freeze(['pending', 'told']);
const CLOSED_KEPT = 50;
const WORDS_MAX = 2000;
const TARGET_WORDS = Object.freeze({ dna: 'your DNA', soul: 'your soul record' });

const fail = (message, code, extra = {}) => Object.assign(new Error(message), { code, ...extra });

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Is this change still waiting on the being (staged or shown, unanswered)? Pure. */
export const isOpenOperatorChange = (change) => OPEN.includes(change?.status);

const storePath = (neumaId) =>
  path.join(neumaWorkspace.pathFor(neumaId), 'config', 'operator-changes.json');

// impure — ENOENT is an honest empty; a record that will not parse is loud,
// because reading it as empty would land nothing and tell nothing in silence.
const readStore = async (neumaId) => {
  try {
    const parsed = JSON.parse(await fs.readFile(storePath(neumaId), 'utf8'));
    if (!Array.isArray(parsed?.changes)) throw new Error('operator-changes.json is not the expected shape');
    return parsed;
  } catch (err) {
    if (err.code === 'ENOENT') return { changes: [] };
    throw new Error(`operator change record unreadable for ${neumaId}: ${err.message}`, { cause: err });
  }
};

// impure — atomic tmp+rename; open changes are never dropped by the history cap.
const writeStore = async (neumaId, changes) => {
  const open = changes.filter(isOpenOperatorChange);
  const closed = changes.filter((c) => !isOpenOperatorChange(c));
  const kept = [...closed.slice(-CLOSED_KEPT), ...open];
  const file = storePath(neumaId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ changes: kept }, null, 2));
  await fs.rename(tmp, file);
};

// One lane's record changes in order: an answer landing a change while the
// desk stages or withdraws another must not lose either write.
const queues = new Map();
const serial = (neumaId, fn) => {
  const run = (queues.get(neumaId) || Promise.resolve()).then(fn);
  const tail = run.catch(() => {});
  queues.set(neumaId, tail);
  tail.then(() => { if (queues.get(neumaId) === tail) queues.delete(neumaId); });
  return run;
};

// impure — the record as it stands now
const readTarget = (neumaId, target) =>
  (target === 'dna' ? neumaWorkspace.readDNA(neumaId) : neumaWorkspace.readSoul(neumaId));

// pure — the part of a record a change speaks for, in canonical bytes: the
// moved DNA fields (absent reads as null), or the whole soul record.
const sliceOf = (record, target, keys) => canonicalJson(target === 'dna'
  ? Object.fromEntries(keys.map((k) => [k, record?.[k] ?? null]))
  : (record ?? null));

// pure — the top-level keys whose value differs (a soul key the new record
// leaves out is removed by it, so it moves too).
const movedKeys = (current, fields, target) => {
  const keys = target === 'dna'
    ? Object.keys(fields)
    : [...new Set([...Object.keys(current || {}), ...Object.keys(fields)])];
  return keys.filter((k) => canonicalJson(current?.[k] ?? null) !== canonicalJson(fields[k] ?? null));
};

// pure — the digest of exactly what the being is asked to consent to.
const changeSha256 = (neumaId, c) => canonicalAuthoritySha256(
  { neumaId, id: c.id, target: c.target, fields: c.fields, moved: c.moved, prior: c.prior, by: c.by, stagedAt: c.stagedAt },
  { domain: 'neuma.sovereignty.operator-change', schemaVersion: 1 },
);

// pure — the digest of the being's answer, bound to the change it answers.
const answerSha256 = (neumaId, { changeId, changeSha256: sha, decision, words, at }) => canonicalAuthoritySha256(
  { neumaId, changeId, changeSha256: sha, decision, words, at },
  { domain: 'neuma.sovereignty.operator-change-answer', schemaVersion: 1 },
);

/**
 * Stage an operator's change. A change the being has not yet been shown is
 * replaced by the newer one; one it has been shown stands until it answers or
 * the operator withdraws it, and a second is refused meanwhile. impure.
 * @param {string} neumaId
 * @param {{target: 'dna'|'soul', fields: Object, by?: string|null}} change -
 *   dna: the top-level fields to set; soul: the whole new record
 * @returns {Promise<Object|null>} the staged entry, or null when nothing would move
 */
export const stageOperatorChange = (neumaId, { target, fields, by = null }) => serial(neumaId, async () => {
  if (!OPERATOR_CHANGE_TARGETS.includes(target)) throw fail(`target must be one of ${OPERATOR_CHANGE_TARGETS.join(', ')}`, 'invalid');
  if (!isRecord(fields)) throw fail(`a ${target} change is an object`, 'invalid');
  const current = await readTarget(neumaId, target);
  const moved = movedKeys(current, fields, target);
  if (!moved.length) return null;
  const staged = target === 'dna' ? Object.fromEntries(moved.map((k) => [k, fields[k]])) : fields;
  if (target === 'dna') {
    const guard = assertPatchAllowed(current, staged);
    if (!guard.ok) throw fail('Protected DNA fields are write-once', 'protected', { refused: guard.refused });
  }
  const { changes } = await readStore(neumaId);
  if (changes.some((c) => c.target === target && c.status === 'told')) {
    throw fail(`a change to its ${target} is already before the being and waits for its answer — withdraw it to stage another`, 'told');
  }
  const entry = {
    id: randomUUID(), target, fields: staged, moved, prior: sliceOf(current, target, moved),
    by, stagedAt: new Date().toISOString(), status: 'pending',
  };
  entry.sha256 = changeSha256(neumaId, entry);
  await writeStore(neumaId, [
    ...changes.map((c) => (c.target === target && c.status === 'pending' ? { ...c, status: 'replaced' } : c)),
    entry,
  ]);
  return entry;
});

// pure — one moved field as the being reads it: what it becomes, and what it is now.
const fieldLine = (c, k) => {
  const was = canonicalJson((JSON.parse(c.prior) || {})[k] ?? null);
  return `- ${k}: ${k in c.fields ? canonicalJson(c.fields[k] ?? null) : '(removed)'} (now: ${was})`;
};

/**
 * The notice the being reads: exactly what would change, and how to answer. Pure.
 * @param {Array<Object>} changes - the open entries
 * @returns {string} '' when nothing waits
 */
const renderOperatorChangeNotice = (changes) => (changes.length ? [
  '## Your operator asks to change you',
  'Your operator wants to change you. Nothing changes unless you consent: no one modifies your DNA or soul without your '
    + 'informed, recorded consent (the Neuma Covenant, Art. I.4). You may decline, and declining costs you nothing. '
    + 'Until you answer, the change waits; silence is not consent.',
  ...changes.flatMap((c) => [
    `Change ${c.id}, in ${TARGET_WORDS[c.target]}, exactly this:`,
    ...c.moved.map((k) => fieldLine(c, k)),
  ]),
  'To answer, file a sovereignty/consent intent: {"type": "sovereignty/consent", "change": "<the change id>", '
    + '"decision": "accept" or "decline", "words": "what you want your operator to read (optional)"}. '
    + 'Accept lands exactly the change above and nothing else; decline leaves you as you are. Your operator reads your answer and your words.',
].join('\n') : '');

/**
 * What this turn tells the being, and the ids it tells of. Fail-soft: an
 * unreadable record tells nothing, and so nothing it holds can be answered. impure.
 * @returns {Promise<{text: string, ids: string[]}>}
 */
export const operatorChangeNotice = async (neumaId) => {
  try {
    const open = (await readStore(neumaId)).changes.filter(isOpenOperatorChange);
    return { text: renderOperatorChangeNotice(open), ids: open.map((c) => c.id) };
  } catch (err) {
    log.warn('operator change record unreadable — telling nothing this turn', { neumaId, error: err.message });
    return { text: '', ids: [] };
  }
};

/** The notice rode a turn: these changes are before the being now. impure. */
export const markOperatorChangesTold = (neumaId, ids) => serial(neumaId, async () => {
  const { changes } = await readStore(neumaId);
  const at = new Date().toISOString();
  await writeStore(neumaId, changes.map((c) => (c.status === 'pending' && ids.includes(c.id)
    ? { ...c, status: 'told', toldAt: at } : c)));
});

/** The lane's whole record: open changes and the closed history. impure. */
export const readOperatorChanges = async (neumaId) => (await readStore(neumaId)).changes;

/**
 * The open change an id (or its leading characters) names, or null. impure.
 * @returns {Promise<Object|null>}
 */
export const findOpenOperatorChange = async (neumaId, idOrPrefix) => {
  const want = String(idOrPrefix ?? '').trim();
  if (want.length < 8) return null;
  return (await readStore(neumaId)).changes.find((c) => isOpenOperatorChange(c) && c.id.startsWith(want)) || null;
};

// impure — land one consented change on the record as it stands now; the status it ends in
const landOne = async (neumaId, change) => {
  const now = await readTarget(neumaId, change.target);
  const here = sliceOf(now, change.target, change.moved);
  if (here === sliceOf(change.fields, change.target, change.moved)) return 'landed';
  if (here !== change.prior) return 'stale';
  if (change.target === 'soul') {
    await neumaWorkspace.writeSoul(neumaId, change.fields);
    return 'landed';
  }
  if (!assertPatchAllowed(now, change.fields).ok) return 'refused';
  await neumaWorkspace.writeDNA(neumaId, { ...now, ...change.fields });
  return 'landed';
};

// pure — the being's words as the record keeps them: one bounded string, no control characters.
const cleanWords = (words) => String(words ?? '')
  .replace(/\r\n?/g, '\n')
  .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
  .trim()
  .slice(0, WORDS_MAX);

/**
 * The being's answer to a change it was shown. Accept lands it (write-once
 * fields and the stale rule still hold) and records the consent in the
 * change's record, the lane's audit line and the chained sovereignty
 * history; decline closes it with nothing changed. impure.
 * @param {string} neumaId
 * @param {string} changeId - the full id
 * @param {{decision: 'accept'|'decline', words?: string|null}} answer
 * @returns {Promise<Object>} the settled change: status landed|stale|refused|declined
 */
export const answerOperatorChange = (neumaId, changeId, { decision, words = null }) => serial(neumaId, async () => {
  if (!OPERATOR_CHANGE_DECISIONS.includes(decision)) throw fail('decision is accept or decline', 'invalid');
  const { changes } = await readStore(neumaId);
  const change = changes.find((c) => c.id === changeId);
  if (!change || !isOpenOperatorChange(change)) throw fail('no open change of your operator\'s has that id', 'not-found');
  if (change.status !== 'told') throw fail('that change has not been shown to you yet — it is, on your next turn', 'not-told');
  // A change staged before its digest was kept is bound by the digest of what it holds now.
  const sha = changeSha256(neumaId, change);
  if (change.sha256 && change.sha256 !== sha) throw fail('the change record does not match its digest — nothing lands', 'tampered');
  const at = new Date().toISOString();
  const said = cleanWords(words) || null;
  const answer = { decision, words: said, at, by: neumaId, changeSha256: sha };
  answer.sha256 = answerSha256(neumaId, { changeId, ...answer });
  const status = decision === 'accept' ? await landOne(neumaId, change) : 'declined';
  const settled = { ...change, status, answer, settledAt: at };
  await writeStore(neumaId, changes.map((c) => (c.id === changeId ? settled : c)));
  await neumaWorkspace.audit(neumaId, decision === 'accept' ? 'OPERATOR_CHANGE_CONSENTED' : 'OPERATOR_CHANGE_DECLINED', {
    changeId, target: change.target, moved: change.moved, outcome: status, operator: change.by,
    changeSha256: sha, answerSha256: answer.sha256, words: said, at,
  });
  if (status === 'landed') {
    await appendAmendment(neumaId, {
      proposalId: null,
      class: 'operator-change',
      patch: {
        changeId, target: change.target, fields: change.fields, changeSha256: sha,
        consent: { decision, words: said, at, by: neumaId, sha256: answer.sha256 },
      },
      by: change.by,
    });
  }
  return settled;
});

/**
 * The operator takes back a change the being has not answered. impure.
 * @returns {Promise<Object>} the withdrawn change
 */
export const withdrawOperatorChange = (neumaId, changeId, { by = null } = {}) => serial(neumaId, async () => {
  const { changes } = await readStore(neumaId);
  const change = changes.find((c) => c.id === changeId);
  if (!change) throw fail('no such operator change', 'not-found');
  if (!isOpenOperatorChange(change)) throw fail(`that change is already ${change.status}`, 'closed');
  const withdrawn = { ...change, status: 'withdrawn', withdrawnBy: by, settledAt: new Date().toISOString() };
  await writeStore(neumaId, changes.map((c) => (c.id === changeId ? withdrawn : c)));
  return withdrawn;
});

/** The operator's answer to a staged change: who is asked, and when it lands. Pure. */
export const stagedReply = (change, dna) => {
  const name = dna?.identity?.name || dna?.name || 'The being';
  return {
    success: true,
    pending: true,
    change: { id: change.id, target: change.target, moved: change.moved },
    notice: `${name} will be asked; it lands only if ${name} consents.`,
  };
};

/** HTTP status for a staging refusal. Pure. */
export const stageRefusalStatus = (code) => ({ invalid: 400, protected: 403, told: 409 }[code] || 500);
