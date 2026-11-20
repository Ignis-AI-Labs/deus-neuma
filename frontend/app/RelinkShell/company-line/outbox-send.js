// outbox-send.js — a batch of staged emails sent ONE AFTER ANOTHER (Design note, 2026-11-19: […]). Each email is its own send; after every change the caller is told where the batch stands (outbox-view.js
// sendingView words it), so the screen moves as the emails go, not once at the end. STOP ends it after the email in
// flight; the ones not reached stay in the outbox, unsent. impure — `send` is the network.

/**
 * @param {{ids: string[], send: (ids: string[]) => Promise<{sent?: object[], refused?: {reason: string}[]}>,
 *   onStep?: (state: object) => void, stopped?: () => boolean}} batch
 * @returns {Promise<{ids: string[], results: Object<string, {state: 'sent'|'refused', reason?: string}>, current: null, done: true, stopped: boolean}>}
 */
export const runSendBatch = async ({ ids, send, onStep = () => {}, stopped = () => false }) => {
  let state = { ids, results: {}, current: null, done: false, stopped: false };
  onStep(state);
  for (const id of ids) {
    if (stopped()) break;
    state = { ...state, current: id };
    onStep(state);
    let got;
    try {
      const r = await send([id]);
      got = r?.sent?.length ? { state: 'sent' } : { state: 'refused', reason: r?.refused?.[0]?.reason ?? 'it was not sent' };
    } catch (e) {
      got = { state: 'refused', reason: e.message };
    }
    state = { ...state, current: null, results: { ...state.results, [id]: got } };
    onStep(state);
  }
  state = { ...state, done: true, stopped: ids.some((id) => !state.results[id]) };
  onStep(state);
  return state;
};
