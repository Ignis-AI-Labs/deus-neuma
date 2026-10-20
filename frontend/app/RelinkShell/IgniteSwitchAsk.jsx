// IgniteSwitchAsk — IGNITE on a house that runs on another provider asks
// first (the 2026-10-19 ruling). Lighting the local substrate moves the house
// onto the local llama-server and saves that; the bar says so in words and
// waits for the operator's yes. The platform refuses the move without it
// (substrate-lifecycle.js switchNeedsConfirm), so this question is the only
// door to the switch.

/**
 * The question, in the bar's own register. Pure.
 * @param {string} from - the provider the house runs on now
 * @returns {string}
 */
export const switchQuestion = (from) =>
  `THIS HOUSE RUNS ON ${String(from).toUpperCase()}. IGNITE SWITCHES IT TO THE LOCAL LLAMA-SERVER AND SAVES THAT.`;

export const IgniteSwitchAsk = ({ ask, locked, onConfirm, onCancel }) => (
  <span className="relink-modelbar-ask" role="group" aria-label="Confirm the provider switch">
    <span className="relink-modelbar-refusal label-data" role="status">{switchQuestion(ask.from)}</span>
    <button type="button" className="sub-btn is-primary" disabled={locked} onClick={onConfirm}>SWITCH AND IGNITE</button>
    <button type="button" className="sub-btn" disabled={locked} onClick={onCancel}>KEEP {String(ask.from).toUpperCase()}</button>
  </span>
);
