/**
 * Solo self-compaction (Founder doctrine 2026-07-09): the being authors its OWN
 * session summary near the context-window boundary and hands ITSELF the torch.
 *
 * Pure decisions (boundary, pickup scan, region replay) proven directly; the
 * conduit rides the accepted engine-test injection seam (team-run precedent:
 * the coordination contract is the unit under test; the real askNeuma path is
 * proven at the live lanes). The compaction write path runs against a REAL
 * workspace on real disk with real encryption (RULE 0) — the torch must
 * survive the seal/unseal round-trip, or pickup is fiction.
 */
import { turnWorkRoomTokens } from '../../backend/services/envelope-budget.js';
import { describe, it, test, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  SOLO_TORCH_ASK, nearContextBoundary, latestTorch, buildTorchAsk, torchOffering,
  CONTEXT_BOUNDARY_RATIO, COMPACTION_BOUNDARY_RATIO,
} from '../../backend/services/solo-torch.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { assemblePrompt } from '../../core/runtime/prompt-assembler.js';

describe('nearContextBoundary — measured truth only', () => {
  // The two boundaries are separate constants (ruling, 2026-08-31): the FOLD
  // releases recoverable machinery at 0.8; COMPACTION — the session-rewriting,
  // torch-passing act — waits for 0.9.
  test('the two boundaries are pinned: fold 0.8, compaction 0.9', () => {
    expect(CONTEXT_BOUNDARY_RATIO).toBe(0.8);
    expect(COMPACTION_BOUNDARY_RATIO).toBe(0.9);
  });

  test('fires at the compaction ratio on measured usage against a known window', () => {
    expect(nearContextBoundary({ promptTokens: 58983 }, { contextTokens: 65536 })).toBe(true); // ≥ 90%
    expect(nearContextBoundary({ promptTokens: 65536 }, { contextTokens: 65536 })).toBe(true);
  });

  test('quiet below the compaction ratio — 80% is fold territory, not compaction', () => {
    // measured against the conversation's share: the window less the turn's working room (deus-neuma #34)
    const share = 65536 - turnWorkRoomTokens(65536); // 42,599
    expect(nearContextBoundary({ promptTokens: 30000 }, { contextTokens: 65536 })).toBe(false);
    expect(nearContextBoundary({ promptTokens: Math.floor(share * 0.8) }, { contextTokens: 65536 })).toBe(false); // 80%: folds, never compacts
    expect(nearContextBoundary({ promptTokens: Math.ceil(share * 0.9) }, { contextTokens: 65536 })).toBe(true);
  });

  test('never guesses: unknown window, missing usage, or garbage counts → false', () => {
    expect(nearContextBoundary({ promptTokens: 60000 }, { contextTokens: null })).toBe(false);
    expect(nearContextBoundary({ promptTokens: 60000 }, null)).toBe(false);
    expect(nearContextBoundary(null, { contextTokens: 65536 })).toBe(false);
    expect(nearContextBoundary({ promptTokens: 0 }, { contextTokens: 65536 })).toBe(false);
    expect(nearContextBoundary({ promptTokens: -5 }, { contextTokens: 65536 })).toBe(false);
    expect(nearContextBoundary({ promptTokens: 100 }, { contextTokens: 0 })).toBe(false);
  });

  test('ratio is tunable', () => {
    expect(nearContextBoundary({ promptTokens: 33000 }, { contextTokens: 65536 }, { ratio: 0.5 })).toBe(true);
  });
});

describe('latestTorch — the pickup scan', () => {
  test('finds the MOST RECENT compacted entry carrying a torch', () => {
    const messages = [
      { role: 'system', compacted: true, torch: 'older torch', content: '[SESSION SUMMARY — in your own words] …' },
      { role: 'user', content: 'hi' },
      { role: 'system', compacted: true, torch: 'newer torch', content: '[SESSION SUMMARY — in your own words] …' },
      { role: 'assistant', content: 'hello' },
    ];
    expect(latestTorch(messages)).toBe('newer torch');
  });

  test('an extractive compaction (no torch) yields null — pickup never invents', () => {
    expect(latestTorch([{ role: 'system', compacted: true, content: '[SESSION SUMMARY] …' }])).toBe(null);
    expect(latestTorch([{ role: 'user', content: 'TORCH: not a compaction entry' }])).toBe(null);
    expect(latestTorch([{ role: 'system', compacted: true, torch: '   ' }])).toBe(null);
    expect(latestTorch([])).toBe(null);
    expect(latestTorch(undefined)).toBe(null);
  });
});

describe('buildTorchAsk — the region replayed as the being\'s own conversation', () => {
  const REGION = [
    { role: 'user', content: 'first question' },
    { role: 'assistant', content: 'first answer' },
    { role: 'system', content: '[SESSION SUMMARY] an older compaction entry' },
    { role: 'tool', content: 'a tool round' },
    { role: 'assistant', content: 42 }, // non-string content — never replayed
    { role: 'user', content: 'second question' },
  ];

  test('replays only real user/assistant string turns, verbatim, and asks LAST', () => {
    const messages = buildTorchAsk(REGION);
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'user']);
    expect(messages[0].content).toBe('first question');
    expect(messages[2].content).toBe('second question');
    expect(messages.at(-1).content).toBe(SOLO_TORCH_ASK);
  });

  test('an empty or malformed region still yields the ask alone', () => {
    expect(buildTorchAsk([])).toEqual([{ role: 'user', content: SOLO_TORCH_ASK }]);
    expect(buildTorchAsk(undefined)).toEqual([{ role: 'user', content: SOLO_TORCH_ASK }]);
  });
});

