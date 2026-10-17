import process from 'node:process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { URL } from 'node:url';

/** Runs assertions against a fresh real facade, closing its DB before exit. */
// impure — each child owns its facade, environment and real output pipes.
export async function runFacade(source, env) {
  const url = new URL('../../backend/services/platform-db.js', import.meta.url).href;
  return promisify(execFile)(process.execPath, ['--input-type=module', '--eval', `
    import assert from 'node:assert/strict';
    import platform from ${JSON.stringify(url)};
    try { ${source} } finally { platform.driver?.db?.close(); }
  `], {
    env: { ...process.env, SUPABASE_URL: '', SUPABASE_SERVICE_KEY: '', PLATFORM_DB_PATH: ':memory:', LOG_LEVEL: 'debug', ...env },
    timeout: 10000,
    maxBuffer: 128 * 1024,
  });
}

