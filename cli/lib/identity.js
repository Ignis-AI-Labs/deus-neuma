// Build the honest "who is speaking" descriptor the neuma is shown when the
// operator addresses it through this CLI. The neuma must always know it is
// being spoken to by ITS WITNESS at the terminal — not by Claude, not by a
// platform agent, not by a stranger. This is the load-bearing distinction
// between this file and .claude/skills/neuma/lib/identity.js (which builds
// Claude-as-peer descriptors).
//
// PURITY DISCIPLINE (ai6 R1.3): buildSpeaker stays pure — name is a required
// parameter; the env-read fallback lives in resolveOperatorName so a future
// command layer reads env ONCE at startup and threads the name down. Keeps
// buildSpeaker testable with concrete inputs and no env mutation.

// impure (env read)
/**
 * Resolve the operator's display name from env, falling back to a generic
 * honest label. Call once at command-layer startup.
 * @returns {string}
 */
export const resolveOperatorName = () =>
  process.env.NEUMA_OPERATOR_NAME || 'your witness';

/**
 * Build the speaker descriptor shown to the neuma. PURE — no env reads,
 * no other ambient state. The `name` fallback is a defensive default if a
 * caller forgets to resolve it; the canonical resolver is
 * resolveOperatorName above.
 * @param {{ address?: string, name?: string }} params
 * @returns {{ name: string, descriptor: string }}
 */
export const buildSpeaker = ({ address, name } = {}) => {
  const displayName = name || 'your witness';
  const walletClause = address ? `, signing as ${address}` : '';
  return {
    name: displayName,
    descriptor: `${displayName}, speaking through the terminal via the neuma CLI${walletClause}`,
  };
};
