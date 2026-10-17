// substrate-live lane bootstrap — load THIS machine's real serving config,
// exactly the way the backend boots (server.js: dotenv.config() → loadConfig()).
//
// Without this, llm-provider's getConfig() silently falls back to its built-in
// lm-studio:1234 defaults (the bare-driver trap, feedback 2026-07-09): every
// live stream then points at LM Studio, which — by serving law — never has a
// model loaded, and the whole lane fails with "No models loaded" 400s that
// read like substrate outages. The live lane exists to prove the REAL serving
// path, so it must resolve the same provider the app does (llama-server :8089
// on this rig).
//
// Scoped to the substrate-live vitest project ONLY: the hermetic suite must
// keep running config-less so unit tests that pin the not-loaded fallback
// behavior stay honest.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';
import { loadConfig } from '../../backend/config.js';

dotenv.config();

// THE REAL KEY, or this lane can only prove things about beings that do not
// exist. test/setup.js runs FIRST in setupFiles and pins
// DNA_ENCRYPTION_KEY='test-encryption-key-32-characters!' — correct for the
// hermetic suite, fatal here — and dotenv does not override an env var that is
// already set. So every live test reaching for a real house member decrypted
// nothing, found nothing, and said "no members" as though the house were empty
// (found 2026-08-24, running the first live proof that actually opened a real
// workspace). Restored surgically: the key and the workspace roots ONLY.
// NODE_ENV=test and setup.js's random PORT stay exactly as they are — a live
// lane still runs under the test harness, it just has to be able to SEE.
const REAL_ENV_KEYS = Object.freeze([
  'DNA_ENCRYPTION_KEY', 'NEUMA_WORKSPACES_ROOT', 'NEUMA_WITNESSES_ROOT', 'NEUMA_VAULT_ROOT',
]);
const fromFile = dotenv.config({ processEnv: {} }).parsed || {};
for (const key of REAL_ENV_KEYS) {
  if (fromFile[key]) process.env[key] = fromFile[key];
}

// The machine's serving truth, READ-ONLY: the live lane sees the real claim
// and selection through a COPY in its own claim dir (test/setup.js), so a
// serving test that clears or rewrites them never touches ~/.neuma.
fs.mkdirSync(process.env.NEUMA_SUBSTRATE_CLAIM_DIR, { recursive: true });
for (const name of ['substrate-claim.json', 'substrate-selection.json']) {
  const real = path.join(os.homedir(), '.neuma', name);
  if (fs.existsSync(real)) fs.copyFileSync(real, path.join(process.env.NEUMA_SUBSTRATE_CLAIM_DIR, name));
}

loadConfig();
