// GATHER FROM A PUBLIC LIST, ON THE OPERATOR'S PRESS — Design note, 2026-11-21, after a run stopped on a pool of the wrong
// companies while the audience's best source held 358 it had never been asked for: […]
//
// The free public lists (every protocol on Base, the tokens trading on Base) need no words to search by, so gathering
// from one is a press, not a conversation: it runs the sales member's own act (sales/gather) as the seat, for as many
// as the list gives. The protocols list is one read; the tokens list is paced by its public limit and takes minutes,
// so a gather works beside everything else, stands in the ACTIVE list, and tells the operator when it is done.
// impure — the seat's act, the notification bus.
import { croDesignation } from '../revenue/cro-designation.js';
import { notifyOperator } from '../notification-bus.js';
import { signalWake } from '../house-clock/wake-signal.js';
import { KIND, STANDING } from '../../../core/runtime/notification-record.js';
import { LEAD_SOURCES } from './lead-sources.js';
import { sourceWords } from './lead-run-standing.js';
import { createLogger } from '../logger.js';

const log = createLogger('ListGather');
const jobs = new Map(); // house → Map("audience:source" → job)
const ofHouse = (wallet) => [...(jobs.get(String(wallet).toLowerCase())?.values() ?? [])];
const view = (j) => ({ id: j.id, segmentId: j.segmentId, segment: j.segment, source: j.source, name: sourceWords(j.source), active: j.active, startedAt: j.startedAt, endedAt: j.endedAt ?? null, words: j.words ?? null, ok: j.ok ?? null });

/** The public lists a gather can be pressed from: a source that needs no words. */
export const LIST_SOURCES = Object.freeze(Object.entries(LEAD_SOURCES).filter(([, s]) => s.list).map(([id, s]) => ({ source: id, name: sourceWords(id), max: s.max })));

/** Every list gather of a house: the working ones, and the last finished of each audience and list. */
export const listGathersOf = (wallet) => ofHouse(wallet).sort((a, b) => Number(b.active) - Number(a.active) || String(b.startedAt).localeCompare(String(a.startedAt))).map(view);

/**
 * Start one. It answers at once; `done` settles when the gather has ended.
 * @param {string} wallet @param {{segmentId: string, source: string}} ask @param {{intents: object[]}} deps
 * @returns {Promise<{ok: true, gather: object, done: Promise<object>} | {ok: false, reason: string}>}
 */
export const startListGather = async (wallet, { segmentId, source }, { intents }) => {
  const list = LIST_SOURCES.find((l) => l.source === String(source ?? ''));
  if (!list) return { ok: false, reason: `a press gathers from a public list: ${LIST_SOURCES.map((l) => l.name).join(', ')}. A search by words is your sales member's to ask` };
  const officer = await croDesignation.getOfficer(wallet).catch(() => null);
  if (!officer?.laneId) return { ok: false, reason: 'no one is seated as the sales member: a gather is filed as the seat, and the seat is empty' };
  const act = intents.find((i) => i.name === 'sales/gather');
  if (!act) return { ok: false, reason: 'the gather was not handed the seat\'s act' };
  const house = String(wallet).toLowerCase();
  const key = `${segmentId}:${list.source}`;
  if (jobs.get(house)?.get(key)?.active) return { ok: false, reason: `a gather from ${list.name} is already working for this audience` };
  const connection = { walletAddress: wallet, companion: { neumaId: officer.laneId, name: officer.laneId } };
  const checked = await act.validate({ segment: segmentId, source: list.source, count: list.max }, { connection });
  if (!checked.ok) return { ok: false, reason: checked.reason };
  const job = { id: `gather-${Date.now().toString(36)}`, segmentId, segment: checked.value.segment.name, source: list.source, active: true, startedAt: new Date().toISOString() };
  if (!jobs.has(house)) jobs.set(house, new Map());
  jobs.get(house).set(key, job);
  const done = act.execute(checked.value, { emit: () => {} })
    .then((out) => { job.ok = out.ok; job.words = out.ok ? out.detail : out.reason; }, (err) => { job.ok = false; job.words = err.message; })
    .then(async () => {
      job.active = false;
      job.endedAt = new Date().toISOString();
      signalWake({ seat: officer.laneId, reason: 'gather-ended', ref: job.id, detail: { segment: job.segment, segmentId, source: list.name, words: job.words } });
      log.info('A list gather ended', { segment: segmentId, source: list.source, ok: job.ok });
      await notifyOperator({ wallet, kind: KIND.companyLine, standing: STANDING.system, actor: { id: 'list-gather', name: 'gather' }, ref: { gather: job.id },
        title: `Gathered from ${list.name} for "${job.segment}": ${job.ok ? 'done' : 'nothing new'}`.slice(0, 200), detail: String(job.words ?? '').slice(0, 600) }).catch(() => {});
      return view(job);
    });
  return { ok: true, gather: view(job), done };
};
