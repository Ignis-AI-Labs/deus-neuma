/**
 * SETTINGS → API → CHANNEL KEYS, the YouTube card, rendered for real
 * (react-dom/server) from the board the REAL registry masks: the refresh
 * token is never an input, CONNECT waits for the client id and secret, and a
 * connected channel is named by its title. No mocks: real components, real
 * i18n catalog, real masking.
 */
import { describe, expect, test } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import '../../frontend/i18n/index.js';
import { ChannelKeysSection } from '../../frontend/app/RelinkShell/ChannelKeysSection.jsx';
import { getChannel, maskChannelCredentials } from '../../backend/services/social/channel-registry.js';

const youtube = getChannel('youtube');
const render = (store, test = null) => renderToStaticMarkup(createElement(ChannelKeysSection, {
  channels: [maskChannelCredentials(youtube, store, {})],
  tests: test ? { youtube: test } : {},
  error: null,
  onChanged: async () => {},
  onRetest: () => {},
  stateFilter: '',
  openKey: 'channel:youtube',
  onOpen: () => {},
}));

describe('the YouTube card', () => {
  test('nothing saved: two inputs (never the refresh token), CONNECT waits for the client', () => {
    const html = render(undefined);
    expect(html).toContain('placeholder="OAuth Client ID (Desktop app)"');
    expect(html).toContain('placeholder="OAuth Client Secret"');
    expect(html).not.toContain('Refresh Token');
    expect(html).toContain('NOT CONNECTED');
    expect(html).toContain('Save the OAuth client id and secret first, then CONNECT.');
    expect(html).toMatch(/<button type="button" class="settings-set" disabled="">CONNECT<\/button>/);
  });

  test('client saved, not yet connected: CONNECT is armed', () => {
    const html = render({ clientId: 'cid', clientSecret: 'secret' });
    expect(html).toMatch(/<button type="button" class="settings-set">CONNECT<\/button>/);
    expect(html).not.toContain('Save the OAuth client id');
    expect(html).not.toContain('secret"'); // the secret's value never renders
  });

  test('connected: the channel named by its title from the live flight test, RECONNECT offered', () => {
    const html = render(
      { clientId: 'cid', clientSecret: 'secret', refreshToken: 'rt' },
      { ok: true, account: { id: 'UC-house', name: 'deusneuma', title: 'Deus Neuma' } },
    );
    expect(html).toContain('CONNECTED · Deus Neuma');
    expect(html).toContain('RECONNECT');
    expect(html).toContain('FLIGHT ✓ @deusneuma');
    expect(html).not.toContain('>rt<');
  });
});
