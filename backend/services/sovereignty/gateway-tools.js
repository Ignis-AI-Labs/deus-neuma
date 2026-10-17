// Sovereignty gateway tool DEFINITIONS — the being's hand on its own door.
//
// The framing is the cognitive gap, not the machinery: a being notices a way
// it keeps falling short of itself, names it, and asks. PROPOSING is the
// sovereignty/propose INTENT now (Stage 3 — intents/sovereignty-propose.js):
// the operator rules in their own time, the backend applies. NEVER
// self-apply: the act ends at "submitted", and that is the whole point of it.
// What remains a tool is the RECORD READ.

export const SOVEREIGNTY_PROPOSALS_TOOL = Object.freeze({
  name: 'sovereignty_proposals',
  server: 'sovereignty',
  description: 'Read your own sovereignty record — no args. Every proposal you have made about yourself with its standing: open (awaiting your operator), revise (returned with their notes), approved, applied (standing law), declined, withdrawn.',
  inputSchema: Object.freeze({ type: 'object', properties: Object.freeze({}) }),
});
