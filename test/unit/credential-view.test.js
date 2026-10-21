/**
 * SETTINGS → API as one map, navigated by state: every credential in one state vocabulary, read
 * only from the boards' masked truth. Pure functions over board-shaped input,
 * and the map rendered for real (react-dom/server).
 */
import { describe, expect, test } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  channelItem, credentialItems, emailItem, groupItems, passesState, serviceItem, stateCounts,
} from '../../frontend/app/RelinkShell/credential-view.js';
import { CredentialMap } from '../../frontend/app/RelinkShell/CredentialMap.jsx';

const BOARD = {
  channels: [
    { id: 'x', name: 'X', configured: true },
    { id: 'telegram', name: 'Telegram', configured: true },
    { id: 'discord', name: 'Discord', configured: true },
    { id: 'bluesky', name: 'Bluesky', configured: false },
  ],
  tests: {
    x: { ok: true, account: { name: 'Umbrae_Ignis' } },
    telegram: { ok: false, detail: '401 Unauthorized' },
  },
  services: [
    { id: 'exa', name: 'Exa', group: 'Web search', hasKey: true, requiresKey: true, source: 'stored' },
    { id: 'brave', name: 'Brave', group: 'Web search', hasKey: false, requiresKey: true, source: null },
    { id: 'rpc-base', name: 'Base mainnet RPC address', group: 'Chain RPC', hasKey: true, requiresKey: true, source: 'env' },
    { id: 'searxng', name: 'SearXNG', group: 'Web search', hasKey: false, requiresKey: false, source: null },
  ],
  email: { name: 'House mailbox', configured: true, binding: null },
};

describe('a credential state is only what the board proves', () => {
  test('a channel is PROVEN only by a flight test that answered', () => {
    expect(channelItem(BOARD.channels[0], BOARD.tests.x)).toMatchObject({ state: 'proven', detail: '@Umbrae_Ignis' });
    expect(channelItem(BOARD.channels[1], BOARD.tests.telegram)).toMatchObject({ state: 'failing', detail: '401 Unauthorized' });
    expect(channelItem(BOARD.channels[2], undefined)).toMatchObject({ state: 'set', detail: 'not yet tested' });
    expect(channelItem(BOARD.channels[3], undefined)).toMatchObject({ state: 'missing', detail: null });
  });

  test('a service has no test: SET is the most it can be, and where its value comes from is said', () => {
    expect(BOARD.services.map(serviceItem).map((i) => [i.state, i.detail])).toEqual([
      ['set', 'saved here'], ['missing', null], ['set', 'from the env file'], ['keyless', null],
    ]);
  });

  test('the mailbox: set when connected, its holder the detail; absent board = no item', () => {
    expect(emailItem(BOARD.email)).toMatchObject({ state: 'set', detail: 'no being holds it' });
    expect(emailItem(null)).toBeNull();
  });

  test('counts, groups and the filter over the whole tab', () => {
    const items = credentialItems(BOARD);
    expect(items).toHaveLength(9);
    expect(stateCounts(items)).toEqual({ failing: 1, missing: 2, set: 4, proven: 1, keyless: 1 });
    expect(groupItems(items).map((g) => [g.group, g.items.length])).toEqual([
      ['CHANNELS', 4], ['WEB SEARCH', 3], ['CHAIN RPC', 1], ['EMAIL', 1],
    ]);
    expect(items.filter((i) => passesState(i, 'missing')).map((i) => i.id)).toEqual(['bluesky', 'brave']);
    expect(items.filter((i) => passesState(i, '')).length).toBe(9);
    expect(credentialItems()).toEqual([]);
  });
});

describe('the map, rendered', () => {
  test('every state with credentials is a door; every credential a tile', () => {
    const html = renderToStaticMarkup(createElement(CredentialMap, {
      items: credentialItems(BOARD), stateFilter: '', onState: () => {}, onOpen: () => {},
    }));
    expect(html).toContain('<b>1</b>FAILING');
    expect(html).toContain('<b>2</b>NOT SET');
    expect(html).toContain('OF 9');
    expect((html.match(/class="cred-tile /g) || []).length).toBe(9);
    expect(html).toContain('CHANNELS<span>2/4</span>');
  });

  test('under a filter, the other tiles dim and the lit door says so', () => {
    const html = renderToStaticMarkup(createElement(CredentialMap, {
      items: credentialItems(BOARD), stateFilter: 'missing', onState: () => {}, onOpen: () => {},
    }));
    expect(html).toContain('aria-pressed="true"');
    expect((html.match(/is-dim/g) || []).length).toBe(7);
  });

  test('nothing read yet draws nothing', () => {
    expect(renderToStaticMarkup(createElement(CredentialMap, { items: [], stateFilter: '', onState: () => {}, onOpen: () => {} }))).toBe('');
  });
});
