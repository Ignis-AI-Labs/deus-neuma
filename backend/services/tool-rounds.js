/**
 * tool-rounds — how long a turn may keep working. By default: as long as it needs.
 *
 * Design note, 2026-07-27, after a live research turn died at round 61 mid-investigation:
 * […]
 *
 * THE CAP WAS NEVER A SAFETY MECHANISM. It resembled one, which is worse than not
 * having one, because it absorbed attention that belongs on the controls that
 * actually protect anything. A round count cannot tell careful work from spinning:
 * a witness researching a marketing stack legitimately spends dozens of rounds
 * searching, fetching, and reading, and a runaway loop can burn the budget in
 * three. What actually holds the line fires on EVERY call regardless of round —
 * the policy cascade, the ACTS approval card, the path sandbox, the denied-path
 * list, the egress guard — plus the two real stops on a turn: the operator's
 * interrupt, and the model deciding it is done.
 *
 * Its history is the argument against it. It was 9. On 2026-07-26 a witness was
 * cut off at round 10 while ORIENTING in a repository — seven of those rounds
 * were search/list/read before it had even begun — so it was raised to 60. On
 * 2026-07-27 a research turn was cut off at 61. A number that has to be raised
 * every time real work meets it is not protecting anything; it is just the
 * ceiling you have not hit yet.
 *
 * So the default is NO CAP. `NEUMA_MAX_TOOL_ROUNDS` remains as an opt-in ceiling
 * for anyone who wants one (a shared rig, a cron lane, a budget experiment):
 * unset or 0 means unlimited, any positive integer restores a hard stop.
 *
 * Read from the environment at CALL time, not at import — so a test or a lane can
 * set a ceiling without reloading the module, and so this file has no load-order
 * coupling to whoever imports it first.
 */

/**
 * The configured ceiling, or 0 for unlimited (the default).
 * @returns {number} 0 = no cap
 */
export const toolRoundCap = () => {
  const raw = Number.parseInt(process.env.NEUMA_MAX_TOOL_ROUNDS || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
};

/**
 * May the loop run this round? Always true when uncapped — the default.
 * @param {number} round 0-based
 */
export const withinToolRounds = (round) => {
  const cap = toolRoundCap();
  return cap === 0 || round <= cap;
};

/**
 * Is this the last round a ceiling permits? ALWAYS false when uncapped, so the
 * "loop stopped" branch — and the truncated answer it produces — becomes
 * unreachable by default.
 * @param {number} round 0-based
 */
export const isFinalToolRound = (round) => {
  const cap = toolRoundCap();
  return cap > 0 && round === cap;
};
