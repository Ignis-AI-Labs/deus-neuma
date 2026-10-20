import fs from 'fs/promises';
import { mkdtempSync, rmSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import os from 'os';

// THE OPERATOR'S .env NEVER REACHES THE HERMETIC SUITE. The `natural` package
// (core/memory/neuma-recall.js, reached through core/index.js by most backend
// tests) runs require('dotenv').config() at load time in its storage
// adapters (natural/lib/natural/util/storage/{Postgres,MongoDB,Redis,
// Memcached}.js). dotenv reads process.cwd()/.env — the repo root under
// vitest — so on a working rig every test that touched core quietly booted
// the developer's real machine config (LLAMA_SERVER_MODEL, CHAIN_ID, RPC
// URLs, OLLAMA_URL, ...), and the same files passed on a fresh clone and
// failed on the operator's box. Loading those adapters once here, from an
// empty directory, makes their dotenv call read nothing; the CJS cache then
// serves the already-loaded modules to every later import. The live lane
// still boots the real config on purpose (test/helpers/live-machine-config.js
// calls dotenv itself).
{
  const here = process.cwd();
  const empty = mkdtempSync(path.join(os.tmpdir(), 'neuma-no-dotenv-'));
  try {
    process.chdir(empty);
    createRequire(import.meta.url)('natural/lib/natural/util/storage');
  } finally {
    process.chdir(here);
    rmSync(empty, { recursive: true, force: true });
  }
}

// Set test environment
process.env.NODE_ENV = 'test';
process.env.DNA_ENCRYPTION_KEY = 'test-encryption-key-32-characters!';
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_KEY = '';
process.env.PORT = String(10000 + Math.floor(Math.random() * 50000));

// QUIET BY DEFAULT — one place, instead of 640 spies.
//
// Suites used to open with `vi.spyOn(console, 'log').mockImplementation(() => {})`
// repeated in ~200 files, purely to keep the runner readable. That is noise
// suppression, not a test double — but it matched every […] audit and inflated the real figure by roughly 3x, which made the
// Rule 0 debt impossible to see (#390 tranche 2).
//
// Silencing here means a test never has to think about it. Set TEST_LOGS=1
// (or VERBOSE=1) to get every line back when you are diagnosing something —
// silence you cannot switch off is its own kind of dishonest instrument.
//
// A test that ASSERTS on a log still spies as usual: vi.spyOn wraps whatever
// function is present, so those keep working unchanged.
if (process.env.TEST_LOGS !== '1' && process.env.VERBOSE !== '1') {
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    console[level] = () => {};
  }
}

const TEST_TEMP_DIR = path.join(os.tmpdir(), `neuma-test-${process.pid}`);

globalThis.__TEST_TEMP_DIR__ = TEST_TEMP_DIR;

// THE LIVE CLAIM IS NEVER A TEST'S TO TOUCH. The substrate claim and model
// selection (~/.neuma/substrate-claim.json, substrate-selection.json) name
// what the machine's llama-server actually serves. Serving tests call
// clearClaim/clearSelection, and with the real HOME they erased the live
// pair (2026-09-30: a full `vitest run test/integration` did, and every
// benchmark lane then resolved to the env default and refused the served
// model). Every test run gets its own claim dir unless it names one;
// the live lane seeds a COPY of the machine's truth (live-machine-config.js).
if (!process.env.NEUMA_SUBSTRATE_CLAIM_DIR) {
  process.env.NEUMA_SUBSTRATE_CLAIM_DIR = path.join(TEST_TEMP_DIR, 'substrate-claim');
}
// The beings' kept working sets (sitting-disclosure.js) — a test's calls never
// land in the machine's settings.
if (!process.env.NEUMA_WORKING_SET_PATH) {
  process.env.NEUMA_WORKING_SET_PATH = path.join(TEST_TEMP_DIR, 'working-sets.json');
}
// …and each chat's kept tool list (the same module) — never the machine's.
if (!process.env.NEUMA_CHAT_TOOLS_PATH) {
  process.env.NEUMA_CHAT_TOOLS_PATH = path.join(TEST_TEMP_DIR, 'chat-tools.json');
}
// The served model's kept reasoning shape (think-shape-store.js) — never the machine's.
if (!process.env.NEUMA_THINK_SHAPES_PATH) {
  process.env.NEUMA_THINK_SHAPES_PATH = path.join(TEST_TEMP_DIR, 'think-shapes.json');
}

// THE OPERATOR'S REALM AND DATA ARE NEVER A TEST'S TO WRITE. Without these
// doors the realm defaulted to ~/.kenorie/realm and the data root to the
// repo's data/ — the live desk's own stores — and about twenty modules
// capture their settings dir at import. Suites wrote there: 1600+ wallet dirs
// and test-named chats in the realm (audit 3 E7, 2026-10-19) and the desk's
// provider choice (data/settings-store/llm-provider.json) overwritten. The
// doors are read at import, so they are set here, before any test file loads;
// a test that names its own root still wins.
const ISOLATION_DOORS = Object.freeze({
  NEUMA_REALM_ROOT: 'realm',
  NEUMA_DATA_ROOT: 'data',
  NEUMA_PROVIDER_CHOICE_PATH: path.join('data', 'settings-store', 'llm-provider.json'),
  NEUMA_VAULT_ROOT: 'vault',
  NEUMA_ROOT_LOCK_PATH: 'root-lock.json',
  NEUMA_SECRETS_FILE: 'secrets.json',
  NEUMA_SKILLS_ROOT: 'skills',
  NEUMA_VOICE_DATA_ROOT: 'voice',
});
for (const [door, relative] of Object.entries(ISOLATION_DOORS)) {
  if (!process.env[door]) process.env[door] = path.join(TEST_TEMP_DIR, relative);
}

beforeAll(async () => {
  await fs.mkdir(TEST_TEMP_DIR, { recursive: true });
});

afterAll(async () => {
  try {
    await fs.rm(TEST_TEMP_DIR, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});
