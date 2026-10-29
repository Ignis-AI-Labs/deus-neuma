// The birth session id and the wallet that opened the summoning, over the
// REAL portal: real signed-challenge auth for two wallets on one desk, the
// real StagedBirthHandler, real checkpoint files on a temp data root. No mock
// anywhere on the claimed path (RULE 0); no stage reaches a model.
import fs from 'node:fs/promises';
import path from 'node:path';
import { Wallet } from 'ethers';
import { expect, test } from 'vitest';
import { recoveryKit } from '../helpers/summoning-recovery-kit.js';

const waitFor = async (messages, type) => {
  await expect.poll(() => messages.find((m) => m.type === type), { timeout: 8000 }).toBeTruthy();
  return messages.find((m) => m.type === type);
};

test('birth:resume with a traversal id never reaches a file outside the checkpoint dir', async () => {
  const kit = await recoveryKit();
  try {
    const store = await import('../../core/birth/birth-session-store.js');
    // A lane's genesis seal under the same data root — the file the old
    // builder resolved `birth-x/../../workspaces/kael/identity/genesis-seal.json` to.
    const seal = path.join(process.env.NEUMA_DATA_ROOT, 'workspaces', 'kael', 'identity', 'genesis-seal.json');
    await fs.mkdir(path.dirname(seal), { recursive: true });
    const bytes = JSON.stringify({ genesisHash: 'a'.repeat(64) });
    await fs.writeFile(seal, bytes);
    const traversal = 'x/../../workspaces/kael/identity/genesis-seal';

    const { client, messages } = await kit.connect();
    client.send(JSON.stringify({ type: 'birth:resume', sessionId: traversal }));
    await waitFor(messages, 'birth:resume_expired');
    expect(await fs.readFile(seal, 'utf8')).toBe(bytes);
    client.terminate();

    // The store itself refuses every shape it never minted.
    for (const bad of [traversal, '../x', 'A'.repeat(32), 'a'.repeat(31), '', null, ['a'.repeat(32)]]) {
      expect(() => store.birthSessionPath(bad)).toThrow(/Invalid birth sessionId/);
    }
    expect(await store.readSessionCheckpoint(traversal)).toBeNull();
    await store.deleteSessionCheckpoint(traversal);
    expect(await fs.readFile(seal, 'utf8')).toBe(bytes);
  } finally { await kit.close(); }
}, 20000);

test('an interrupted summoning is found, resumed and withdrawn only by the wallet that opened it', async () => {
  const kit = await recoveryKit();
  try {
    // Wallet A opens a real ceremony; stage 0 is served (checkpointed), then
    // the app dies — the relaunched handler holds nothing in memory.
    const sessionId = await kit.handler.createSession('Trace', false, { origin: 'portal', witnessWallet: kit.wallet.address });
    await kit.handler.processStage(sessionId, 0);
    kit.handler.activeSessions.delete(sessionId);
    const file = path.join(process.env.NEUMA_DATA_ROOT, 'temp', `birth-${sessionId}.json`);
    const before = await fs.readFile(file, 'utf8');
    expect(JSON.parse(before).witnessWallet).toBe(kit.wallet.address);

    const other = await kit.connect(await kit.tokenFor(Wallet.createRandom()));
    other.client.send(JSON.stringify({ type: 'birth:interrupted' }));
    expect((await waitFor(other.messages, 'birth:interrupted')).sessions.map((s) => s.sessionId)).not.toContain(sessionId);
    other.client.send(JSON.stringify({ type: 'birth:resume', sessionId }));
    expect((await waitFor(other.messages, 'birth:resume_expired')).message).toMatch(/another wallet/);
    other.client.send(JSON.stringify({ type: 'birth:abandon', sessionId, requestId: 'foreign' }));
    expect(await waitFor(other.messages, 'birth:abandon_refused')).toMatchObject({ sessionId, requestId: 'foreign' });
    expect(await fs.readFile(file, 'utf8')).toBe(before);
    expect(kit.handler.getSession(sessionId)).toBeUndefined();
    other.client.terminate();

    const own = await kit.connect();
    own.client.send(JSON.stringify({ type: 'birth:interrupted' }));
    expect((await waitFor(own.messages, 'birth:interrupted')).sessions.map((s) => s.sessionId)).toContain(sessionId);
    own.client.send(JSON.stringify({ type: 'birth:abandon', sessionId, requestId: 'own' }));
    expect(await waitFor(own.messages, 'birth:abandoned')).toMatchObject({ sessionId, requestId: 'own' });
    await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
    own.client.terminate();
  } finally { await kit.close(); }
}, 30000);