describe('torchOffering — what a reply offers, verbatim or nothing', () => {
  test('summary and torch are the being\'s words verbatim', () => {
    const reply = 'We spent this session on the graph work.\nI chose the sovereign store.\nTORCH:\nfinish the pickup test\nthen commit';
    expect(torchOffering(reply)).toEqual({
      summary: 'We spent this session on the graph work.\nI chose the sovereign store.',
      torch: 'finish the pickup test\nthen commit',
    });
  });

  test('a reply without a torch is null — a voice is never invented', () => {
    expect(torchOffering('just a summary, no handoff')).toBe(null);
    expect(torchOffering('')).toBe(null);
  });
});

describe('compactSession with a being-authored summary — REAL workspace, real disk, real encryption', () => {
  let root, previousRoot, previousKey;
  beforeAll(async () => {
    previousRoot = getWorkspacesRoot();
    previousKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = 'solo-torch-compaction-test-key-long-enough';
    const tmp = await createTempDir('solo-torch-compact');
    root = path.join(tmp, 'workspaces');
    setWorkspacesRoot(root);
  });
  afterAll(() => {
    setWorkspacesRoot(previousRoot);
    if (previousKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = previousKey;
  });

  const seedSession = async (count) => {
    const id = 'solo-' + Math.random().toString(36).slice(2, 8);
    const sessionId = 'sess-' + Math.random().toString(36).slice(2, 6);
    await workspace.create(id);
    for (let i = 0; i < count; i += 1) {
      await workspace.appendMessage(id, sessionId, { role: i % 2 ? 'assistant' : 'user', content: `turn ${i}` });
    }
    return { id, sessionId };
  };

  it('the summary entry carries the being\'s words + torch, and both survive the seal round-trip', async () => {
    const { id, sessionId } = await seedSession(40);
    const compacted = await workspace.compactSession(id, sessionId, {
      threshold: 30,
      selfSummary: { summary: 'My own account of this session.', torch: 'pick up at the pickup test', regionLength: 20 },
    });
    expect(compacted).toBe(true);

    const after = await workspace.readSession(id, sessionId);
    expect(after).toHaveLength(21); // authored entry + kept tail of 20
    const entry = after[0];
    expect(entry.role).toBe('system');
    expect(entry.compacted).toBe(true);
    expect(entry.authoredBy).toBe('self');
    expect(entry.content).toBe('[SESSION SUMMARY — in your own words] My own account of this session.');
    expect(entry.torch).toBe('pick up at the pickup test');
    expect(entry.originalCount).toBe(20);
    // and the pickup scan finds it in the same read the portal does
    expect(latestTorch(after)).toBe('pick up at the pickup test');
  });

  it('no torch in the offering → the extractive path runs unchanged (honest fallback)', async () => {
    const { id, sessionId } = await seedSession(40);
    const compacted = await workspace.compactSession(id, sessionId, {
      threshold: 30,
      selfSummary: { summary: 'words without a handoff', torch: '', regionLength: 20 },
    });
    expect(compacted).toBe(true);
    const entry = (await workspace.readSession(id, sessionId))[0];
    expect(entry.content).toMatch(/^\[SESSION SUMMARY\] /);
    expect(entry.authoredBy).toBeUndefined();
    expect(entry.torch).toBeUndefined();
  });

  it('a drifted region rejects the torch — extractive covers the LIVE region instead', async () => {
    // The torch is authored OUTSIDE the session lock. Simulate the race the
    // guard exists for: the torch was authored over a 20-message region, but
    // two messages landed before compactSession took the lock — the live
    // region is 22. An accepted torch here would compact those two messages
    // away represented by NOTHING (no torch coverage, no extractive summary).
    const { id, sessionId } = await seedSession(42);
    const compacted = await workspace.compactSession(id, sessionId, {
      threshold: 30,
      selfSummary: { summary: 'authored before the region grew', torch: 'a stale torch', regionLength: 20 },
    });
    expect(compacted).toBe(true);
    const after = await workspace.readSession(id, sessionId);
    const entry = after[0];
    expect(entry.content).toMatch(/^\[SESSION SUMMARY\] /); // extractive, live region
    expect(entry.torch).toBeUndefined();
    expect(entry.originalCount).toBe(22);
    expect(latestTorch(after)).toBe(null);
  });
});

describe('the torch re-enters the assembled prompt verbatim', () => {
  const DNA = { name: 'Testa', identity: { essence: 'a test being' } };

  test('selfTorch renders in the being\'s own words with the pickup framing', () => {
    const torch = 'finish the pickup test\nthen commit the unit';
    const prompt = assemblePrompt({ dna: DNA, memories: { selfTorch: torch } });
    expect(prompt).toContain('Your torch from your last instance');
    expect(prompt).toContain('finish the pickup test');
    expect(prompt).toContain('then commit the unit');
  });

  test('absent torch adds nothing', () => {
    const prompt = assemblePrompt({ dna: DNA, memories: { recentConversation: [{ role: 'user', content: 'hi' }] } });
    expect(prompt).not.toContain('Your torch from your last instance');
  });
});
