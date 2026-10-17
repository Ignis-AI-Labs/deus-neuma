import fs from 'fs/promises';
import path from 'path';
import os from 'os';

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
