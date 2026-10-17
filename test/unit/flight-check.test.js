/**
 * FLIGHT CHECK — the pure layer.
 *
 * Pure functions, real inputs, real outputs; no mock anywhere in the claimed
 * path (RULE 0). The behaviours pinned here are the ones a NARRATED report got
 * wrong in the field on 2026-07-29 — an unstamped tool must not read as open,
 * and the two write reaches must never collapse into one sentence.
 */
import { describe, test, expect } from 'vitest';
import {
  summarizeTools, reachLines, formatFlightCheck, isFlightCheckTool, flightCheckToolsFor,
} from '../../backend/services/flight-check.js';
import { maskRoute } from '../../backend/services/route-view.js';

const report = (over = {}) => ({
  name: 'Bizulen',
  seat: 'witness',
  checkedAt: '2026-07-29T10:00:00.000Z',
  substrate: {
    provider: 'zai-coding-plan', model: 'glm-5.2', endpoint: 'https://api.z.ai/api/coding/paas/v4',
    kind: 'cloud', sovereign: false, source: 'substrate-default', configured: true, reason: null,
  },
  reach: { focusGround: '/workspace/repos/project-nuniver', sandbox: null },
  tools: summarizeTools([]),
  skills: [],
  limits: ['x'],
  ...over,
});

describe('summarizeTools', () => {
  test('groups by the tier each tool actually holds', () => {
    const s = summarizeTools([
      { server: 'filesystem', name: 'read_file', access: 'allowed' },
      { server: 'filesystem', name: 'delete_file', access: 'approval_required' },
      { server: 'coding', name: 'execute', access: 'denied' },
    ]);
    expect(s.total).toBe(3);
    expect(s.byTier.allowed).toEqual(['filesystem/read_file']);
    expect(s.byTier.approval_required).toEqual(['filesystem/delete_file']);
    expect(s.byTier.denied).toEqual(['coding/execute']);
  });

  // checkToolAccess defaults unnamed tools to approval_required. If the report
  // defaulted them to allowed it would promise more than the gate permits.
  test('an UNSTAMPED tool is reported as gated, never as open', () => {
    const s = summarizeTools([{ server: 'x', name: 'y' }]);
    expect(s.byTier.approval_required).toEqual(['x/y']);
    expect(s.byTier.allowed).toEqual([]);
  });

  test('an unknown access value is not trusted into the open tier', () => {
    const s = summarizeTools([{ server: 'x', name: 'y', access: 'totally-fine' }]);
    expect(s.byTier.approval_required).toEqual(['x/y']);
  });

  test('an empty catalog is zero, not an error', () => {
    expect(summarizeTools([]).total).toBe(0);
    expect(summarizeTools(null).total).toBe(0);
  });
});

describe('reachLines — the distinction a narrated report collapses', () => {
  test('the live ground states that writes need no card', () => {
    const text = reachLines({ focusGround: '/repo', sandbox: null }).join('\n');
    expect(text).toContain('/repo');
    expect(text).toMatch(/READ AND WRITE here, with no approval card/);
  });

  test('the shell is named as a live view whose writes land lane-side', () => {
    const text = reachLines({
      focusGround: '/repo',
      sandbox: { workspace: '/lane/ws', sourceRoot: '/repo' },
    }).join('\n');
    expect(text).toContain('live overlay view of /repo');
    expect(text).toContain('/lane/ws');
    expect(text).toMatch(/never on the live folder/);
  });

  test('no focused folder is stated as a real limit, not omitted', () => {
    const text = reachLines({ focusGround: null, sandbox: null }).join('\n');
    expect(text).toContain('none open');
    expect(text).toContain('raises a card');
  });
});

describe('formatFlightCheck', () => {
  test('an unconfigured route says so with its reason, and does not read as ready', () => {
    const text = formatFlightCheck(report({
      substrate: {
        provider: 'zai-coding-plan', model: 'glm-4.5-air', endpoint: 'https://x', kind: 'cloud',
        sovereign: false, source: 'substrate-default', configured: false, reason: 'missing-key',
      },
    }));
    expect(text).toContain('NOT CONFIGURED');
    expect(text).toContain('missing-key');
    expect(text).not.toContain('status        CONFIGURED');
  });

  test('third-party custody is never rendered as sovereign', () => {
    expect(formatFlightCheck(report())).toContain('third-party custody');
  });

  test('the report closes by bounding itself — unlisted means absent', () => {
    const text = formatFlightCheck(report());
    expect(text).toContain('is the WHOLE surface');
    expect(text).toMatch(/does not exist for you/);
  });

  test('every tier present is rendered with its tool names', () => {
    const text = formatFlightCheck(report({
      tools: summarizeTools([
        { server: 'a', name: 'b', access: 'allowed' },
        { server: 'c', name: 'd', access: 'denied' },
      ]),
    }));
    expect(text).toContain('a/b');
    expect(text).toContain('c/d');
    expect(text).toContain('TOOLS — 2 advertised');
  });
});

