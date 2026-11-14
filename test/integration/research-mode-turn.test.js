/**
 * RESEARCH MODE (Design note, 2026-11-14: […]). The harness keeps the count of what was searched and actually
 * read; a turn that tries to finish below the floor is sent back, then asked for the report, and the
 * report is kept in the being's workspace with the sources it read.
 *
 * The REAL tool loop (runToolRounds) against a REAL loopback provider scripted as the lazy model the
 * report is about (it keeps answering early, and reads nothing), on a REAL lane under a temp
 * workspaces root, over a REAL signed socket (harness-turn-kit). The ledger is fed the shapes the
 * real web tools return (renderPage's text opens with the final URL) — the tests stay off the
 * network, and the fetch tool refuses loopback pages by design.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createHarnessTurnKit } from '../helpers/harness-turn-kit.js';
import { startLocalProvider } from '../helpers/local-provider.js';
import { runToolRounds } from '../../backend/services/portal-turn-rounds.js';
import { openTurnRecord, closeTurnRecord } from '../../backend/services/tool-action-record.js';
import { renderPage } from '../../backend/services/web-being-tools.js';
import {
  RESEARCH_FLOOR, RESEARCH_DRY_RETURNS, RESEARCH_MAX_RETURNS, finishResearchTurn, noteResearchRound, researchModeSection, researchNextStep,
} from '../../backend/services/research-mode.js';
import workspace from '../../core/workspace/neuma-workspace.js';

const REPORT = '# Coffee prices in 2026\n\n## SUMMARY\nPrices rose [1].\n\n## FINDINGS\n...\n\n## OPEN QUESTIONS AND LIMITS\nFew pages could be read.';
let kit; let provider;

beforeEach(async () => {
  kit = await createHarnessTurnKit('research-mode-proof');
  provider = await startLocalProvider();
  openTurnRecord(kit.ws);
});

afterEach(async () => {
  closeTurnRecord(kit.ws);
  await provider?.close();
  await kit?.close();
});

const lastUser = (body) => [...body.messages].reverse().find((m) => m.role === 'user')?.content || '';
const runTurn = () => runToolRounds({
  ws: kit.ws, connection: kit.connection, companion: kit.connection.companion,
  companionName: 'ResearchFixture', voiceDNA: null,
  messages: [{ role: 'system', content: 'Research the question.' }, { role: 'user', content: 'What happened to coffee prices this year?' }],
  preset: { temperature: 0, maxTokens: 2048 },
  nativeToolsForRound: () => [],
  interrupt: kit.connection.activeTurn,
  route: { provider: 'lm-studio', endpoint: provider.endpoint, model: 'test-model', apiKey: '' },
  turnLora: null, turnEffort: null, take: { turnId: 'research-proof', takeIndex: 1 },
  turnCapabilities: null, contextSections: [], contextBudget: null, contextScope: {},
});

describe('a lazy model in RESEARCH', () => {
  test('is sent back to the work, then asked for the report, and the report is kept with its sources', async () => {
    kit.connection.chatMode = 'research';
    // the model only talks: it is not exhausted, it is not researching, so it is sent back every time
    provider.setScript([
      ...Array.from({ length: RESEARCH_MAX_RETURNS + 1 }, (_, i) => ({ reply: `Coffee got more expensive (${i}).` })),
      { reply: REPORT },
    ]);
    const result = await runTurn();
    expect(result.error).toBeNull();
    expect(provider.turns).toHaveLength(RESEARCH_MAX_RETURNS + 2);
    // each early stop went back to the work, saying what is missing
    for (const turn of provider.turns.slice(1, 1 + RESEARCH_MAX_RETURNS)) {
      expect(lastUser(turn)).toContain('[RESEARCH] Not done yet. You have read 0 page(s) across 0 search(es).');
      expect(lastUser(turn)).toContain(`at least ${RESEARCH_FLOOR.sources} pages read`);
    }
    // the returns are spent: the report is asked for, and it must say the reading fell short
    const ask = lastUser(provider.turns.at(-1));
    expect(ask).toContain('[RESEARCH] Write the report now.');
    expect(ask).toContain('say so plainly under OPEN QUESTIONS AND LIMITS');
    expect(result.latestResponse).toBe(REPORT);

    const saved = await finishResearchTurn(kit.connection, result.latestResponse, { ws: kit.ws, companion: kit.connection.companion });
    expect(saved).toMatchObject({ sources: 0, searches: 0 });
    expect(saved.file).toMatch(/^research\/\d{4}-\d{2}-\d{2}-coffee-prices-in-2026\.md$/);
    const text = await fs.readFile(path.join(workspace.pathFor(kit.laneId), saved.file), 'utf8');
    expect(text.startsWith(REPORT)).toBe(true);
    expect(text).toContain('## Sources\n\n(none read)');
    expect(kit.connection._research).toBeUndefined();
  }, 60_000);

  test('outside RESEARCH the same model ends the turn on its first answer, unchanged', async () => {
    kit.connection.chatMode = 'default';
    provider.setScript([{ reply: 'Coffee got more expensive.' }]);
    const result = await runTurn();
    expect(provider.turns).toHaveLength(1);
    expect(result.latestResponse).toBe('Coffee got more expensive.');
    expect(researchModeSection(kit.connection)).toBe('');
  }, 60_000);
});

describe('the ledger counts what was read, not what was found', () => {
  const read = (url, finalUrl = url) => ({
    act: { tool: 'web/web_fetch', server: 'web', toolName: 'web_fetch', args: { url } },
    result: { tool: 'web/web_fetch', status: 'ok', content: renderPage({ url: finalUrl, status: 200, title: 'A page', text: 'body' }, '2026-11-14T00:00:00.000Z') },
  });
  const search = (query) => ({ act: { tool: 'web/web_search', args: { query } }, result: { tool: 'web/web_search', status: 'ok', content: 'results…' } });
  const round = (connection, ...steps) => noteResearchRound(connection, steps.map((s) => s.act), steps.map((s) => s.result));

  test('a page counts once, by the URL it was read at; a failed read and a search result never count', () => {
    const connection = { chatMode: 'research' };
    round(connection, search('coffee prices 2026'), read('https://a.example/x', 'https://a.example/x?final'), read('https://a.example/x', 'https://a.example/x?final'));
    round(connection, { act: { tool: 'web/web_fetch', args: { url: 'https://b.example' } }, result: { tool: 'web/web_fetch', status: 'error', error: 'HTTP 404' } });
    expect(connection._research.sources).toEqual(['https://a.example/x?final']);
    expect(connection._research.searches.size).toBe(1);
  });

  test('searching that finds nothing new, twice in a row, is exhausted: the report is asked for, limits said', () => {
    const connection = { chatMode: 'research' };
    round(connection, search('angle 0'), read('https://one.example/a'));
    const messages = [];
    expect(researchNextStep(connection, { messages, roundResponse: 'early' })).toBe('continue'); // new read: back to work
    expect(messages.at(-1).content).toContain('Not done yet');
    for (let i = 1; i <= RESEARCH_DRY_RETURNS; i += 1) {
      round(connection, search(`angle ${i}`)); // searched, read nothing new
      researchNextStep(connection, { messages, roundResponse: 'early' });
    }
    expect(messages.at(-1).content).toContain('[RESEARCH] Write the report now.');
    expect(messages.at(-1).content).toContain('say so plainly under OPEN QUESTIONS AND LIMITS');
  });

  test('at the floor the turn is asked for the report, its sources numbered for citation', () => {
    const connection = { chatMode: 'research' };
    for (let i = 0; i < RESEARCH_FLOOR.searches; i += 1) round(connection, search(`angle ${i}`));
    for (let i = 0; i < RESEARCH_FLOOR.sources; i += 1) round(connection, read(`https://site${i}.example/page`));
    const messages = [];
    expect(researchNextStep(connection, { messages, roundResponse: 'I think I have enough.' })).toBe('continue');
    expect(messages.at(-1).content).toContain('[RESEARCH] Write the report now.');
    expect(messages.at(-1).content).not.toContain('say so plainly');
    expect(messages.at(-1).content).toContain(`[${RESEARCH_FLOOR.sources}] https://site${RESEARCH_FLOOR.sources - 1}.example/page`);
    // the next stop is the report: the turn ends
    expect(researchNextStep(connection, { messages, roundResponse: REPORT })).toBe(null);
  });
});
