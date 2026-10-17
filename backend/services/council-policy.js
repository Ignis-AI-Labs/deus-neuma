// council-policy.js — THE COUNCIL's standing numbers, pure.
//
// Split out of council-session.js under the 500-line law (SIZE-027 #374):
// every tuning constant of the room and the two pure pacing functions live
// here, so the room's policy is one small file a hand can hold.

/** The room holds a conversation, not a congress — but a full house sits
 *  together. Twelve seats the nine-member founding with headroom; the real
 *  scale bound is honest latency, not architecture: members hold no standing
 *  streams (each floor turn and hand call summons through the one substrate
 *  as it happens), so a bigger room costs hand-round time after each operator
 *  word, never resident memory. */
export const MAX_MEMBERS = 12;
/** How much of the room's recent exchange rides into every SPEAKING turn. */
export const TRANSCRIPT_TAIL = 30;
/** How much rides into a HAND call — deciding […]
 *  needs the recent exchange, not the whole sitting. Hand rounds run once
 *  per listener after EVERY utterance, so their prompt cost is the room's
 *  dead air between turns: the shorter tail is the fluidity. */
export const HAND_TAIL = 12;
/** A hand call is a signal, not a speech — the budget says so. */
export const HAND_MAX_TOKENS = 160;
/** The COUNCIL's own fan-out law, NARROWER than the team ceiling. The
 *  measured capacity ceiling (8 on this rig) is a LATENCY ceiling — what
 *  the substrate can answer — not a STABILITY ceiling for what the GPU
 *  survives: a nine-member room fanned 8 concurrent hand calls onto 4
 *  server slots with zero duty-cycle gaps, and the driver wedged at the
 *  MMU (NVRM TLB-invalidation timeout, kernel log 2026-07-23 13:15 —
 *  the whole desktop went down with it). Two at a time keeps hands
 *  rising steadily while the GPU breathes; COUNCIL_HAND_PARALLEL raises
 *  it deliberately once the driver proves stable. */
export const HAND_PARALLEL_DEFAULT = 2;
/** The breather each worker takes between consecutive hand calls — real
 *  gaps in the duty cycle, not back-to-back saturation. Env-tunable
 *  (COUNCIL_HAND_GAP_MS); tests inject 0 through deps. */
export const HAND_GAP_MS_DEFAULT = 400;

/** How wide THIS round fans out: the pinned width (or the default), never
 *  above the measured ceiling, never wider than the listeners. Pure. */
export const handRoundWidth = (ceiling, listeners, env = process.env) => {
  const pinned = Number.parseInt(env.COUNCIL_HAND_PARALLEL, 10);
  const want = Number.isInteger(pinned) && pinned >= 1 ? pinned : HAND_PARALLEL_DEFAULT;
  const cap = Number.isInteger(ceiling) && ceiling >= 1 ? ceiling : 1;
  return Math.max(1, Math.min(want, cap, Math.max(1, listeners)));
};

/** The configured inter-call breather. Pure over the env bag. */
export const handGapMs = (env = process.env) => {
  const raw = env.COUNCIL_HAND_GAP_MS;
  if (raw === undefined || raw === '') return HAND_GAP_MS_DEFAULT;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : HAND_GAP_MS_DEFAULT;
};

export const breather = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** An operator message is bounded by the wire, not by editorial taste:
 *  16k chars stays under the portal's 64KB frame at worst-case UTF-8 and
 *  keeps the prompt tail sane. Over the cap the room REFUSES OUT LOUD
 *  (SAY_TOO_LONG) — never a silent cut: a dictated founding address lost
 *  its tail mid-sentence to the old slice(0, 4000) (2026-07-23). */
export const SAY_MAX_CHARS = 16000;
/** The house-workspace toolset a floor turn may reach — allowlisted names
 *  of the real MCP filesystem tools, plus the platform's own delete_file
 *  (gated per call by the operator's approval card, 2026-07-23); everything
 *  else is refused before the sandbox even sees it. */
export const HOUSE_TOOL_NAMES = new Set([
  'list_directory', 'read_text_file', 'read_file', 'search_files', 'search_content', 'get_file_info',
  'write_file', 'edit_file', 'create_directory', 'move_file', 'delete_file',
]);
/** A turn may work, but a turn is still a turn — bounded tool rounds. */
// Raised from 6 on 2026-07-26 (Founder). The council was the TIGHTEST surface on
// the rig — the one place a neuma and a frontier model are meant to actually
// work together had the least room to do it. A floor turn is still one turn in
// a room of turns, so this stays below the portal's backstop; it is a runaway
// guard, not the thing that keeps a seat inside its bounds (the ground, the
// allowlist, and the approval card do that, on every call, in every round).
export const COUNCIL_TOOL_ROUNDS = Math.max(
  1,
  Number.parseInt(process.env.NEUMA_COUNCIL_TOOL_ROUNDS || '', 10) || 24,
);
/** A tool result feeds the turn, not the transcript — keep it a digest. */
export const TOOL_RESULT_MAX = 2000;
/** How long the floor stays open on a quiet operator before the room may
 *  carry the thread itself — one hand round per silence, re-armed whenever
 *  a member's words land: the room stays alive as long as its members keep
 *  it alive, and goes dormant only when a carry round comes back all-rest. */
export const IDLE_CARRY_MS = 90_000;