describe('advertisement and matching', () => {
  test('matches its own call, bare or namespaced', () => {
    expect(isFlightCheckTool({ toolName: 'flight_check' })).toBe(true);
    expect(isFlightCheckTool({ server: 'system', toolName: 'flight_check' })).toBe(true);
  });

  test('does not swallow another server\'s same-named tool', () => {
    expect(isFlightCheckTool({ server: 'other', toolName: 'flight_check' })).toBe(false);
    expect(isFlightCheckTool({ toolName: 'read_file' })).toBe(false);
  });

  test('advertised only where a lane exists', () => {
    expect(flightCheckToolsFor({ companion: { neumaId: 'x' } })).toHaveLength(1);
    expect(flightCheckToolsFor({ companion: {} })).toHaveLength(0);
    expect(flightCheckToolsFor(null)).toHaveLength(0);
  });
});


// THE SUBSTRATE BLOCK'S OWN REGRESSION. Found 2026-07-30 by printing one real
// report: every neuma on the machine's own llama-server read […] and "third-party custody", because the neuma
// resolver stamps neither field and the report trusted them raw. The bar, one
// derivation away, showed the same route live and sovereign. A report that
// understates capacity is the exact failure this tool exists to end — it must
// not commit it about the substrate carrying the turn.
describe('the substrate block reads custody and configured-ness from ONE derivation', () => {
  // Exactly what resolveNeumaRoute returns: no `sovereign`, no `configured`.
  const RESOLVED_LOCAL = Object.freeze({
    provider: 'llama-server',
    model: 'gemma-4-31B-it-Q8_0.gguf',
    endpoint: 'http://localhost:8089',
    kind: 'local',
    source: 'machine-default',
    reason: null,
  });

  test("the operator's own weights are SOVEREIGN, and silence is not a refusal", () => {
    const masked = maskRoute(RESOLVED_LOCAL);
    expect(masked.sovereign).toBe(true);
    expect(masked.configured).toBe(true);
    const text = formatFlightCheck(report({ seat: 'neuma', substrate: masked }));
    expect(text).toContain("sovereign — weights in this house's custody");
    expect(text).toContain('CONFIGURED — this route can carry a turn');
    expect(text).not.toContain('NOT CONFIGURED');
  });

  test('custody comes from the CATALOG, never from the transport', () => {
    // docs/protocols/sovereignty-boundary.md — `sovereign` is its own axis. Every local
    // engine serves the operator's own weights, so all three are sovereign…
    for (const provider of ['llama-server', 'lm-studio', 'ollama']) {
      expect(maskRoute({ ...RESOLVED_LOCAL, provider }).sovereign).toBe(true);
    }
    // …and a vendor's model is not, however it is reached. A being reading
    // "sovereign" for foreign custody would be the boundary blurred at the one
    // place the operator goes to check it.
    const vendor = maskRoute({
      provider: 'zai-coding-plan', model: 'glm-5.2', kind: 'cloud', source: 'witness-default',
    });
    expect(vendor.sovereign).toBe(false);
    expect(formatFlightCheck(report({ substrate: vendor }))).toContain('third-party custody');
  });

  test('a resolver that DOES refuse keeps its refusal and its reason', () => {
    const masked = maskRoute({
      provider: 'zai-coding-plan', model: 'glm-5.2', kind: 'cloud',
      source: 'witness-default', configured: false, reason: 'no credential',
    });
    expect(masked.configured).toBe(false);
    expect(formatFlightCheck(report({ substrate: masked })))
      .toContain('NOT CONFIGURED — no credential; turns will refuse');
  });

  test('the apiKey never survives the crossing', () => {
    const masked = maskRoute({ ...RESOLVED_LOCAL, apiKey: 'sk-do-not-print-me' });
    expect(JSON.stringify(masked)).not.toContain('sk-do-not-print-me');
    expect(formatFlightCheck(report({ substrate: masked }))).not.toContain('sk-do-not-print-me');
  });
});
