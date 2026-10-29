/**
 * The install's security self-check (backend/services/security/self-check.js)
 * — the canaries the installed app runs on itself. On the real tree every
 * canary holds and nothing is reported; handed a broken REAL alternative for
 * the function it guards (the walls with none configured, a loopback-only
 * address test, the old `{...env}` spawn environment, the guard read in ASK
 * mode, a different gate than the owner's), each one reports exactly its own
 * finding, in the ledger's shape. No mocks: every function handed in is a real
 * one from the platform or the shape a past defect really had.
 */
import { runSelfChecks, OWNER_GATED_ROUTES } from '../../backend/services/security/self-check.js';
import { laneStateWriteReason } from '../../backend/services/sandbox-path-policy.js';
import { isLoopbackAddress } from '../../backend/services/remote/access-scope.js';
import { isAutoHardGated, applyProtocolGuard } from '../../backend/services/protocol-guard.js';
import { requireLocalScope } from '../../backend/services/remote/access-guard.js';
import { validateThreat } from '../../backend/services/security/threat-ledger.js';

const only = (result) => result.findings.map((f) => f.externalId);

describe('the security self-check', () => {
  test('on the real tree every canary holds: no findings, no errors', async () => {
    expect(await runSelfChecks()).toEqual({ findings: [], errors: [] });
  }, 60_000);

  test('the walls with none configured — the write-wall canary reports', async () => {
    const result = await runSelfChecks({ writeReason: (p) => laneStateWriteReason(p, { walls: [] }) });
    expect(only(result)).toEqual(['self-check:platform-write-wall']);
    expect(result.findings[0].surfaces.some((s) => s.endsWith('.bashrc'))).toBe(true);
  }, 60_000);

  test('a loopback-only address test — the SSRF canary names the metadata and CGNAT hosts', async () => {
    const result = await runSelfChecks({ privateHost: isLoopbackAddress });
    expect(only(result)).toEqual(['self-check:ssrf-private-ranges']);
    expect(result.findings[0].surfaces).toEqual(expect.arrayContaining(['169.254.169.254', '100.64.0.1']));
  }, 60_000);

  test('the old `{...env}` spawn environment — the helper-env canary names the leaked keys, never their values', async () => {
    const result = await runSelfChecks({ environments: { mcp: (env) => ({ ...env }) } });
    expect(only(result)).toEqual(['self-check:helper-env-secrets']);
    expect(result.findings[0].surfaces).toEqual(expect.arrayContaining(['mcp:AUTH_SECRET', 'mcp:DNA_ENCRYPTION_KEY']));
    expect(JSON.stringify(result.findings[0])).not.toContain('self-check-canary-');
  }, 60_000);

  test('the protocol guard read in ASK mode — the hard-gate canary reports every class', async () => {
    const result = await runSelfChecks({ hardGated: (server, tool) => applyProtocolGuard('allowed', 'ask', server, tool) === 'approval_required' });
    expect(only(result)).toEqual(['self-check:auto-hard-gates']);
    expect(result.findings[0].surfaces).toEqual(expect.arrayContaining(['intents/security.assess', 'intents/wallet.send', 'intents/team.workspace-run']));
  }, 60_000);

  // re-audit 2026-10-29, NEW-L9: the canary watched 5 of the 9 gates
  test.each([
    'intents/security.assess', 'intents/security.escalate', 'intents/security.circuit-breaker', 'intents/wallet.send',
    'intents/team.workspace-run', 'intents/email.send', 'intents/social.post', 'intents/tasks.operator-drop', 'filesystem/delete_file',
  ])('a guard that drops %s — the canary names exactly it', async (gate) => {
    const result = await runSelfChecks({ hardGated: (server, tool) => `${server}/${tool}` !== gate && isAutoHardGated(server, tool) });
    expect(only(result)).toEqual(['self-check:auto-hard-gates']);
    expect(result.findings[0].surfaces).toEqual([gate]);
  }, 60_000);

  test('a different gate than the owner\'s — the machine-route canary names the routes without it', async () => {
    const result = await runSelfChecks({ ownerGate: requireLocalScope });
    expect(only(result)).toEqual(['self-check:machine-owner-gate']);
    expect(result.findings[0].surfaces).toEqual(expect.arrayContaining(['PUT /api/v1/mind/gates', 'PUT /api/v1/look/theme']));
    expect(OWNER_GATED_ROUTES.length).toBeGreaterThan(30);
  }, 60_000);

  test('a canary that cannot run is an error, never a silent pass', async () => {
    const result = await runSelfChecks({ routes: async () => { throw new Error('route table unreadable'); } });
    expect(result.findings).toEqual([]);
    expect(result.errors).toEqual(['machine-owner-gate: route table unreadable']);
  }, 60_000);

  test('a finding is the ledger\'s shape: house layer, self-check source, a stable externalId', async () => {
    const { findings } = await runSelfChecks({ privateHost: isLoopbackAddress });
    expect(findings[0]).toMatchObject({ layer: 'house', source: 'self-check', externalId: 'self-check:ssrf-private-ranges', severity: 'high' });
    // the ledger takes it as it stands
    expect(validateThreat(findings[0])).toBeNull();
  }, 60_000);
});
