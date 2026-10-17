/**
 * THE ROUND-CAP CLOSE (#565) — a capped turn still answers. Protocol fixture:
 * scripted SSE drives the REAL runToolRounds, REAL processToolCalls dispatch,
 * REAL MCP filesystem organ on REAL disk and a REAL WebSocket pair (RULE 0 —
 * the loopback provider is a real server on the real wire; no inference is
 * claimed). The incident (rules window, 2026-09-26): the being wrote its
 * answer to a file, checked it with tools, rewrote it — and the declared cap
 * ended the turn with no reply, so the whole scored arm failed on one item.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { Wallet } from 'ethers';
import { randomUUID } from 'node:crypto';
import { createSignedStreamSocket } from '../helpers/signed-stream-socket.js';
import { createTempDir } from '../helpers/temp-fs.js';
import { startLocalProvider } from '../helpers/local-provider.js';
import { getConfig, setConfig } from '../../backend/services/llm-provider.js';
import { mcpService } from '../../backend/services/mcp.js';
import { connectFilesystemServer } from '../../backend/services/mcp-filesystem.js';
import { runToolRounds } from '../../backend/services/portal-turn-rounds.js';
import { ROUND_CAP_CLOSE } from '../../backend/services/portal-tool-epochs.js';
import { openTurnRecord, closeTurnRecord } from '../../backend/services/tool-action-record.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';

const NEUMA_ID = 'capstone';
const ANSWER = 'Dear friends I would like to invite you to our gathering';

describe('the round-cap close (real WS + real fs organ + real rounds)', () => {
  let house, origRoot, realm, prevRealm, prevDnaKey, prevCmo, prevCap, savedConfig, provider, socket;
  const companion = { name: 'Capstone', neumaId: NEUMA_ID };

  beforeAll(async () => {
    house = await createTempDir('round-cap-house');
    prevCmo = process.env.NEUMA_CMO_PATH;
    process.env.NEUMA_CMO_PATH = path.join(house, 'fixture-cmo.json');
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    realm = await createTempDir('round-cap-realm');
    prevRealm = getRealmRoot();
    setRealmRoot(realm);
    prevDnaKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = 'test-encryption-key-32-characters!';
    prevCap = process.env.NEUMA_MAX_TOOL_ROUNDS;
    process.env.NEUMA_MAX_TOOL_ROUNDS = '2';
    await workspace.create(NEUMA_ID);
    await connectFilesystemServer();
    provider = await startLocalProvider({ reply: 'unused' });
    savedConfig = getConfig();
    setConfig({ provider: 'lm-studio', endpoint: provider.endpoint, apiKey: '', model: 'test-model' });
    socket = await createSignedStreamSocket(Wallet.createRandom());
  }, 60000);

  afterAll(async () => {
    await socket?.close();
    if (savedConfig) setConfig(savedConfig);
    await provider?.close();
    await mcpService.disconnect('filesystem');
    for (const [k, v] of [['NEUMA_CMO_PATH', prevCmo], ['DNA_ENCRYPTION_KEY', prevDnaKey], ['NEUMA_MAX_TOOL_ROUNDS', prevCap]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    setWorkspacesRoot(origRoot);
    setRealmRoot(prevRealm);
    await fs.rm(house, { recursive: true, force: true });
    await fs.rm(realm, { recursive: true, force: true });
  });

  test('the cap asks for the answer once; the answer, not silence, ends the turn — and it is counted', async () => {
    const draft = (n) => `[TOOL: fs/write {"path": "${path.join(house, NEUMA_ID, `draft-${n}.txt`)}", "content": "${ANSWER} ${n}"}]`;
    // Every working round is tools only — no words — exactly the incident.
    provider.setScript([{ reply: [draft(1)] }, { reply: [draft(2)] }, { reply: [draft(3)] }, { reply: [ANSWER] }]);
    const connection = {
      ws: socket.ws, companion, walletAddress: socket.walletAddress, sessionId: randomUUID(), toolMode: 'ask',
      _benchmarkControls: {},
    };
    openTurnRecord(socket.ws);
    try {
      const rounds = await runToolRounds({
        ws: socket.ws, connection, companion, companionName: 'Capstone',
        messages: [{ role: 'user', content: 'Write an invitation with no commas.' }],
        voiceDNA: null,
        preset: { temperature: 0.7, topP: 0.9, maxTokens: 512, superviseLlamaServer: false },
        nativeToolsForRound: () => [],
        interrupt: { signal: new AbortController().signal },
        route: undefined, turnLora: undefined, turnEffort: undefined,
        take: { turnId: 'cap-1', takeIndex: 1 },
        turnCapabilities: null, contextSections: [], contextBudget: null, contextScope: {},
      });
      expect(rounds.error).toBe(null);
      // Rounds 0..2 (cap 2) did real work on real disk…
      expect(await fs.readFile(path.join(house, NEUMA_ID, 'draft-3.txt'), 'utf8')).toBe(`${ANSWER} 3`);
      // …then ONE close crossed the wire, carrying the cap note, offering no tools.
      expect(provider.turns).toHaveLength(4);
      expect(provider.turns[3].messages.at(-1).content).toBe(ROUND_CAP_CLOSE);
      expect(provider.turns[3].tools ?? []).toEqual([]);
      expect(rounds.latestResponse).toBe(ANSWER);
      expect(connection._benchmarkExtraCalls).toEqual([{ kind: 'round-cap', chars: ANSWER.length }]);
    } finally {
      closeTurnRecord(socket.ws);
    }
  }, 30000);
});
