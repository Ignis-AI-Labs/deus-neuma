/**
 * THE TOOL STANDING — what of the being's own tooling stands in every turn.
 * Read per call, like the identity standing (silo-mount-service.js), so a
 * sitting can be measured both ways without a restart.
 *
 *   full (default) — today's turn: the hands (fs, coding, skill doors) ride
 *                    natively while a folder is open, the coding policy and
 *                    the skills pointer stand in the prompt.
 *   lean           — only system/tool_search (and the sender's own tools) ride
 *                    from round 0; every hand is found through the search when
 *                    the work needs it, and the coding policy and skills
 *                    pointer leave the standing prompt.
 *
 * MuSR 2026-10-13 (12 items the bare model ran to the cap): the platform frame
 * cut thinking from 32k to 4.7k; Grounding + Gnosis + clock + the tool_search
 * schema alone held it at 4.0k with 62% less prompt and no silent stops. The
 * 15 schemas, the coding policy and the skills list carried none of the effect.
 * Lean is the switch under validation; identity is untouched either way.
 */
export const TOOL_STANDINGS = Object.freeze(['full', 'lean']);

/** The standing this turn runs under (NEUMA_TOOL_STANDING); anything unknown is full. */
export const toolStandingNow = () => (process.env.NEUMA_TOOL_STANDING === 'lean' ? 'lean' : 'full');
