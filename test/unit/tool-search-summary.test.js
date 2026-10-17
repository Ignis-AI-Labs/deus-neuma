// The line the operator reads for a tool_search names the tools it activated — never a bare
// […] (Design note, 2026-10-10: […]). Proven on the
// pure summary and on discloseTurnTools over the REAL tool definitions.
import { describe, expect, test } from 'vitest';
import { toolSearchSummary } from '../../backend/services/tool-search-summary.js';
import { discloseTurnTools, TOOL_SEARCH_TOOL } from '../../backend/services/being-tool-surface.js';
import { FS_PRIMITIVE_TOOLS } from '../../backend/services/fs-primitives.js';
import { WEB_TOOLS } from '../../backend/services/web-being-tools.js';
import { MIND_TOOLS } from '../../backend/services/mind-tools.js';

const ok = (activated) => ({ status: 'ok', activated });

describe('the tool_search line', () => {
  test('one tool reads whole', () => {
    expect(toolSearchSummary(ok(['team/run']))).toBe('activated team/run');
  });

  test('several group by server, the server prefix dropped from each name', () => {
    expect(toolSearchSummary(ok(['chain/chain_balance', 'chain/chain_call', 'chain/chain_logs', 'chain/chain_token'])))
      .toBe('activated chain: balance, call, logs, token');
    expect(toolSearchSummary(ok(['chain/chain_balance', 'team/run', 'chain/chain_call'])))
      .toBe('activated chain: balance, call · team: run');
  });

  test('a long set stays one line and says how many more', () => {
    const ids = Array.from({ length: 30 }, (_, i) => `fs/fs_long_tool_name_${i}`);
    const line = toolSearchSummary(ok(ids));
    expect(line.length).toBeLessThanOrEqual(110 + ' +NN more'.length);
    const shown = line.split(', ').length;
    expect(line).toMatch(new RegExp(`\\+${30 - shown} more$`));
  });

  test('no match, an intent, and a failure each say what happened', () => {
    expect(toolSearchSummary(ok([]), ' nft mint ')).toBe('no tool matched "nft mint"');
    expect(toolSearchSummary({ status: 'ok', intent: 'team/run' })).toBe('read the team/run intent');
    expect(toolSearchSummary({ status: 'error', error: 'query must name a tool' })).toBe('tool search failed — query must name a tool');
  });
});

describe('discloseTurnTools carries the line for what it really activated', () => {
  const CATALOG = Object.freeze([TOOL_SEARCH_TOOL, ...FS_PRIMITIVE_TOOLS, ...WEB_TOOLS, ...MIND_TOOLS]);

  test('the summary names exactly the tools the search found — it activates nothing (2026-10-14)', () => {
    const connection = { _turnCatalog: CATALOG, _turnDisclosedToolIds: new Set() };
    const result = discloseTurnTools(connection, { query: 'fs list read write' });
    expect(result.found.length).toBeGreaterThan(1);
    expect(result.activated).toEqual([]);
    expect(result.summary).toBe(toolSearchSummary(result));
    expect(result.summary).toMatch(/^found /);
    expect(result.summary).not.toMatch(/schema|activated/);
    for (const id of result.found) expect(result.summary).toContain(id.split('/')[1].replace(/^fs_/, ''));
  });

  test('an empty query says it failed, and activates nothing', () => {
    const connection = { _turnCatalog: CATALOG, _turnDisclosedToolIds: new Set() };
    expect(discloseTurnTools(connection, { query: '' }).summary).toMatch(/^tool search failed/);
  });
});
