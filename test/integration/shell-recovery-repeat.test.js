/** Signed auth, real approval frames, kernel overlays and both production guards. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createHarnessTurnKit, untilHarness } from '../helpers/harness-turn-kit.js';
import { ensureWitnessCodingSandbox, runWitnessCommand } from '../../backend/services/witness-coding-sandbox.js';
import { beingCodingToolsFor, stashBeingTurnCatalog } from '../../backend/services/being-tool-surface.js';
import { toolsForWitness } from '../../backend/services/witness-tools.js';
import { processToolCalls } from '../../backend/services/portal-tool-loop.js';
import { processWitnessToolBatch } from '../../backend/services/witness-tool-batch.js';
import { openTurnOperations } from '../../backend/services/turn-operation-checkpoint.js';

const call = (name, args = {}) => ({ server: 'coding', toolName: name, tool: `coding/${name}`, args });
const take = Object.freeze({ turnId: 'recovery-repeat-turn' });

describe.each(['portal', 'witness'])('%s recovery repeat identity', (seat) => {
  let kit, old, runtime, turn;
  const batch = (calls) => seat === 'witness'
    ? processWitnessToolBatch({ ws: kit.ws, connection: kit.connection, calls, runtime, turn })
    : processToolCalls(kit.ws, '', kit.connection, calls, turn);
  const cards = () => kit.frames.filter(frame => frame.type === 'tool:approval_request' && frame.tool === 'coding/sandbox_recover');
  const recover = async (decision) => {
    const count = cards().length;
    const running = batch([call('sandbox_recover')]);
    const card = await untilHarness(() => cards()[count]);
    kit.decide(card, decision);
    return (await running)[0];
  };

  beforeEach(async () => {
    kit = await createHarnessTurnKit(seat === 'witness' ? 'witness-test-RecoveryRepeat' : 'recovery-repeat-fixture');
    kit.connection.toolWorkspace = kit.ground;
    turn = await openTurnOperations(kit.connection, take);
    await fs.mkdir(path.join(kit.ground, 'node_modules'));
    await fs.writeFile(path.join(kit.ground, 'node_modules', 'dependency.cjs'), 'module.exports = 1;');
    old = await ensureWitnessCodingSandbox(kit.laneId, kit.ground);
    const wrote = await runWitnessCommand({ ...old, mode: 'write', command: 'echo preserved > old.txt' });
    expect(wrote.exitCode, wrote.stderr).toBe(0);
    await fs.mkdir(path.join(kit.ground, 'keys'));
    await fs.writeFile(path.join(kit.ground, 'keys', 'secret.txt'), 'PRIVATE_MARKER');
    await expect(ensureWitnessCodingSandbox(kit.laneId, kit.ground)).rejects.toThrow('mask reach changed');
    if (seat === 'witness') runtime = await toolsForWitness(kit.connection, kit.ground, { nativeTools: true });
    else await stashBeingTurnCatalog(kit.connection, await beingCodingToolsFor(kit.connection), []);
    kit.client.on('message', data => {
      const frame = JSON.parse(data.toString());
      if (frame.type === 'tool:approval_request' && frame.tool !== 'coding/sandbox_recover') kit.decide(frame, 'allow');
    });
  });
  afterEach(async () => { await kit?.close(); });

  test.each(['allow', 'deny'])('new lower drift permits another approval; %s and immediate repeats remain authoritative', async (decision) => {
    const first = await recover('allow');
    expect(first.status, JSON.stringify(first)).toBe('ok');
    const fresh = kit.connection._turnSandbox;
    turn = await openTurnOperations(kit.connection, take);
    const repeat = await batch([{ ...call('sandbox_recover'), recoveryState: 'model-invented-nonce' }]);
    expect(repeat[0].status).toBe('held');
    expect(cards()).toHaveLength(1);
    // The build also rewrites the dependency's timestamp, so the shell's layer holds its own copy:
    // a live edit beneath THAT copy is real drift (an edit beside the shell's files is not).
    const build = await batch([call('execute', { command: 'echo build-cache > node_modules/cache.txt && touch node_modules/dependency.cjs' })]);
    expect(build[0].status, JSON.stringify(build)).toBe('ok');
    // An unrelated successful command must not unlock another recovery.
    expect((await batch([call('sandbox_recover')]))[0].status).toBe('held');
    await fs.writeFile(path.join(kit.ground, 'node_modules', 'dependency.cjs'), 'module.exports = 2;');
    await expect(ensureWitnessCodingSandbox(kit.laneId, kit.ground)).rejects.toThrow('live lower changed beneath upper shadow "node_modules/dependency.cjs"');
    const second = await recover(decision);
    expect(second.status, JSON.stringify(second)).toBe(decision === 'allow' ? 'ok' : 'denied');
    turn = await openTurnOperations(kit.connection, take);
    expect((await batch([call('sandbox_recover')]))[0].status).toBe('held');
    expect(cards()).toHaveLength(2);
    expect(await fs.readFile(path.join(old.workspace, 'old.txt'), 'utf8')).toBe('preserved\n');
    expect(await fs.readFile(path.join(fresh.workspace, 'node_modules', 'cache.txt'), 'utf8')).toBe('build-cache\n');
    await expect(fs.stat(path.join(kit.ground, 'node_modules', 'cache.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    if (decision === 'allow') {
      expect(kit.connection._turnSandbox.workspace).not.toBe(fresh.workspace);
      const run = await batch([call('execute', { command: 'node -p "require(\'./node_modules/dependency.cjs\')"' })]);
      expect(run[0].status, JSON.stringify(run)).toBe('ok');
      expect(run[0].content).toContain('2');
    }
  }, 30000);
});
