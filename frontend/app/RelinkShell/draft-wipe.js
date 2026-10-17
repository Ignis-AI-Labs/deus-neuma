// draft-wipe — pure decisions for the composer's Escape ladder (Founder's law,
// 2026-07-23): consecutive Escape presses inside the tap window climb one
// ladder of escalating command, the same counts everywhere —
//   2 presses  →  clear the draft ([…])
//   3 presses  →  INTERRUPT (cut the current speaker)
//   4 presses  →  THE GAVEL (the full conscious call to order — stops
//                 everyone, even the considering)
// A press landing after the window starts a new chain at 1. Climbing PAST
// the wipe un-wipes: a witness heading for the interrupt or the gavel is
// not asking to lose the words they were preparing — the draft flashes
// clear at 2 and stands again from 3 on. Pure timing/counting law — the
// component owns state, DOM, and the callbacks each rung fires.

// Two Escapes landing within this window read as consecutive rungs.
export const ESC_DOUBLE_TAP_MS = 400;

// The shared timing law: does this tap continue the chain?
export const escSecondTap = (now, lastTapAt) =>
  lastTapAt != null && now - lastTapAt < ESC_DOUBLE_TAP_MS;

// The ladder: this tap's rung, given the previous tap and its rung.
export const escTapChain = (now, lastTapAt, chain) =>
  (escSecondTap(now, lastTapAt) ? (chain || 1) + 1 : 1);

// Rung 2 wipes — only when there is a draft to wipe.
export const escWipesDraft = (now, lastTapAt, draft) =>
  escSecondTap(now, lastTapAt) && Boolean(draft);
