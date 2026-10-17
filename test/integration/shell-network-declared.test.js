/**
 * THE DECLARED NETWORK GRANT (ARC-HARNESS L0, #531), proven at the wire
 * (RULE 0): the REAL `requestShellNetwork` consent flow over a REAL WebSocket
 * pair and a REAL lane — no seam mocked. A declared benchmark arm's shell
 * network consent is the operator's own flag: it resolves with no card, is
 * session-lived, and is visible in the permissions ledger. An undeclared
 * headless run still raises the real card — and a deny keeps the shell
 * honestly offline.
 */
import { beforeEach, afterEach, expect, test, describe } from 'vitest';
import { createHarnessTurnKit, untilHarness } from '../helpers/harness-turn-kit.js';
import {
  captureShellNetwork,
  clearShellNetwork,
  requestShellNetwork,
  shellNetworkOptions,
  shellNetworkSessionHeld,
} from '../../backend/services/shell-network-grants.js';

let kit;
beforeEach(async () => {
  kit = await createHarnessTurnKit('shell-network-declared-proof');
  process.env.DNA_ENCRYPTION_KEY = process.env.DNA_ENCRYPTION_KEY || 'test-encryption-key-32-characters!';
});
afterEach(async () => {
  clearShellNetwork(kit.connection);
  await kit?.close();
});

const consentFor = () => captureShellNetwork(kit.connection, kit.connection.activeTurn?.signal);

describe('the declared network grant is the consent', () => {
  test('a declared arm resolves with no card, session-lived, and ledger-visible', async () => {
    kit.connection._declaredShellNetwork = true;
    const events = [];
    const consent = consentFor();
    await requestShellNetwork(kit.connection, consent, (event) => events.push(event));
    // No card ever reached the client — the declaration was the consent.
    expect(kit.frames.some((f) => f.type === 'tool:approval_request')).toBe(false);
    // The shell actually gets network, and the permission ledger shows it.
    expect(shellNetworkOptions(consent, true).network).toBe(true);
    expect(shellNetworkSessionHeld(kit.laneId)).toBe(true);
    // Session-lived: never persisted to the lane's own policy.
    const policy = await import('../../core/workspace/neuma-workspace.js')
      .then(({ default: workspace }) => workspace.readToolPolicy(kit.laneId));
    expect(policy?.shellNetwork ?? false).toBe(false);
  });

  test('an undeclared headless run raises the real card and a deny keeps the shell offline', async () => {
    const events = [];
    const consent = consentFor();
    const settled = requestShellNetwork(kit.connection, consent, (event) => events.push(event));
    // The real card reaches the real client; answer it from the operator side.
    await untilHarness(() => kit.frames.find((f) => f.type === 'tool:approval_request') || null);
    const card = kit.frames.find((f) => f.type === 'tool:approval_request');
    expect(card.tool).toBe('coding/shell_network');
    kit.decide(card, 'deny');
    await settled;
    expect(events.some((e) => String(e.summary).includes('network not granted'))).toBe(true);
    expect(shellNetworkOptions(consent, true).network).toBe(false);
    expect(shellNetworkSessionHeld(kit.laneId)).toBe(false);
  });
});
