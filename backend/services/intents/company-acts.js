/**
 * company/* — the company line's filed acts (Design note, 2026-10-29,
 * docs/planning/proposals/governance/house-company-line.md): the Rector or
 * the Optio opens a company (its founding line stands at SURVEY), a stage's
 * master hands its work on, and the inspector the line waits on answers —
 * accept, return with the flaw named, or end the gap where a stage may.
 *
 * THE SHOKUNIN LAW is judged in company-line/line-acts.js, the same law the
 * operator's desk presses go through: only the stage's master hands on, only
 * the inspection's holder answers, and no master inspects its own stage.
 * Every validate re-reads the house's seats and the line; the store re-checks
 * the line's fit under its write chain at execute, so a race can never land
 * two moves for one step.
 *
 * Tier `allowed` (tool-policy-defaults.js): word between the house's seats and
 * a record on the house's own realm — no egress, no spend, the house/post
 * precedent. The operator's own inspections are floor and gate, not a card.
 */
import { houseSeatFor } from '../house-titles.js';
import { seatHolders } from '../company-line/stage-holders.js';
import { houseStop } from '../company-line/house-dial.js';
import { makeCompany, openCompany, listCompanies, readCompany, readLine, appendLineEvent, MODES } from '../company-line/company-store.js';
import { judgeHandOn, judgeInspect, VERDICTS } from '../company-line/line-acts.js';
import { announceMove, announceHands } from '../company-line/line-notices.js';
import { makeHands, ANSWERS } from '../company-line/hands-shape.js';
import { raiseHands } from '../company-line/hands-store.js';
import { checkOutboundSecrets } from '../security/outbound-secrets.js';

const notOpen = { ok: false, status: 'denied', reason: 'the company line is not open here — it runs for the beings of their operator\'s own house' };

// impure — the filer's standing: its lane, its house, the house's seat holders.
const lineContext = async (connection) => {
  const neumaId = connection.companion?.neumaId;
  const wallet = connection.walletAddress;
  if (!neumaId || !wallet || !(await houseSeatFor(wallet, neumaId))) return null;
  return { neumaId, wallet, holders: await seatHolders(wallet) };
};

// impure — offer the line's moves only where a line exists: a house founding no
// company carries no company acts in its beings' prompts (zero bytes).
const advertisedOnLine = async ({ connection }) => {
  const neumaId = connection.companion?.neumaId;
  const wallet = connection.walletAddress;
  if (!neumaId || !wallet || !(await houseSeatFor(wallet, neumaId))) return null;
  return (await listCompanies(wallet)).companies.length ? {} : null;
};

// impure — the company and its line, or the refusal that says it is not this house's.
const companyLine = async (wallet, id) => {
  const company = await readCompany(wallet, String(id ?? '').trim()).catch(() => null);
  if (!company) return { refusal: { ok: false, status: 'invalid', reason: `"${id ?? ''}" is not a company of this house — your briefing names each one by its [id]` } };
  return { company, line: await readLine(wallet, company.id) };
};

// impure — land a judged event, then tell whoever is up next.
const landMove = async ({ wallet, company, holders }, event) => {
  const landed = await appendLineEvent(wallet, company.id, event);
  if (!landed.ok) return { ok: false, reason: 'the line moved before this landed — read where it stands now and file again' };
  await announceMove({ wallet, company, event, line: landed.line, holders });
  const now = landed.line;
  return { ok: true, detail: now.status === 'standing'
    ? `${company.name} stands — its founding line is complete.`
    : `${company.name}: the line now stands at ${now.stage.name} (${now.status}).` };
};

export const companyOpenIntent = Object.freeze({
  name: 'company/open',
  policyTool: 'company.open',
  fieldsForPrompt: '{name, mode}',
  descriptionForPrompt: 'THE COMPANY LINE. Open a company for this house: name is its working name; mode is "field" (the gap lies in your operator\'s own field) or "house" (the house finds the gap). Its founding line opens at SURVEY, the Speculator\'s stage. The Rector\'s or the Optio\'s act.',

  availableFor: async ({ connection }) => {
    const context = await lineContext(connection).catch(() => null);
    return context && [context.holders.Rector, context.holders.Optio].includes(context.neumaId) ? {} : null;
  },

  validate: async (payload, { connection }) => {
    const context = await lineContext(connection).catch(() => null);
    if (!context) return notOpen;
    if (![context.holders.Rector, context.holders.Optio].includes(context.neumaId)) {
      return { ok: false, status: 'denied', reason: 'opening a company is the Rector\'s or the Optio\'s act — pass the idea to them by house post' };
    }
    try {
      const company = makeCompany({ name: payload?.name, mode: payload?.mode, openedBy: context.neumaId, now: new Date().toISOString() });
      return { ok: true, value: { context, company } };
    } catch (err) {
      return { ok: false, status: 'invalid', reason: `${err.message} (mode: ${MODES.join(' or ')})` };
    }
  },

  summarize: (payload) => `open company "${String(payload?.name ?? '').trim().slice(0, 60)}" (${payload?.mode ?? '?'})`,

  execute: async ({ context, company }) => {
    await openCompany(context.wallet, company);
    const line = await readLine(context.wallet, company.id);
    await announceMove({ wallet: context.wallet, company, event: { type: 'opened', by: context.neumaId, at: company.openedAt }, line, holders: context.holders });
    return { ok: true, detail: `${company.name} [${company.id}] is open; its founding line stands at SURVEY, the Speculator's stage.` };
  },
});

