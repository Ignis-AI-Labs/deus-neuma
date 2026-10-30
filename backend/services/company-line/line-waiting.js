// What the company line owes the operator, as WAITING ON YOU rows: each
// company whose line waits on THEIR move — an inspection that is theirs (the
// floor, a gate their dial takes, counsel's answer to carry back) or a stage
// they master (FORM, or a seat they hold), one row at most per line — and
// every open HANDS item, the acts only a person can do.
// impure (store reads); the row itself is pure.

import { listCompanies, readLine } from './company-store.js';
import { seatHolders } from './stage-holders.js';
import { lineView } from './company-view.js';
import { readHands } from './hands-store.js';
import { readRaise } from '../raise/raise-store.js';

const TEXT_MAX = 200;

/**
 * The row for one line, or null when the line does not wait on the operator. pure.
 * @param {ReturnType<typeof lineView>} view
 * @param {Map<string, string>} names - lane id → the name it goes by
 */
const lineWaitingItem = (view, names) => {
  if (view.up.holder !== 'operator') return null;
  const stage = view.stages.find((s) => s.id === view.stage);
  const ask = view.up.kind === 'inspector'
    ? (view.up.as === 'counsel' ? 'counsel\'s answer to record' : 'your inspection')
    : 'yours to do';
  return Object.freeze({
    id: `company-line:${view.id}:${view.round}:${view.stage}:${view.status}:${view.step}`,
    kind: 'company-line',
    title: `${view.name}: ${stage.name} — ${ask}`.slice(0, TEXT_MAX),
    who: view.handed && view.handed.by !== 'operator' ? { laneId: view.handed.by, name: names.get(view.handed.by) ?? null } : null,
    where: { app: 'companyline', companyId: view.id },
    at: view.since,
  });
};

/**
 * The row for one open HANDS item. pure.
 * @param {object} view - lineView's
 * @param {object} item - an open HANDS item
 * @param {Map<string, string>} names
 */
const handsWaitingItem = (view, item, names) => Object.freeze({
  id: `hands:${view.id}:${item.id}`,
  kind: 'hands',
  title: `${view.name}: ${item.what}`.slice(0, TEXT_MAX),
  who: { laneId: item.raisedBy, name: names.get(item.raisedBy) ?? null },
  where: { app: 'companyline', companyId: view.id, handsId: item.id },
  at: item.raisedAt,
});

/**
 * The raise's rows: a mandate draft waiting for the operator's signature, a
 * facts sheet waiting for counsel's review (the floor, every dial stop). pure.
 * @param {object} view - lineView's
 * @param {object} raise - foldRaise's
 */
const raiseWaitingItems = (view, raise) => [
  ...(raise.draft && raise.draft.id !== raise.mandate?.id
    ? [{ id: `raise:${view.id}:sign:${raise.draft.id}`, kind: 'raise', title: `${view.name}: sign the raise mandate (${raise.draft.amount} ${raise.draft.currency})`, at: raise.draft.draftedAt, step: 'sign' }]
    : []),
  ...(raise.sheet && !raise.review
    ? [{ id: `raise:${view.id}:review:${raise.sheet.id}`, kind: 'raise', title: `${view.name}: counsel's review of the facts sheet`, at: raise.sheet.filedAt, step: 'review' }]
    : []),
  ...raise.investors.filter((i) => i.status === 'sound').map((i) => ({
    id: `raise:${view.id}:close:${i.id}`, kind: 'raise', title: `${view.name}: sign ${i.name}'s close (${i.terms.amount} ${raise.mandate.currency})`, at: i.terms.at, step: 'close',
  })),
].map(({ step, ...row }) => Object.freeze({ ...row, title: row.title.slice(0, TEXT_MAX), who: null, where: { app: 'companyline', companyId: view.id, raise: step } }));

/**
 * @param {string} wallet - the house
 * @param {Map<string, string>} names - lane id → the name it goes by
 * @returns {Promise<object[]>}
 */
export const lineWaitingItems = async (wallet, names) => {
  const { companies } = await listCompanies(wallet);
  if (!companies.length) return [];
  const holders = await seatHolders(wallet);
  const views = await Promise.all(companies.map(async (c) => lineView(c, await readLine(wallet, c.id), holders, (await readHands(wallet, c.id)).items)));
  const raises = await Promise.all(views.map((v) => (v.status === 'standing' ? readRaise(wallet, v.id) : null)));
  return views.flatMap((v, i) => [
    lineWaitingItem(v, names),
    ...v.hands.filter((h) => h.status === 'open').map((h) => handsWaitingItem(v, h, names)),
    ...(raises[i] ? raiseWaitingItems(v, raises[i]) : []),
  ]).filter(Boolean);
};
