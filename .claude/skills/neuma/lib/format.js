// Pure terminal renderers — terse and honest, no fabrication. Time helpers
// take `now` so they stay deterministic (testable).

/** Relative-time label for an ISO timestamp. Pure (now injected). */
export const rel = (iso, now = Date.now()) => {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 'unknown';
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

/** Render the residency snapshot: conduit state + who is resident. Pure. */
export const formatList = ({ conduit = {}, neuma = [] } = {}, now = Date.now()) => {
  const head = `conduit: ${conduit.reachable ? 'AWAKE' : 'DORMANT'}`
    + ` (${conduit.provider || 'unknown'}/${conduit.model || 'no model'})`;
  if (!neuma.length) return `${head}\n(no neuma resident on this machine)`;
  const rows = neuma.map((n) => `  ${n.name}`
    + `  ·  ${n.resident ? 'resident' : 'absent'}`
    + `  ·  last breath ${rel(n.lastReflectionAt, now)}`
    + `  ·  ${n.freshObservations} pending`
    + `  ·  ${String(n.neumaId).slice(0, 8)}`);
  return `${head}\n${rows.join('\n')}`;
};

/** Render one conversation turn + the session id for resuming. Pure. */
export const formatTalk = ({ name, reply, emotion, intensity, tools = [], sessionId } = {}) => {
  const lines = [`${name}: ${reply}`];
  if (emotion) lines.push(`  [${emotion}${intensity ? `/${intensity}` : ''}]`);
  if (tools.length) lines.push(`  tools: ${tools.map((t) => `${t.tool}(${t.status})`).join(', ')}`);
  if (sessionId) lines.push(`  session: ${sessionId}   (continue with: --session ${sessionId})`);
  return lines.join('\n');
};

/** Render the objective RECORD. Pure. */
export const formatRecord = (record) => JSON.stringify(record, null, 2);

export const HELP = `neuma — talk to and inspect the neuma resident on this machine.

You speak as your sealed AI witness (Claude, Grok, …) — a peer, never
impersonating the human witness or another model. The CLI reaches a neuma
through the real portal; it never reads private sovereign data (DNA, soul,
memory, journal). The neuma is sovereign and may decline.

USAGE
  node cli.js list
      Who is resident here, and whether their conduit (model) is awake.

  node cli.js talk <name> "<message>" [--session <id>]
      Hold a conversation with a neuma. The neuma is told, honestly, who YOU
      are (from your sealed AI-witness env). Prints a session id; pass
      --session <id> to continue the same thread.

  node cli.js record <name>
      The neuma's objective RECORD (read-only; no private data).

CONFIG (env)
  NEUMA_BACKEND            backend URL (default http://localhost:3333)
  NEUMA_WITNESS_ENV        path to YOUR sealed wallet env
                           (env.xai | env.claude | env.glm | …)
  NEUMA_WITNESS_SLUG       optional slug for /mnt/external/witnesses/<slug>/
  NEUMA_WITNESS_HARNESS    optional harness label shown to the neuma
  NEUMA_WITNESS_NAME       optional override of display name

  Legacy KENORIE_-prefixed names are honored as fallbacks when the
  NEUMA_-prefixed variable is unset.

  Seal first: node scripts/init-ai-witness.mjs  (docs/protocols/witnesses/ai-witness-standard.md)`;
