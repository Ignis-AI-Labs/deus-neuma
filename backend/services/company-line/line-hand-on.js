// A hand-on, prepared once for both doors — the beings' company/hand-on act
// and the operator's desk — so a worksheet is judged by one law wherever it
// comes from. A stage that takes a worksheet (SURVEY to PROVE) hands on the
// worksheet itself; its artifact is the mirror the platform writes on the
// house ground, never a path the filer names.
// impure (reads the ground and the round's worksheets); the judging is pure.

import { loadHouseWorkspace } from '../house-workspace.js';
import { judgeHandOn } from './line-acts.js';
import { takesWorksheet, checkWorksheet } from './worksheets.js';
import { mirrorPath, saveWorksheet, readRoundWorksheets } from './worksheet-store.js';

const PROBLEMS_SHOWN = 8;

/**
 * Judge a hand-on: the seat law first, then the worksheet when the stage takes one.
 * @param {{wallet: string, company: object, line: object, holders: Record<string, string>, stop: string,
 *   actor: string, stageId: unknown, artifact: unknown, note: unknown, worksheet: unknown, now: string}} args
 * @returns {Promise<{ok: true, event: object, keep: ?object} | {ok: false, status: string, reason: string}>}
 */
export const prepareHandOn = async ({ wallet, company, line, holders, stop, actor, stageId, artifact, note, worksheet, now }) => {
  const sheet = Boolean(line.stage) && takesWorksheet(line.stage.id);
  const judged = judgeHandOn({
    line, holders, stop, actor, stageId, note, now,
    artifact: sheet ? mirrorPath(company.id, line.stage.id, line.round) : artifact,
  });
  if (!judged.ok || !sheet) return judged.ok ? { ...judged, keep: null } : judged;
  const { root } = await loadHouseWorkspace(wallet);
  if (!root) return { ok: false, status: 'denied', reason: 'a worksheet lands on the house ground — the operator sets the ground first (the HOUSE window)' };
  const checked = checkWorksheet(line.stage.id, worksheet, await readRoundWorksheets(wallet, company.id, line.round));
  if (!checked.ok) {
    const more = checked.problems.length - PROBLEMS_SHOWN;
    return { ok: false, status: 'invalid', reason: `the ${line.stage.name} worksheet is not ready — ${checked.problems.slice(0, PROBLEMS_SHOWN).join('; ')}${more > 0 ? `; and ${more} more` : ''}` };
  }
  return { ...judged, keep: { wallet, companyId: company.id, stage: line.stage.id, round: line.round, worksheet, groundRoot: root } };
};

/** Keep the worksheet a prepared hand-on carries, before its event lands. impure. */
export const keepWorksheet = async (prepared) => {
  if (prepared.keep) await saveWorksheet(prepared.keep);
};
