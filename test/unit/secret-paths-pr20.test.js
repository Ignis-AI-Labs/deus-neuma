import { describe, expect, test } from 'vitest';
import { isSecretFile } from '../../backend/services/secret-path-classifier.js';

describe('PR20 M-15/M-16: browser and CLI credential stores are secret-shaped', () => {
  test.each([
    '/home/op/.neuma/data/browsers/other-lane/Default/Login Data',
    '/home/op/.neuma/data/browsers/other-lane/Default/Cookies',
    '/home/op/.mozilla/firefox/abc.default/logins.json',
    '/home/op/.mozilla/firefox/abc.default/key4.db',
    '/home/op/.thunderbird/abc.default/logins.json',
    '/home/op/.config/microsoft-edge/Default/Login Data',
    '/home/op/Library/Application Support/Arc/User Data/Default/Cookies',
    '/home/op/Library/Keychains/login.keychain-db',
    '/home/op/.aws/sso/cache/token.json',
    '/home/op/.config/stripe/config',
    '/home/op/.config/.wrangler/config/default.toml',
    '/home/op/.cache/huggingface/token',
    '/home/op/.gemini/oauth_creds.json',
    '/home/op/.config/github-copilot/apps.json',
    '/home/op/.s3cfg',
    '/home/op/.my.cnf',
    '/home/op/.boto',
    '/home/op/.config/Exodus/seed.seco',
    '/home/op/.config/MetaMask/leveldb/000003.ldb',
  ])('%s is never read by a being', (file) => {
    expect(isSecretFile(file)).toBe(true);
  });

  test('an ordinary project file and a harness html document stay ordinary', () => {
    expect(isSecretFile('/home/op/project/apps.json')).toBe(false);
    expect(isSecretFile('/home/op/project/index.js')).toBe(false);
  });
});
