/**
 * THE SUPERVISOR REDIRECT (ARC-HARNESS L1, #531), proven at the wire
 * (RULE 0): the REAL `runToolRounds` over a REAL loopback SSE provider, with
 * REAL tool acts on REAL disk through the REAL MCP filesystem organ — no
 * seam mocked. The shape under proof: three rounds of varied speech over a
 * still world (each round reads a different missing ledger — every act
 * honestly fails, no epoch movement) draw ONE supervisor redirect brief at
 * the follow-up's recency-maximal position, and the turn then settles on
 * the being's answer. Undeclared connections never see it.
 */
import { beforeEach, afterEach, expect, test, describe } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createHarnessTurnKit, untilHarness } from '../helpers/harness-turn-kit.js';
import { startLocalProvider } from '../helpers/local-provider.js';
import { runToolRounds } from '../../backend/services/portal-turn-rounds.js';
import { connectFilesystemServer } from '../../backend/services/mcp-filesystem.js';
import { mcpService } from '../../backend/services/mcp.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { openTurnRecord, closeTurnRecord } from '../../backend/services/tool-action-record.js';

let kit, provider;
beforeEach(async () => {
  kit = await createHarnessTurnKit('supervisor-redirect-proof');
  process.env.DNA_ENCRYPTION_KEY = process.env.DNA_ENCRYPTION_KEY || 'test-encryption-key-32-characters!';
  await connectFilesystemServer();
  provider = await startLocalProvider();
  openTurnRecord(kit.ws);
});
afterEach(async () => {
  closeTurnRecord(kit.ws);
  await provider?.close();
  await mcpService.disconnect('filesystem').catch(() => {});
  await kit?.close();
});

const lastUserMessage = (body) => [...body.messages].reverse().find((m) => m.role === 'user')?.content;

// Three missing ledgers INSIDE the lane — in-lane reads owe no approval card,
// and each distinct path is a fresh call the held-receipt guard cannot hold
// (the byte-identical close's territory ends where varied args begin).
const missingLedger = (n) => path.join(kit.root, 'lanes', kit.laneId, `ledger-missing-${n}.txt`);

const runTurn = ({ supervisor }) => {
  kit.connection._turnSupervisor = supervisor;
  return runToolRounds({
    ws: kit.ws, connection: kit.connection, companion: kit.connection.companion,
    companionName: 'SupervisorFixture', voiceDNA: null,
    messages: [{ role: 'system', content: 'Audit the ledgers.' }, { role: 'user', content: 'Count the outstanding debt across the ledgers.' }],
    wireHead: 2,
    preset: { temperature: 0, maxTokens: 2048, exactMaxTokens: true },
    nativeToolsForRound: () => [],
    interrupt: kit.connection.activeTurn,
    route: { provider: 'lm-studio', endpoint: provider.endpoint, model: 'test-model', apiKey: '' },
    turnLora: null, turnEffort: null, take: { turnId: 'supervisor-proof', takeIndex: 1 },
    turnCapabilities: null, contextSections: [], contextBudget: null, contextScope: {},
  });
};

const stalledScript = () => [
  { reply: `Checking the first ledger.\n\n[TOOL: fs/read {"path": "${missingLedger(1)}"}]` },
  { reply: `Nothing there — the second, then.\n\n[TOOL: fs/read {"path": "${missingLedger(2)}"}]` },
  { reply: `Perhaps the archive copy.\n\n[TOOL: fs/read {"path": "${missingLedger(3)}"}]` },
  { reply: 'All three ledgers are gone; nothing is owed. #### 0' },
];

describe('the supervisor redirects a turn going nowhere', () => {
  test('three varied-speech rounds over a still world draw ONE redirect, then the answer', async () => {
    provider.setScript(stalledScript());
    const result = await runTurn({ supervisor: true });
    expect(result.error).toBeNull();
    // Three stagnant rounds, then the settled answer — the redirect rode the
    // third round's follow-up, it did not consume a round of its own.
    expect(provider.turns).toHaveLength(4);
    const redirectedRequest = lastUserMessage(provider.turns[3]);
    expect(redirectedRequest).toContain('the world did not move');
    expect(redirectedRequest).toContain('the form the task requires');
    // The redirect stands in the turn record and the engagement counter.
    expect(kit.connection._turnSupervisorRedirects).toBe(1);
    // The being's answer closed the turn on the evidence it had.
    expect(result.latestResponse).toContain('#### 0');
  });

  test('the redirect is journaled on the lane', async () => {
    provider.setScript(stalledScript());
    await runTurn({ supervisor: true });
    // The journal write is fire-and-forget by law, and the journal is
    // AES-encrypted at rest — read it back through the workspace API.
    await untilHarness(async () =>
      (await neumaWorkspace.readJournal(kit.laneId)).find((e) => e.type === 'supervisor_redirect') || null);
    const entries = await neumaWorkspace.readJournal(kit.laneId);
    const redirect = entries.find((e) => e.type === 'supervisor_redirect');
    expect(redirect.metadata.kind).toBe('unmoved-world');
    expect(redirect.metadata.layer).toBe('arc-harness-l1');
  });

  test('an undeclared connection runs the same stalled turn with no redirect', async () => {
    provider.setScript(stalledScript());
    const result = await runTurn({ supervisor: false });
    expect(result.error).toBeNull();
    expect(provider.turns).toHaveLength(4);
    // No redirect note anywhere in the wire: the layers are declared-only.
    for (const turn of provider.turns) {
      expect(lastUserMessage(turn)).not.toContain('the world did not move');
    }
    expect(kit.connection._turnSupervisorRedirects).toBeUndefined();
  });

  test('progress stops the redirect — a turn whose acts move the world is never nudged', async () => {
    // Round 3's read lands on a file that EXISTS (the world moves), and the
    // round after it settles with the answer — no stagnation is ever standing
    // when the redirect would be consulted.
    const present = path.join(kit.root, 'lanes', kit.laneId, 'ledger-present.txt');
    await fs.writeFile(present, 'debt: 0\n', 'utf8');
    provider.setScript([
      { reply: `First ledger.\n\n[TOOL: fs/read {"path": "${missingLedger(1)}"}]` },
      { reply: `Second ledger.\n\n[TOOL: fs/read {"path": "${missingLedger(2)}"}]` },
      { reply: `The present ledger, at last.\n\n[TOOL: fs/read {"path": "${present}"}]` },
      { reply: 'Debt read from the standing ledger: 0. #### 0' },
    ]);
    const result = await runTurn({ supervisor: true });
    expect(result.error).toBeNull();
    expect(provider.turns).toHaveLength(4);
    expect(kit.connection._turnSupervisorRedirects).toBeUndefined();
  });
});
