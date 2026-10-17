/**
 * Substrate ignition — wake the local LLM substrate from inside NEUMA.
 *
 * A neuma whose substrate is down cannot think, and the witness should not
 * have to leave the app to relight it. This service drives the LM Studio
 * CLI (`lms`) to start the local server and load the configured model.
 *
 * Pure planning/parsing is separated from the exec boundary so the decision
 * logic is provable by direct test; the exec wrappers are `// impure` and
 * proven by integration tests against the real CLI (RULE 0 — no mocks).
 *
 * Only LM Studio is supported for ignition today — it is the reference
 * local provider. Other providers still report status honestly.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const execFileAsync = promisify(execFile);

const LOAD_TIMEOUT_MS = 10 * 60 * 1000; // a 70GB model can take minutes
const CLI_TIMEOUT_MS = 15 * 1000;
const MIN_CONTEXT = 512;
const MAX_CONTEXT = 1048576;

/** Model keys as LM Studio names them — path-like, never shell-meaningful. Pure. */
export const isValidModelKey = (key) =>
  typeof key === 'string' && /^[\w.@/-]+$/.test(key) && key.length <= 256;

/** Context length within LM Studio's plausible bounds. Pure. */
export const isValidContextLength = (n) =>
  Number.isInteger(n) && n >= MIN_CONTEXT && n <= MAX_CONTEXT;

/**
 * Loaded-model rows from an `lms ps --json` payload. Pure.
 * @param {unknown} json
 * @returns {Array<{identifier: string, modelKey: string, status: string, contextLength: number}>}
 */
export const parseLoadedModels = (json) =>
  Array.isArray(json)
    ? json.map((m) => ({
        identifier: m.identifier || '',
        modelKey: m.modelKey || '',
        status: m.status || 'unknown',
        contextLength: m.contextLength || 0,
      })).filter((m) => m.modelKey)
    : [];

/**
 * Is the target model already among the loaded ones? Matches on modelKey OR
 * identifier — LM Studio lets a load take a custom identifier. Pure.
 */
export const isTargetLoaded = (targetKey, loaded) =>
  loaded.some((m) => m.modelKey === targetKey || m.identifier === targetKey);

// impure — the lms binary lives outside PATH when the backend runs as an
// Electron child; resolve the known install location first
const lmsBin = () => {
  const installed = join(homedir(), '.lmstudio', 'bin', 'lms');
  return existsSync(installed) ? installed : 'lms';
};

// impure — run lms with args; rejects on non-zero exit
const lms = (args, timeout = CLI_TIMEOUT_MS) =>
  execFileAsync(lmsBin(), args, { timeout, encoding: 'utf8' });

// impure — loaded models from the real CLI; [] when lms is unavailable or
// the LM Studio daemon is down (an unreachable substrate has nothing loaded)
export const listLoadedModels = async () => {
  try {
    const { stdout } = await lms(['ps', '--json']);
    return parseLoadedModels(JSON.parse(stdout));
  } catch {
    return [];
  }
};

// impure — is the lms CLI present on this machine at all?
export const isCliAvailable = async () => {
  try {
    await lms(['version']);
    return true;
  } catch {
    return false;
  }
};

// Ignition is a single-flight operation: one load at a time, its lifecycle
// observable through getIgnitionStatus() so the desk can poll honestly.
let inflight = null; // { modelKey, startedAt } while a load runs
let lastError = null; // { modelKey, error, at } from the most recent failure

// impure — start server (idempotent) then load the model; resolves when the
// model is loaded. Errors are captured for status, then rethrown.
const runIgnition = async (modelKey, contextLength) => {
  try {
    await lms(['server', 'start']);
    await lms(
      ['load', modelKey, '--context-length', String(contextLength), '-y'],
      LOAD_TIMEOUT_MS
    );
    lastError = null;
  } catch (error) {
    lastError = { modelKey, error: error.message, at: new Date().toISOString() };
    throw error;
  } finally {
    inflight = null;
  }
};

/**
 * Begin igniting the substrate. Returns immediately with the outcome of the
 * attempt to START the load — completion is observed via getIgnitionStatus().
 * Impure.
 * @param {{modelKey: string, contextLength: number}} target
 * @returns {Promise<{status: 'already-loaded'|'igniting'|'ignition-in-progress'}>}
 */
export const igniteSubstrate = async ({ modelKey, contextLength }) => {
  if (!isValidModelKey(modelKey)) throw new Error(`Invalid model key: ${modelKey}`);
  if (!isValidContextLength(contextLength)) throw new Error(`Invalid context length: ${contextLength}`);
  if (inflight) return { status: 'ignition-in-progress' };

  const loaded = await listLoadedModels();
  if (isTargetLoaded(modelKey, loaded)) return { status: 'already-loaded' };

  inflight = { modelKey, startedAt: new Date().toISOString() };
  // fire-and-observe: the poll endpoint reports completion; the catch is
  // recorded in lastError by runIgnition so failure is never silent
  runIgnition(modelKey, contextLength).catch(() => {});
  return { status: 'igniting' };
};

/**
 * Everything the desk needs to render substrate ignition state. Impure.
 * @param {string|null} targetKey - the configured substrate model
 */
export const getIgnitionStatus = async (targetKey) => {
  const [available, loaded] = await Promise.all([isCliAvailable(), listLoadedModels()]);
  return {
    available,
    target: targetKey,
    targetLoaded: targetKey ? isTargetLoaded(targetKey, loaded) : false,
    igniting: inflight,
    lastError,
    loaded,
  };
};
