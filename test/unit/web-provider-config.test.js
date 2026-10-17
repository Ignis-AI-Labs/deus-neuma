import { afterEach, describe, expect, test } from 'vitest';
import { _resetConfig, loadConfig } from '../../backend/config.js';

// Pure config boundary: real schema parse, no environment mutation and no mocks.

afterEach(() => _resetConfig());

describe('Web provider configuration', () => {
  test('is absent by default so zero-credential search and direct fetch remain self-contained', () => {
    const config = loadConfig({});
    expect(config.exaApiKey).toBe('');
    expect(config.cloudflareAccountId).toBe('');
    expect(config.cloudflareApiToken).toBe('');
  });

  test('maps official provider environment names into validated config', () => {
    const config = loadConfig({
      EXA_API_KEY: 'exa-search-key',
      CLOUDFLARE_ACCOUNT_ID: 'account-id',
      CLOUDFLARE_API_TOKEN: 'least-privilege-browser-token',
    });
    expect(config.exaApiKey).toBe('exa-search-key');
    expect(config.cloudflareAccountId).toBe('account-id');
    expect(config.cloudflareApiToken).toBe('least-privilege-browser-token');
  });
});
