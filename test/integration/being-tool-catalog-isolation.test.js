/**
 * Two concurrent neuma turns must never share their catalogs or persisted web
 * truth — and one turn's search never moves another's wire (the wire is the
 * two doors, always: tool-hud.js). Real disk settings + production catalog
 * state; no mocks.
 */
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  discloseTurnTools,
  disclosedNativeTools,
  stashBeingTurnCatalog,
  TOOL_DOORS,
} from '../../backend/services/being-tool-surface.js';
import { webToolsFor } from '../../backend/services/web-being-tools.js';
import { createWebSettings } from '../../backend/services/web-settings.js';

const connectionFor = (neumaId) => ({
  companion: { name: neumaId, neumaId, participantKind: 'neuma' },
  toolMode: 'auto',
  _sessionToolPolicy: null,
});

const webIds = (connection) => JSON.parse(
  discloseTurnTools(connection, { query: 'web research' }).content,
).tools.map(({ id }) => id);

describe('concurrent neuma tool catalog isolation', () => {
  let root;

  beforeEach(async () => {
    root = await createTempDir('neuma-tool-catalog-isolation');
  });

  it('keeps each turn\'s catalog and an OFF→ON persisted switch isolated between two turns', async () => {
    const settings = createWebSettings({ path: path.join(root, 'web-access.json'), env: {} });
    const first = connectionFor('lane-first');
    const second = connectionFor('lane-second');
    const catalog = async (connection) => [...TOOL_DOORS, ...await webToolsFor(connection, settings)];
    const DOORS = ['tool_search', 'call'];

    await settings.setEnabled(false);
    await Promise.all([
      stashBeingTurnCatalog(first, await catalog(first), []),
      stashBeingTurnCatalog(second, await catalog(second), []),
    ]);

    expect(webIds(first)).toEqual(['web/image_search', 'web/web_fetch', 'web/web_search']);
    expect(disclosedNativeTools(first).map(({ name }) => name)).toEqual(DOORS);
    expect(disclosedNativeTools(second).map(({ name }) => name)).toEqual(DOORS);
    expect(first._turnCatalog.filter(({ server }) => server === 'web')
      .every(({ description }) => description.includes('[HELD — web access is OFF'))).toBe(true);

    await settings.setEnabled(true);
    expect(await settings.isEnabled()).toBe(true);
    expect(first._turnCatalog.filter(({ server }) => server === 'web')
      .every(({ description }) => description.includes('[HELD — web access is OFF'))).toBe(true);

    await stashBeingTurnCatalog(second, await catalog(second), []);
    expect(second._turnCatalog.filter(({ server }) => server === 'web')
      .every(({ description }) => !description.includes('[HELD'))).toBe(true);
    expect(disclosedNativeTools(first).map(({ name }) => name)).toEqual(DOORS);
    expect(disclosedNativeTools(second).map(({ name }) => name)).toEqual(DOORS);
  });
});