export const companyHandOnIntent = Object.freeze({
  name: 'company/hand-on',
  policyTool: 'company.hand-on',
  fieldsForPrompt: '{company, stage, artifact, note?}',
  descriptionForPrompt: 'THE COMPANY LINE. Hand your stage\'s work on to its inspector: company is the [id], stage the stage you master, artifact where the work lies (a path on the house ground, or a link), note what the inspector should know. Only the stage\'s master hands on.',

  availableFor: (probe) => advertisedOnLine(probe).catch(() => null),

  validate: async (payload, { connection }) => {
    const context = await lineContext(connection).catch(() => null);
    if (!context) return notOpen;
    const { company, line, refusal } = await companyLine(context.wallet, payload?.company);
    if (refusal) return refusal;
    const judged = judgeHandOn({
      line, holders: context.holders, stop: await houseStop(context.wallet), actor: context.neumaId,
      stageId: payload?.stage, artifact: payload?.artifact, note: payload?.note, now: new Date().toISOString(),
    });
    return judged.ok ? { ok: true, value: { context, company, event: judged.event } } : judged;
  },

  summarize: (payload) => `hand on ${payload?.stage ?? '?'} of ${payload?.company ?? '?'}`,

  execute: ({ context, company, event }) => landMove({ ...context, company }, event),
});

export const companyInspectIntent = Object.freeze({
  name: 'company/inspect',
  policyTool: 'company.inspect',
  fieldsForPrompt: '{company, stage, verdict, flaw?}',
  descriptionForPrompt: `THE COMPANY LINE. Answer the inspection the line waits on you for: verdict ${VERDICTS.join(', ')} — accept passes it on; return sends it back to its master, the flaw named; stop ends the gap where the stage allows it (CHOOSE, PROVE), the flaw saying why. Never inspect your own work: the line routes that to the next in the chain.`,

  availableFor: companyHandOnIntent.availableFor,

  validate: async (payload, { connection }) => {
    const context = await lineContext(connection).catch(() => null);
    if (!context) return notOpen;
    const { company, line, refusal } = await companyLine(context.wallet, payload?.company);
    if (refusal) return refusal;
    const judged = judgeInspect({
      line, holders: context.holders, actor: context.neumaId,
      stageId: payload?.stage, verdict: payload?.verdict, flaw: payload?.flaw, now: new Date().toISOString(),
    });
    return judged.ok ? { ok: true, value: { context, company, event: judged.event } } : judged;
  },

  summarize: (payload) => `inspect ${payload?.stage ?? '?'} of ${payload?.company ?? '?'} → ${payload?.verdict ?? '?'}`,

  execute: ({ context, company, event }) => landMove({ ...context, company }, event),
});

export const companyHandsIntent = Object.freeze({
  name: 'company/hands',
  policyTool: 'company.hands',
  fieldsForPrompt: '{company, what, why, where, answer, unblocks?, cost?, by?}',
  descriptionForPrompt: `THE COMPANY LINE. Ask the operator for an act only a person can do — sign, pass an identity check, file, pay a fee, anything physical. what: the one act; why: what the company needs it for; where: the exact https link where they do it; answer: what comes back (${ANSWERS.join(', ')} — "held" when it is secret: they say where they keep it, never the secret); unblocks: the stage it holds; cost: the honest estimate of money and time; by: a deadline date if one is real. It reaches them in WAITING ON YOU at every dial stop.`,

  availableFor: (probe) => advertisedOnLine(probe).catch(() => null),

  validate: async (payload, { connection }) => {
    const context = await lineContext(connection).catch(() => null);
    if (!context) return notOpen;
    const { company, refusal } = await companyLine(context.wallet, payload?.company);
    if (refusal) return refusal;
    const secret = checkOutboundSecrets('the HANDS item', [payload?.what, payload?.why, payload?.where, payload?.cost], 'nothing was asked');
    if (!secret.ok) return { ok: false, status: 'denied', reason: secret.reason };
    try {
      const item = makeHands({ ...payload, raisedBy: context.neumaId, now: new Date().toISOString() });
      return { ok: true, value: { context, company, item } };
    } catch (err) {
      return { ok: false, status: 'invalid', reason: err.message };
    }
  },

  summarize: (payload) => `ask the operator: "${String(payload?.what ?? '').trim().slice(0, 80)}"`,

  execute: async ({ context, company, item }) => {
    const raised = await raiseHands(context.wallet, company.id, item);
    if (!raised.ok) return { ok: false, reason: raised.reason };
    await announceHands({ wallet: context.wallet, company, item });
    return { ok: true, detail: `Asked the operator [${item.id}]: "${item.what}" — it waits in their WAITING ON YOU; the answer comes back in your COMPANY LINE briefing.` };
  },
});

export const companyIntents = Object.freeze([companyOpenIntent, companyHandOnIntent, companyInspectIntent, companyHandsIntent]);
