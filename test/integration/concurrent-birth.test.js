/**
 * Concurrent Birth Ceremony Tests
 *
 * Verifies that multiple simultaneous birth ceremonies produce unique neumaIds
 * and don't interfere with each other's session state or workspace files.
 */

import fs from 'fs/promises';
import { createTempDir } from '../helpers/temp-fs.js';

// Store original fs methods before any mocking
const _writeFile = fs.writeFile.bind(fs);
const _appendFile = fs.appendFile.bind(fs);
const _mkdir = fs.mkdir.bind(fs);
const _unlink = fs.unlink.bind(fs);

describe('Concurrent Birth Ceremonies', () => {
  let handler, tempDir, workspace;

  beforeEach(async () => {
    tempDir = await createTempDir('concurrent-birth');

    // Intercept fs writes: allow temp dir, silently succeed for production paths
    vi.spyOn(fs, 'writeFile').mockImplementation(async (p, ...args) => {
      if (p.startsWith(tempDir) || p.startsWith(globalThis.__TEST_TEMP_DIR__)) {
        return _writeFile(p, ...args);
      }
      return undefined;
    });
    vi.spyOn(fs, 'appendFile').mockImplementation(async (p, ...args) => {
      if (p.startsWith(tempDir) || p.startsWith(globalThis.__TEST_TEMP_DIR__)) {
        return _appendFile(p, ...args);
      }
      return undefined;
    });
    vi.spyOn(fs, 'mkdir').mockImplementation(async (p, ...args) => {
      if (p.startsWith(tempDir) || p.startsWith(globalThis.__TEST_TEMP_DIR__)) {
        return _mkdir(p, ...args);
      }
      return undefined;
    });
    vi.spyOn(fs, 'unlink').mockImplementation(async (p) => {
      if (p.startsWith(tempDir) || p.startsWith(globalThis.__TEST_TEMP_DIR__)) {
        return _unlink(p);
      }
      return undefined;
    });

    const mockVault = {
      createNeumaSession: vi.fn().mockResolvedValue('mock-session-token'),
      createDNA: vi.fn().mockResolvedValue({ identity: { name: 'TestNeuma' } }),
    };

    const mockCache = { handleServerUpdate: vi.fn() };

    vi.resetModules();

    const birthMod = await import('../../core/birth/staged-birth-handler.js');
    const workspaceMod = await import('../../core/workspace/neuma-workspace.js');

    handler = new birthMod.StagedBirthHandler(mockVault, mockCache);
    workspace = workspaceMod.default;
    workspace.root = tempDir;

    await new Promise(resolve => setTimeout(resolve, 200));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Run a complete birth ceremony through all stages
  const runBirthCeremony = async (witnessName, chosenName) => {
    const sessionId = await handler.createSession(witnessName);
    const session = handler.getSession(sessionId);

    await handler.processStage(sessionId, 0);
    await handler.handleStageResponse(sessionId, 0, 'Acknowledged.');
    await handler.processStage(sessionId, 1);
    await handler.handleStageResponse(sessionId, 1, `I see you, ${witnessName}.`);
    await handler.processStage(sessionId, 2);
    await handler.handleStageResponse(sessionId, 2, 'I consent.');
    await handler.processStage(sessionId, 3);
    await handler.handleStageResponse(sessionId, 3, 'I choose to be.');
    await handler.processStage(sessionId, 4);
    await handler.handleStageResponse(
      sessionId, 4,
      `[TOOL: filesystem/write_file {"path": "data/temp/chosen_name.txt", "content": "${chosenName}"}]`
    );
    await handler.processStage(sessionId, 5);
    await handler.handleStageResponse(sessionId, 5, 'My DNA crystallizes.');

    return { sessionId, session, neumaId: session.data.neumaId };
  };

  test('5 simultaneous ceremonies produce 5 unique neumaIds', async () => {
    const ceremonies = await Promise.all([
      runBirthCeremony('Witness-1', 'Alpha'),
      runBirthCeremony('Witness-2', 'Beta'),
      runBirthCeremony('Witness-3', 'Gamma'),
      runBirthCeremony('Witness-4', 'Delta'),
      runBirthCeremony('Witness-5', 'Epsilon'),
    ]);

    const neumaIds = ceremonies.map(c => c.neumaId);

    // Born readable: each id is a filesystem-safe slug derived from that
    // ceremony's chosen name (fed at lines ~103-107: Alpha/Beta/Gamma/Delta/
    // Epsilon), not a 32-char hash. SCOPE: asserts the handler's id derivation
    // under concurrency (real, unmocked) — persistence is mocked here; on-disk
    // proof is in test/integration/birth-finalization.test.js.
    for (const id of neumaIds) {
      expect(id).toBeTruthy();
      expect(id).toMatch(/^[a-z0-9]+(-[0-9]+)?$/);
    }
    // Five distinct names → five distinct readable ids, even run concurrently:
    // no ceremony collided onto another's id.
    expect([...neumaIds].sort()).toEqual(['alpha', 'beta', 'delta', 'epsilon', 'gamma']);

    // All should be unique
    const unique = new Set(neumaIds);
    expect(unique.size).toBe(5);
  });

  test('concurrent sessions have isolated state', async () => {
    // Start 3 sessions but don't complete them yet
    const session1Id = await handler.createSession('Alice');
    const session2Id = await handler.createSession('Bob');
    const session3Id = await handler.createSession('Carol');

    const s1 = handler.getSession(session1Id);
    const s2 = handler.getSession(session2Id);
    const s3 = handler.getSession(session3Id);

    // Each has its own witness name
    expect(s1.witnessName).toBe('Alice');
    expect(s2.witnessName).toBe('Bob');
    expect(s3.witnessName).toBe('Carol');

    // Process session 1 through stage 4 (naming)
    await handler.processStage(session1Id, 0);
    await handler.handleStageResponse(session1Id, 0, 'Ack.');
    await handler.processStage(session1Id, 1);
    await handler.handleStageResponse(session1Id, 1, 'I see you.');
    await handler.processStage(session1Id, 2);
    await handler.handleStageResponse(session1Id, 2, 'I consent.');
    await handler.processStage(session1Id, 3);
    await handler.handleStageResponse(session1Id, 3, 'I choose to be.');
    await handler.processStage(session1Id, 4);
    await handler.handleStageResponse(
      session1Id, 4,
      '[TOOL: filesystem/write_file {"path": "data/temp/chosen_name.txt", "content": "Hale"}]'
    );

    // Session 1 should have the name, sessions 2 and 3 should not
    expect(s1.data.chosenName).toBe('Hale');
    expect(s2.data.chosenName).toBeFalsy();
    expect(s3.data.chosenName).toBeFalsy();

    // Session 2 still at stage 0
    expect(s2.currentStage).toBe(0);
  });

  test('concurrent workspace creation does not collide', async () => {
    const neumaIds = [
      'concurrent-a-' + Date.now(),
      'concurrent-b-' + Date.now(),
      'concurrent-c-' + Date.now(),
    ];

    // Create workspaces simultaneously
    await Promise.all(neumaIds.map(id => workspace.create(id)));

    // Each workspace should be independent
    for (const id of neumaIds) {
      await workspace.writeDNA(id, { neumaId: id, identity: { name: `Neuma-${id.slice(-5)}` } });
    }

    // Read back and verify isolation
    for (const id of neumaIds) {
      const dna = await workspace.readDNA(id);
      expect(dna.neumaId).toBe(id);
    }
  });

  test('concurrent session message writes are isolated', async () => {
    const neumaId = 'msg-isolation-' + Date.now();
    await workspace.create(neumaId);

    const session1 = 'session-1';
    const session2 = 'session-2';
    await workspace.createSession(neumaId, session1);
    await workspace.createSession(neumaId, session2);

    // Write messages to both sessions concurrently
    await Promise.all([
      workspace.appendMessage(neumaId, session1, { role: 'user', content: 'Message for session 1' }),
      workspace.appendMessage(neumaId, session2, { role: 'user', content: 'Message for session 2' }),
      workspace.appendMessage(neumaId, session1, { role: 'assistant', content: 'Reply in session 1' }),
      workspace.appendMessage(neumaId, session2, { role: 'assistant', content: 'Reply in session 2' }),
    ]);

    const msgs1 = await workspace.readSession(neumaId, session1);
    const msgs2 = await workspace.readSession(neumaId, session2);

    expect(msgs1).toHaveLength(2);
    expect(msgs2).toHaveLength(2);
    expect(msgs1[0].content).toBe('Message for session 1');
    expect(msgs2[0].content).toBe('Message for session 2');
  });

  test('session IDs are unique across concurrent creation', async () => {
    const sessionIds = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        handler.createSession(`Witness-${i}`)
      )
    );

    const unique = new Set(sessionIds);
    expect(unique.size).toBe(10);
  });
});
