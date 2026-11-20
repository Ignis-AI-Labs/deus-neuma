/**
 * The operator's independent OS-isolation preference — SANDBOX ON or OFF, one press either way.
 *
 * Design note, 2026-11-02: […] And 2026-11-18, the switch locked ON behind an owner-at-the-desk rule:
 * […]
 * So: OFF is the default (the desk declares the operator's preference the moment it connects, stream-preferences.js),
 * and whatever the desk declares stands — no owner or desk test in the way. A connection that declares nothing (a
 * channel speaking for someone outside the house) keeps the safe start it is given, isolated (portal-connection.js).
 */

export const directShellFor = (connection, source) => (
  connection?.sandboxEnabled === false && source
    ? { sourceRoot: source.sourceRoot, direct: true }
    : null
);

export const declareSandboxMode = async (connection, enabled) => {
  connection.sandboxEnabled = enabled === true;
  return { enabled: connection.sandboxEnabled };
};
