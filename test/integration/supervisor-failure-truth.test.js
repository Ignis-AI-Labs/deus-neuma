/**
 * SUPERVISOR FAILURE TRUTH — the status a desk reads during and after a boot
 * describes THAT boot, never the one before it.
 *
 *   - A boot that starts clears the last boot's failure and reports itself
 *     booting from its first instant (the prepare phase spawns no process,
 *     so […] could not see it): the desk's first
 *     poll used to read the OLD failure and paint IGNITION FAILED.
 *   - A retry that fails reports its own failure, not the old text.
 *   - A stop NEUMA meant (standby, a reload) records no failure: it used to
 *     read "exited unexpectedly" after every standby.
 *   - Another program on the house port is named as such ('port-held'),
 *     and nothing is spawned into it — it used to read […] and relight into the same wall, re-hashing the model.
 *   - A machine whose GPU cannot be proven reads 'gpu-unavailable', not a
 *     generic refusal.
 *
 * Real supervisor module, real stand-in processes on real ports, real claim
 * on real disk (RULE 0). The GPU case is the pure code projection fed a real
 * coded error: a rig without a provable GPU cannot be stood up inside this
 * suite, so the real boot path for that case is NOT exercised here.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'http';
import path from 'path';
import { useHouseServing, freePort } from '../helpers/house-serving-stand-in.js';
import { codedTrainingError } from '../../backend/services/refinement-training-errors.js';

let house;
let sup;
let lifecycle;
beforeAll(async () => {
  house = await useHouseServing();
  sup = await import('../../backend/services/llama-server-supervisor.js');
  lifecycle = await import('../../backend/services/substrate-lifecycle.js');
});
afterAll(async () => {
  await sup.stopSupervised();
  await house.restore();
});

const launchWith = (env) => sup.resolveServingLaunchConfig({
  LLAMA_SERVER_BIN: house.bin, LLAMA_SERVER_MODEL: house.bin, LLAMA_SERVER_URL: house.endpoint, ...env,
});

// impure — one boot that fails before any process exists: its model is gone.
const failOnMissingModel = async () => {
  const missing = launchWith({ LLAMA_SERVER_MODEL: path.join(path.dirname(house.bin), 'gone.gguf') });
  const failure = await sup.startSupervised(missing, { waitMs: 15000 }).then(() => null, (err) => err);
  expect(failure).toBeInstanceOf(Error);
  const st = await sup.supervisorStatus(missing);
  expect(st.lastError).not.toBeNull();
  return failure.message;
};

describe('a boot reports its own state, never the last boot\'s', () => {
  test('the retry after a failed boot reads booting with no failure from its first instant, then serves', async () => {
    await failOnMissingModel();
    const cfg = launchWith({});
    const boot = sup.startSupervised(cfg, { waitMs: 15000 });
    const during = await sup.supervisorStatus(cfg);
    expect(during.booting).toBe(true);
    expect(during.lastError).toBeNull();
    const desk = lifecycle.toIgnitionStatus(during, cfg.model);
    expect(desk.igniting).not.toBeNull();
    expect((await boot).status).toBe('serving');
    const after = await sup.supervisorStatus(cfg);
    expect(after.booting).toBe(false);
    expect(after.serving).toBe(true);
    // A stop NEUMA meant — standby's, a reload's — is not a failure to report.
    await sup.stopSupervised();
    expect((await sup.supervisorStatus(cfg)).lastError).toBeNull();
  }, 30000);

  test('a retry that fails says its own failure, not the old text', async () => {
    const oldText = await failOnMissingModel();
    // The model exists this time; the server simply ends before it was ever healthy.
    const cfg = launchWith({ LLAMA_SERVER_BIN: house.crashBin });
    const failure = await sup.startSupervised(cfg, { waitMs: 15000 }).then(() => null, (err) => err);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).not.toBe(oldText);
    expect(failure.message).toMatch(/exited before becoming healthy/);
  }, 30000);
});

describe('another program on the house port', () => {
  let squatter;
  let port;
  beforeAll(async () => {
    port = await freePort();
    // A real program on the port that is not a healthy llama-server.
    squatter = createServer((req, res) => { res.writeHead(404); res.end(); });
    await new Promise((resolve) => squatter.listen(port, '127.0.0.1', resolve));
  });
  afterAll(() => new Promise((resolve) => squatter.close(resolve)));

  test('reads port-held, and nothing is spawned into it', async () => {
    const cfg = launchWith({ LLAMA_SERVER_URL: `http://127.0.0.1:${port}` });
    const failure = await sup.startSupervised(cfg, { waitMs: 15000 }).then(() => null, (err) => err);
    expect(failure?.message).toMatch(new RegExp(`port ${port}`));
    const st = await sup.supervisorStatus(cfg);
    expect(st.lastError.code).toBe('port-held');
    expect(st.lastError.message).toMatch(/Another program already holds/);
    expect(sup.readClaim()).toBeNull();
  }, 30000);
});

describe('a GPU the boot cannot prove', () => {
  test('projects as gpu-unavailable with its own public message', async () => {
    const { refusedBootCode } = await import('../../backend/services/supervisor-launch-config.js');
    expect(refusedBootCode(codedTrainingError('SERVING_GPU_UNAVAILABLE'))).toBe('gpu-unavailable');
    expect(refusedBootCode(new Error('base serving launch has no model file'))).toBe('launch-refused');
    const projected = sup.projectSupervisorFailure({ code: 'gpu-unavailable', at: new Date().toISOString() });
    expect(projected.code).toBe('gpu-unavailable');
    expect(projected.message).toMatch(/usable GPU/);
  });
});
