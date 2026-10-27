// mandate-preflight — the GRANT PROTOCOL's checks (ruling, 2026-10-24: […]). A mandate is a big red button: before it can be pressed, every row
// here must pass. The desk shows them; the grant route runs them again,
// because the screen is never the gate.
//
// A row that could not be measured is not a pass: it reads `null` (unknown,
// with the reason) and keeps the button disarmed, never a drawn tick.
//
// Each failing row's door lands on the exact place it is fixed (the desk's
// door contract, frontend RelinkShell/doors/; show-dont-tell-audit.md finding
// 16), never on the window it is already in: the CMO row on SEAT, an account
// on ACCOUNTS at that account's card, the grant's own account choices in
// place, the watch that did not answer, the mandate or hold that stands.
//
// Pure: facts in (mandate-preflight-facts.js reads them), rows out.

const row = (id, label, ok, words, door) => Object.freeze({ id, label, ok, words, door: ok === true ? null : door });

// A place on SEAT itself (where the grant screen stands), with its press (≤3 words).
const seatAt = (reveal, label) => Object.freeze({ kind: 'marketing', tab: 'seat', reveal, label });
const CMO_ROW = seatAt('[data-cmo-row]', 'SEAT A CMO');
const CHOOSE = seatAt('.mandate-accounts', 'CHOOSE');
const STANDING = seatAt('.mandate-head', 'MANDATE');
const HOLDS = seatAt('.mandate-holds', 'HOLDS');
const CHECK = Object.freeze({ kind: 'marketing', tab: 'accounts' });
const accountDoor = (accountId) => Object.freeze({ kind: 'marketing', tab: 'accounts', accountId });
const watchDoor = (app, reveal) => Object.freeze({ kind: 'app', app, reveal });

// pure — the in-scope accounts on the house social check.
const accountsRow = (chosen, check) => {
  const label = 'Every account is clear on the social check';
  if (!chosen.length) return row('accounts', label, false, 'Choose at least one account.', CHOOSE);
  if (!check?.ok) return row('accounts', label, null, `The social check could not run: ${check?.error || 'no answer'}.`, CHECK);
  const rows = new Map((check.report?.accounts || []).map((a) => [a.id, a]));
  const astray = chosen.map((id) => {
    const r = rows.get(id);
    if (!r) return { words: `${id} is not an account of this house` };
    if (!r.inUse) return { id, words: `${id} is not in use yet (no keys, no holder)` };
    if (r.clear) return null;
    const bad = r.checks.filter((c) => c.verdict === 'fail' || c.verdict === 'unknown').map((c) => c.label.toLowerCase());
    return { id, words: `${id}: ${bad.join(', ')}` };
  }).filter(Boolean);
  // The door opens the first of this house's accounts that is not clear, on its own card.
  const first = astray.find((a) => a.id);
  return astray.length
    ? row('accounts', label, false, astray.map((a) => a.words).join('; '), first ? accountDoor(first.id) : CHOOSE)
    : row('accounts', label, true, `${chosen.length} of ${chosen.length} clear.`, null);
};

/**
 * The grant protocol's rows, in reading order. Pure.
 * @param {{seat: ?{laneId: string, name?: ?string}, chosen: string[],
 *   check: {ok: boolean, report?: object, error?: string},
 *   security: {catches: boolean, ledger: {ok: boolean, error?: string}},
 *   legal: {ok: boolean, catches?: boolean, error?: string, needed: boolean},
 *   standing: string, openHolds: number}} facts
 *   chosen — the account ids the grant names; legal.needed — posts are in the grant
 * @returns {ReadonlyArray<{id: string, label: string, ok: ?boolean, words: string, door: ?{kind: string}}>}
 */
export const preflightRows = ({ seat, chosen, check, security, legal, standing, openHolds }) => Object.freeze([
  seat?.laneId
    ? row('seat', 'A CMO is seated', true, `${seat.name || seat.laneId} holds the seat.`, null)
    : row('seat', 'A CMO is seated', false, 'No one holds the CMO seat — seat one first.', CMO_ROW),
  accountsRow(chosen, check),
  !security.catches
    ? row('security', 'The security watch is answering', false, 'The hostile-text watch did not catch a known attack line.', watchDoor('security', '.sec-watch'))
    : security.ledger.ok
      ? row('security', 'The security watch is answering', true, 'It catches a known attack line, and the house\'s threat ledger reads.', null)
      : row('security', 'The security watch is answering', null, `It catches a known attack line, but the threat ledger could not be read: ${security.ledger.error || 'no answer'}.`, watchDoor('security', '.sec-ledger')),
  !legal.needed
    ? row('legal', 'The legal check is answering', true, 'Not needed — posts are not in this grant.', null)
    : !legal.ok
      ? row('legal', 'The legal check is answering', null, `It could not be read: ${legal.error || 'no answer'}.`, watchDoor('legal', '.sec-watch'))
      : legal.catches
        ? row('legal', 'The legal check is answering', true, 'It rates a known serious claim serious.', null)
        : row('legal', 'The legal check is answering', false, 'It did not rate a known serious claim serious.', watchDoor('legal', '.sec-watch')),
  standing === 'active' || standing === 'paused'
    ? row('settled', 'Nothing from before is unresolved', false, `A mandate already stands (${standing}) — withdraw it first.`, STANDING)
    : openHolds
      ? row('settled', 'Nothing from before is unresolved', false, `${openHolds} hostile-text hold(s) still wait on you.`, HOLDS)
      : row('settled', 'Nothing from before is unresolved', true, 'No mandate stands and nothing is held.', null),
]);

/** Is the red button armed? Only when every row passed. Pure. */
export const preflightClear = (rows) => rows.length > 0 && rows.every((r) => r.ok === true);
