// rite-signal.js — I · THE THRESHOLD, told to THE SUMMONING RITE. // impure
//
// The threshold's steps are the kept vanilla ceremony (WitnessCommitment,
// PreflightCheck, the witness's introduction); the rite beneath them
// (RiteCeremony.jsx) draws what they do — a binding document read, the
// covenant signed, a check of the vessel passed, the witness named — from
// these signals, on its own clock. With no rite mounted nothing is sent and
// nothing changes.
//
//   rite:threshold             the covenant is shown: the void opens behind it
//   rite:read {doc}            a binding document read to its end (its index)
//   rite:signed                the covenant accepted
//   rite:check {check}         a check of the vessel passed (its index)
//   rite:introduced {witness}  the witness's name, given

/** Is THE SUMMONING RITE beneath this ceremony? */
export const riteIsLive = () => typeof window !== 'undefined' && Boolean(window.__neumaRiteLive);

/** Tell the rite what the threshold just did. */
export const riteSignal = (type, detail = {}) => {
  if (!riteIsLive()) return;
  window.dispatchEvent(new CustomEvent('rite:signal', { detail: { ...detail, type } }));
};
