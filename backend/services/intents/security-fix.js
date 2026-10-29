/**
 * security/file-fix — the CSO hands a confirmed threat's FIX to whoever can do
 * it: the operator, on their own task list (Design note, 2026-10-19: the CSO must be
 * […]). Most fixes
 * — rotating a key at a provider, upgrading a dependency, closing a port —
 * are the operator's hands, not a being's; the office's part is to say
 * exactly what to do and to put it where the operator will do it.
 *
 * No new task system: the act IS tasks/operator-add (task-acts.js), its own
 * field law and receipt, filed from the security office with the threat's
 * remedy and id. The seat law of the other security acts holds (the filer's
 * own house's seated CSO, re-read at validate, before any card), and the card
 * shows the task exactly as it will land. The threat keeps a history row
 * naming the filed task; its status is untouched — the fix is owed until the
 * watch verifies it (threat-lifecycle.js).
 */
import { csoDesignation } from '../security/cso-designation.js';
import { threatLedgerFor } from '../security/threat-ledger.js';
import { operatorTaskAddIntent } from './task-acts.js';

const TITLE_MAX = 180;
const DETAIL_MAX = 1000;

const invalid = (reason) => ({ ok: false, status: 'invalid', reason });

// pure — cut to a bound with an ellipsis that says so.
const bounded = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * pure — the operator task a threat's fix becomes: the remedy is the work,
 * the threat id is the link back to the ledger.
 * @param {Object} threat a ledger entry carrying a remedy
 * @returns {{title: string, detail: string}}
 */
const fixTask = (threat) => ({
  title: bounded(`Security fix ${threat.id.slice(0, 11)}: ${threat.remedy}`, TITLE_MAX),
  detail: bounded([
    `Remedy: ${threat.remedy}`,
    `Threat ${threat.id} — ${threat.severity} ${threat.externalId}${threat.repo ? ` (${threat.repo})` : ''}: ${threat.title}`,
    'When it is done, mark the threat mitigated: the next whole scan verifies the fix, or reopens the threat if it still sees it.',
  ].join('\n'), DETAIL_MAX),
});

// impure — the threat the filing names, or why it cannot be filed.
const fileable = async (wallet, id) => {
  const threat = await (await threatLedgerFor(wallet)).get(id);
  if (!threat) return { error: 'no such threat (or the id is ambiguous)' };
  if (threat.status !== 'confirmed') return { error: `only a CONFIRMED threat's fix is filed — this one is ${threat.status}` };
  if (!threat.remedy) return { error: 'this threat carries no remedy yet — the next scan writes one, or escalate it (security/escalate)' };
  return { threat };
};

export const securityFileFixIntent = Object.freeze({
  name: 'security/file-fix',
  policyTool: 'security.file-fix',
  fieldsForPrompt: '{id}',
  descriptionForPrompt: 'CSO ONLY. Hand a CONFIRMED threat\'s fix to your operator: its remedy lands on THEIR task list (tasks/operator-add), linked by the threat id. Use it for fixes only their hands can make — rotating a key, upgrading a dependency, closing a port.',
  availableFor: async ({ laneId, connection }) =>
    ((await csoDesignation.holds(connection?.walletAddress, laneId)) ? {} : null),
  validate: async (payload, { connection }) => {
    if (!(await csoDesignation.holds(connection.walletAddress, connection.companion?.neumaId))) {
      return { ok: false, status: 'denied', reason: 'security acts belong to the seated CSO alone' };
    }
    if (typeof payload?.id !== 'string' || !payload.id.trim()) return invalid('file-fix needs {id} — the threat id from security_threats_list');
    const { threat, error } = await fileable(connection.walletAddress, payload.id.trim());
    if (error) return invalid(error);
    const task = await operatorTaskAddIntent.validate(fixTask(threat), { connection });
    if (!task.ok) return task;
    return { ok: true, value: { id: threat.id, task: task.value } };
  },
  // The card shows the task exactly as it will land on the operator's list.
  cardArgs: (value) => value.task,
  summarize: (payload) => `hand the fix for threat ${String(payload?.id ?? '?').slice(0, 12)} to the operator's task list`,
  execute: async ({ id, task }, { connection }) => {
    // Re-read: the threat may have moved while the card waited.
    const { error } = await fileable(connection.walletAddress, id);
    if (error) return { ok: false, reason: error };
    const filed = await operatorTaskAddIntent.execute(task, { connection });
    if (!filed.ok) return filed;
    const by = connection.companion?.neumaId || 'cso';
    await (await threatLedgerFor(connection.walletAddress)).noteFixFiled(id, { by, title: task.title });
    return { ok: true, detail: `Filed the fix for ${id.slice(0, 11)} to your operator's task list. ${filed.detail}` };
  },
});
