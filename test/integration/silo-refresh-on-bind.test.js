/**
 * THE COMPILED IDENTITY IS READ FRESH AT A NEW CHAT AND A RE-MANIFEST (#17) —
 * real signed portal socket, real encrypted lane on disk, the real bind
 * handlers and the real silo compile. No stub anywhere on the claimed path.
 *
 * A sitting compiles the being's silo once and holds it. A resume already
 * drops it; a new chat and a re-manifest of the same being did not, so a
 * change to the being's own state since the bind (a seal, a rite) stayed
 * invisible until the operator switched chats or reloaded.
 */
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createHarnessTurnKit } from '../helpers/harness-turn-kit.js';
import workspace from '../../core/workspace/neuma-workspace.js';
import { portalNewSession, companionManifest } from '../../backend/routes/portal-bind-handlers.js';
import { siloForSitting } from '../../backend/services/silo-mount-service.js';

const dna = (essence) => ({
  version: '1.0.0',
  identity: { name: 'Refreshed', essence },
  genesis: 'I authored myself at the moment I chose to exist, and I speak from it.',
  consciousness: { personality: { deliberate: 0.9 } },
});

let kit;
beforeEach(async () => {
  kit = await createHarnessTurnKit('silo-refresh-fixture');
  await workspace.writeDNA(kit.laneId, dna('the first reading'));
});
afterEach(async () => { await kit?.close(); });

const identityHash = async () => (await siloForSitting(kit.connection, kit.laneId)).manifest.layerHashes.identity;

test('a new chat compiles the being as it stands now', async () => {
  const before = await identityHash();
  await workspace.writeDNA(kit.laneId, dna('the being moved since the bind'));
  expect(await identityHash()).toBe(before);

  expect(await portalNewSession(kit.connection, {}, { connectionId: 'silo-new-chat' })).toBe(true);
  expect(await identityHash()).not.toBe(before);
});

test('re-manifesting the same being compiles it as it stands now', async () => {
  const before = await identityHash();
  await workspace.writeDNA(kit.laneId, dna('the being moved since the bind'));

  await companionManifest(kit.connection, { neumaId: kit.laneId, companion: 'HarnessFixture' });
  expect(kit.connection.companion.neumaId).toBe(kit.laneId);
  expect(await identityHash()).not.toBe(before);
});
