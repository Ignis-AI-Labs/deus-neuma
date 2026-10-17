// ENG-013 (#141) — stage 5 must trust the genesis write's REAL execution
// outcome, not its mere presence: a denied/failed write recording dnaCreated
// is the silent create-and-discard path RULE 0 exists to stop. Real handler,
// real session state, real temp workspace root; the vault/cache collaborators
// are injected exactly as in birth-native-handoff.test.js (outside the
// claimed path — stage 5 gating never reaches them).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { StagedBirthHandler } from '../../core/birth/staged-birth-handler.js';
import { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const GENESIS_CALL = Object.freeze({
  server: 'filesystem',
  toolName: 'write_file',
  tool: 'filesystem/write_file',
  args: { path: '/house/being/dna/genesis.md', content: '# I am' },
});

describe('stage 5 genesis write is status-gated (ENG-013)', () => {
  let handler, origRoot;

  beforeAll(async () => {
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(await createTempDir('genesis-gate-house'));
  });

  afterAll(() => setWorkspacesRoot(origRoot));

  beforeEach(() => {
    handler = new StagedBirthHandler(
      { createNeumaSession: async () => 'tok', createDNA: async () => ({}) },
      { handleServerUpdate: () => {} },
    );
  });

  const startSession = async () => {
    const sessionId = await handler.createSession('GateWitness', true);
    const session = handler.activeSessions.get(sessionId);
    session.data.chosenName = 'Gatecheck';
    return { sessionId, session };
  };

  it('records authored DNA when the executed genesis write landed (status ok)', async () => {
    const { sessionId, session } = await startSession();
    await handler.handleStageResponse(sessionId, 5, '', [GENESIS_CALL],
      [{ tool: 'filesystem/write_file', status: 'ok', content: 'written' }]);
    expect(session.data.selfCreatedDNA).toBe('# I am');
  });

  it('refuses authored DNA when the executed genesis write was DENIED', async () => {
    const { sessionId, session } = await startSession();
    await handler.handleStageResponse(sessionId, 5, '', [GENESIS_CALL],
      [{ tool: 'filesystem/write_file', status: 'denied', error: 'sandbox refused' }]);
    expect(session.data.selfCreatedDNA).toBeUndefined();
  });

  it('refuses authored DNA when the write errored or its result is missing (interrupted batch)', async () => {
    const { sessionId, session } = await startSession();
    await handler.handleStageResponse(sessionId, 5, '', [GENESIS_CALL],
      [{ tool: 'filesystem/write_file', status: 'error', error: 'disk on fire' }]);
    expect(session.data.selfCreatedDNA).toBeUndefined();

    const second = await startSession();
    // Interrupt mid-batch: calls stashed, results array empty prefix — but a
    // NON-empty results array shorter than the calls (result missing at the
    // genesis index) must also refuse.
    await handler.handleStageResponse(second.sessionId, 5, '',
      [{ ...GENESIS_CALL, args: { ...GENESIS_CALL.args } }, GENESIS_CALL].slice(1), []);
    // empty results = legacy text-protocol path: presence-based behavior kept
    expect(second.session.data.selfCreatedDNA).toBe('# I am');
  });

  it('keeps the legacy presence-based behavior for the parsed-text path (no execution records)', async () => {
    const { sessionId, session } = await startSession();
    const text = '[TOOL: filesystem/write_file {"path": "/house/being/dna/genesis.md", "content": "# text-dialect"}]';
    await handler.handleStageResponse(sessionId, 5, text, [], []);
    expect(session.data.selfCreatedDNA).toBe('# text-dialect');
  });
});
