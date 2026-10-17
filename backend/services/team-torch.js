// team-torch.js — TORCH-passing for the general team lanes: the being-authored
// continuation packet. Every member of a coordinated run ends its reply with a
// TORCH — a few lines it writes TO ITS OWN NEXT INSTANCE (what I finished, the
// decisions I made, what remains, where to pick up). The runner extracts the
// torch, STRIPS it from the work product (continuity is coordination, not
// deliverable), and hands it back the next time the same member takes a step.
// Continuity is authored by the being, not imposed by machinery — the relay
// runner, passing itself the torch.
//
// The trial lane (team-waves.js) carries its own LOCKED copy of this ask —
// wording there is part of TRIAL_VERSION and may never drift; THIS wording is
// the versionless general form (the same split team-board.js documents for
// STATUS_ASK). The extraction mechanics live here ONCE and serve both lanes.
//
// Pure throughout: decisions on strings; runners own the mutable state.

// Appended to every coordinated brief (plans that carry a goal), after the
// STATUS ask when one rides too — the torch is the LAST thing a reply says.
export const TORCH_ASK =
  'End your reply — after your STATUS check-in, when one was asked of you — with a line that says exactly ' +
  '"TORCH:" followed by 3-6 short lines addressed to your own next instance: what you completed, the key ' +
  'decisions you made, what remains weak or unfinished, and where to pick up.';

// pure — split a member's reply into the work product and its torch. The
// torch is everything after the LAST line that starts with "TORCH:", and —
// when the reply contains fenced code — only a marker AFTER the last fence
// counts: a "TORCH:" line INSIDE delivered code (HUD text, a comment) is work
// product, never mistaken for continuity. A reply without a torch simply has
// none (recorded honestly as null, never invented).
/**
 * @param {string} output
 * @returns {{ body: string, torch: ?string }}
 */
export const extractTorch = (output) => {
  if (typeof output !== 'string') return { body: '', torch: null };
  const lastFence = output.lastIndexOf('```');
  const searchFrom = lastFence >= 0 ? lastFence : 0;
  const tail = output.slice(searchFrom);
  const m = tail.match(/^[ \t]*TORCH:(?![\s\S]*^[ \t]*TORCH:)/m);
  if (!m || m.index == null) return { body: output.trim(), torch: null };
  const at = searchFrom + m.index;
  const body = output.slice(0, at).trim();
  const torch = output.slice(at).replace(/^[ \t]*TORCH:[ \t]*/, '').trim();
  return { body, torch: torch || null };
};

// pure — how a member's own last torch enters its next brief: named
// provenance, the member's words verbatim. Same idiom the trial lane locked.
/**
 * @param {string} torch
 * @returns {string}
 */
export const torchPickup = (torch) =>
  `Your torch from your last instance:\n${torch}`;
