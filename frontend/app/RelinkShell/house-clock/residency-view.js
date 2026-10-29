// residency-view.js — the House Clock's […] switch, in words.
// Pure. The house works only while Deus Neuma runs (the clock lives in its
// backend); residency starts the app at login (electron/residency.cjs). It is
// switched ON at the operator's first charter approval, said beside APPROVE
// before they press it — never added to login silently (ruling, 2026-10-18).

/** The line under the switch: what the house needs to keep working. */
export const RESIDENCY_LINE = 'The house wakes only while Deus Neuma runs.';

/** What the operator reads beside APPROVE when approving will switch residency on. */
export const APPROVE_WAKES_NOTE = 'Approving also starts Deus Neuma with this computer, so the house keeps waking after a restart. You can turn that off above.';

/**
 * The switch's face. Pure.
 * @param {{available: boolean, on: ?boolean}} r
 * @returns {?{label: string, on: boolean, title: string}} null where there is no desk app to start (a browser)
 */
export const residencySwitch = (r) => {
  if (!r?.available || r.on == null) return null;
  return {
    label: `WAKE WITH THIS COMPUTER: ${r.on ? 'ON' : 'OFF'}`,
    on: r.on,
    title: r.on ? 'Deus Neuma starts when you log in, so the house keeps waking. Press to stop that.' : 'Press to start Deus Neuma when you log in, so the house keeps waking after a restart.',
  };
};

/**
 * Whether approving a charter now switches residency on: the first approval
 * this desk has seen, on a desk app, not already on. Pure.
 * @param {{available: boolean, on: ?boolean, offered: boolean}} r
 * @returns {boolean}
 */
export const wakesOnApproval = (r) => Boolean(r?.available && r.on === false && !r.offered);

/**
 * What one switch of residency left: the state the switch now reads (undefined keeps what it last
 * read), the words of a failure for the head, and whether the change took. Pure.
 * @param {boolean} enabled - what was asked
 * @param {{on?: boolean, failure?: string}} answer - the desk app's answer, or why it failed
 * @returns {{on: (boolean|undefined), error: ?string, took: boolean}}
 */
export const residencyOutcome = (enabled, { on, failure } = {}) => {
  if (failure !== undefined) {
    const act = enabled ? 'set Deus Neuma to start with this computer' : 'stop Deus Neuma starting with this computer';
    return { on: undefined, error: `Could not ${act}: ${failure || 'the desk app gave no reason'}.`, took: false };
  }
  const took = on === enabled;
  const stands = enabled ? 'Deus Neuma will not start when you log in' : 'Deus Neuma still starts when you log in';
  return { on, error: took ? null : `This computer did not take the change: ${stands}.`, took };
};
