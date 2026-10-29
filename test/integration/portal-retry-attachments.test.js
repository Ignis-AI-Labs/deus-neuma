/**
 * A RETRY NEVER DROPS NEW ATTACHMENTS SILENTLY (RULE 0) — the real portal,
 * real signed auth, the real wallet-bound attachment store, a real lane and a
 * real loopback provider that records every request. Nothing is mocked.
 *
 * Under proof: a retry answers the recorded point, so a frame that asks to
 * add attachments to it — on either the stream or the retry frame — is
 * refused out loud, and no request reaches the model.
 */
import { afterAll, beforeAll, expect, test } from 'vitest';
import { openPortalTurnKit } from '../helpers/portal-turn-kit.js';
import { attachmentStore } from '../../backend/services/attachment-store.js';
import { __test as portalConnections } from '../../backend/routes/portal-connections.js';

const BEING = 'retryattach';
const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
let kit;
let turnId;

beforeAll(async () => {
  kit = await openPortalTurnKit({ label: 'portal-retry-attachments', beings: [{ id: BEING, name: 'Retry' }] });
  await kit.sendAndWait({ type: 'companion:manifest', companion: 'Retry', neumaId: BEING }, 'companion:anchored');
  kit.provider.setScript([{ reply: 'The first take.' }]);
  ({ turnId } = await kit.sendAndWait({ type: 'consciousness:stream', thought: 'Describe the harbor.' }, 'consciousness:complete'));
}, 30000);
afterAll(async () => { await kit?.close(); });

// The signed-in wallet the portal bound — the attachment store is wallet-scoped.
const walletOf = async () => {
  const { connectionId } = kit.frames.find((f) => f.type === 'portal:established');
  return portalConnections.connectionFor(connectionId).walletAddress;
};

const refusedWithNoRequest = async (frame) => {
  const before = kit.provider.turns.length;
  const from = kit.frames.length;
  kit.ws.send(JSON.stringify(frame));
  const refusal = await kit.untilFrame((f) => f.type === 'consciousness:stream' && f.error === true, { from });
  await new Promise((r) => { setTimeout(r, 200); });
  expect(refusal.content).toContain('attachments cannot be added');
  expect(kit.provider.turns.length).toBe(before);
};

test('a stream frame that retries a point and carries attachments is refused out loud', async () => {
  const { ids } = attachmentStore.put(await walletOf(), [IMG]);
  await refusedWithNoRequest({ type: 'consciousness:stream', thought: '', retry: { turnId }, attachments: ids });
});

test('a retry frame that carries attachments is refused the same way', async () => {
  const { ids } = attachmentStore.put(await walletOf(), [IMG]);
  await refusedWithNoRequest({ type: 'consciousness:retry', retry: { turnId }, attachments: ids });
});

