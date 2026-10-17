/**
 * EACH SEAT GETS EXACTLY ITS OWN TOOL FAMILIES — the real catalog
 * (portal-tool-catalog.js platformToolsFor), read for a harness lane and for
 * a bound being. RULE 0: the real modules, the real families.
 *
 * Found 2026-10-14 walking the harness live: the catalog awaited one more
 * family (`staff`) than it named, so every family after it landed in the
 * wrong variable — the harness seat took the CHAIN tools as its "media", and
 * the last family (the CLO's legal reads) fell off the end for every seat.
 */
import { describe, expect, it } from 'vitest';
import { platformToolsFor } from '../../backend/services/portal-tool-catalog.js';
import { HARNESS_INTENT_TYPES } from '../../backend/services/intents/intents-section.js';
import { intentTypes } from '../../backend/services/intents/registry.js';

const WALLET = '0x0000000000000000000000000000000000000001';
const serversOf = (tools) => [...new Set(tools.map((t) => t.server))].sort();

describe('the tool catalog, seat by seat', () => {
  it('the harness keeps the platform\'s own hands and nothing that presumes a self or a house', async () => {
    const connection = { companion: { neumaId: 'harness-0a1b2c3d', participantKind: 'harness' }, walletAddress: WALLET, space: null };
    const servers = serversOf((await platformToolsFor(connection, { seat: 'harness' })).tools);
    const allowed = ['skill', 'record', 'web', 'media', 'image', 'map', 'press', 'operator', 'plan', 'bench'];
    expect(servers.filter((s) => !allowed.includes(s))).toEqual([]);
    expect(servers).toContain('operator');
    for (const being of ['chain', 'wallet', 'vault', 'memory', 'leads', 'marketing', 'social', 'legal', 'house', 'ksp', 'sovereignty', 'team']) {
      expect(servers, being).not.toContain(being);
    }
  });

  it('a bound being keeps every family — the last one (legal) included', async () => {
    const connection = { companion: { neumaId: 'neuma-orrin' }, walletAddress: WALLET, space: null };
    const names = (await platformToolsFor(connection, { seat: 'neuma' })).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['legal_posture', 'legal_matters_list', 'legal_matter_get', 'chain_balance', 'ask_operator']));
  });

  it('the harness may file only the platform\'s own acts, and each of them exists', () => {
    const known = intentTypes().map((t) => t.name);
    expect(HARNESS_INTENT_TYPES.filter((name) => !known.includes(name))).toEqual([]);
    expect(HARNESS_INTENT_TYPES).not.toContain('memory/pin');
  });
});
