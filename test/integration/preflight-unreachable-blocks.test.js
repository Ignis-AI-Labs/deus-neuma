import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fullAuth } from '../helpers/audit-auth.js';
// the checks are for a signed-in caller (audit 2026-10-28 M-03)
const signedIn = async () => ({ Authorization: `Bearer ${(await fullAuth()).token}` });

// Isolate the REAL encrypted credential store before anything imports it — the
// endpoint below is written through the real store, on a private path, so this
// can never read or rewrite the operator's own provider keys.
const CRED_DIR = mkdtempSync(path.join(os.tmpdir(), 'neuma-cred-bastien-'));
process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(CRED_DIR, 'provider-credentials.json');
// Pin the dynamic sweep to a dead port: this suite's fixture server IS the
// machine under test — the real box's real llama-servers must not walk into
// the row (they did: […]).
process.env.NEUMA_DISCOVERY_PORTS = '1';
// And no persisted choice may leak in, nor an auto-adopt escape the suite.
// This suite's premise IS […] — under the 2026-08-08 choice model that means a persisted OPERATOR
// choice, which auto-adopt must never override (that refusal is itself part
// of what this suite now proves).
process.env.NEUMA_PROVIDER_CHOICE_PATH = path.join(CRED_DIR, 'llm-provider-choice.json');
writeFileSync(process.env.NEUMA_PROVIDER_CHOICE_PATH, JSON.stringify({
  provider: 'llama-server', chosenBy: 'operator', chosenAt: '2026-08-08T00:00:00.000Z',
}));

const ROOT = mkdtempSync(path.join(os.tmpdir(), 'preflight-bastien-'));
process.env.NEUMA_WORKSPACE_SETTINGS_PATH = path.join(ROOT, 'workspace-settings.json');
process.env.DNA_ENCRYPTION_KEY = 'x'.repeat(32);

const { setCredential, removeCredential } = await import('../../backend/services/provider-credentials.js');
const { setConfig } = await import('../../backend/services/llm-provider.js');
const { launchReady, resolveServingLaunchConfig, binaryPresent, missingPrerequisites } =
  await import('../../backend/services/llama-server-supervisor.js');
const core = await import('../../core/index.js');
const { default: router } = await import('../../backend/routes/preflight-routes.js');

/**
 * THE DOOR THAT SHOULD HAVE BEEN SHUT (Bastien, reported by Design note, 2026-08-03.
 *
 * A community member reached STAGE 0 of the birth ceremony and the being died
 * on:
 *
 *   «WARNING» LAUNCH PREREQUISITES MISSING
 *   ({"binOk":true,"modelOk":false,"lorasOk":true,"ready":false})
 *
 * That readout is a FRESH INSTALL, exactly. NEUMA's default provider is
 * `llama-server`, which needs an absolute llama.cpp path configured and a GGUF
 * file on disk — neither of which the installer ships and neither of which a
 * first-run machine has. `resolveServingLaunchConfig({})` reproduces his four
 * booleans byte for byte (asserted below).
 *
 * The question this file answers is not […] — it could
 * not have succeeded — but **why was he allowed to start a ceremony at all**.
 *
 * The pre-flight gate is the only door: BirthCeremony.show() mounts
 * PreflightCheck and startActualCeremony() runs ONLY from its success callback,
 * which fires only on verdict `ready`.
 *
 * On 2026-08-02 I taught the substrate row to notice a DIFFERENT local provider
 * running (a real report: the row said "unreachable" while the panel beneath it
 * said […]). I made that case a WARN carrying a switchTo, and
 * wrote in the commit message: […]
 *
 * The reasoning was right and the severity was wrong. The verdict is computed
 * as `checks.some(c => c.status === 'fail') ? 'blocked' : 'ready'` — a WARN does
 * not block. So the row correctly said […], the
 * verdict said READY anyway, BEGIN THE CEREMONY enabled, and the failure landed
 * exactly where I said it would: mid-ceremony, in front of a first-run user, as
 * a JSON blob of internal field names.
 *
 * Nothing here is mocked. A REAL http server speaks the real Ollama /api/tags
 * shape, its address goes through the REAL encrypted credential store, the
 * configured provider points at a REAL dead port, and the REAL pre-flight route
 * is driven over HTTP.
 */
describe('a configured provider that is down must not open the ceremony', () => {
  let ollama;
  let app;

  beforeAll(async () => {
    ollama = createServer((req, res) => {
      if (req.url === '/api/tags') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models: [{ name: 'gemma3:12b' }] }));
        return;
      }
      res.writeHead(404); res.end('{}');
    });
    await new Promise((r) => ollama.listen(0, '127.0.0.1', r));

    // Bastien's shape: Ollama genuinely running, and the CONFIGURED provider
    // (llama-server, the out-of-box default) pointed at nothing.
    await setCredential('ollama', { endpoint: `http://127.0.0.1:${ollama.address().port}` });
    setConfig({ provider: 'llama-server', endpoint: 'http://127.0.0.1:1', model: 'local-model' });

    core.setWorkspacesRoot(ROOT);
    app = express();
    app.use(express.json());
    app.use('/api/v1/preflight', router);
  });

  afterAll(async () => {
    await removeCredential('ollama').catch(() => {});
    await new Promise((r) => ollama.close(r));
    rmSync(CRED_DIR, { recursive: true, force: true });
    rmSync(ROOT, { recursive: true, force: true });
    delete process.env.NEUMA_WORKSPACE_SETTINGS_PATH;
  });

  test("Bastien's readout IS a fresh install — no env, no model, nothing wrong with his machine", () => {
    const cfg = resolveServingLaunchConfig({});
    // The default provider needs two things an installer ships neither of.
    // `bin` is what gets spawned, so an unconfigured binary is the empty
    // sentinel — never a bare name for someone else's PATH to resolve.
    expect(cfg.bin).toBe('');
    expect(cfg.model).toBe('');             // and nothing at all to serve

    const ready = launchReady(cfg);
    expect(ready.modelOk).toBe(false);      // exactly what he saw
    expect(ready.lorasOk).toBe(true);       // vacuously — he has configured none
    expect(ready.ready).toBe(false);

    // `binOk` is the one field whose value moves with the machine, and it is
    // also the field that was lying. See the block below.
  });

  test('the row still NAMES the running provider — that part was right and stays', async () => {
    const res = await request(app).get('/api/v1/preflight').set(await signedIn());
    expect(res.status).toBe(200);

    const substrate = res.body.checks.find((c) => c.id === 'substrate');
    expect(substrate.detail).toMatch(/llama-server unreachable/);
    expect(substrate.detail).toMatch(/Ollama \(1 model\) is running/);
    // The machine-readable affordance the chips use to offer the switch.
    expect(substrate.switchTo).toEqual([
      expect.objectContaining({ id: 'ollama', models: ['gemma3:12b'] }),
    ]);
  });

  test('THE DOOR: the verdict is BLOCKED, so BEGIN THE CEREMONY stays disabled', async () => {
    const res = await request(app).get('/api/v1/preflight').set(await signedIn());

    const substrate = res.body.checks.find((c) => c.id === 'substrate');
    // A warn here is what let Bastien in. The ceremony will reach for the
    // CONFIGURED provider — naming a running alternative is help, not a route
    // change, and only the click actually moves it.
    expect(substrate.status).toBe('fail');
    expect(res.body.verdict).toBe('blocked');
  });
});

/**
 * `binOk` was never a measurement. The old rule was
 *
 *   const binOk = cfg.bin === 'llama-server' || existsSync(cfg.bin);
 *
 * — TRUE for the default NAME on a machine with no llama.cpp anywhere, which is
 * why Bastien's diagnostic reassured him about the one component it had not
 * checked. The rule now demands a canonical ABSOLUTE path, because `bin` is
 * handed straight to spawn and a PATH lookup lets any earlier writable PATH
 * entry supply the substrate binary. Real directories, real files, real PATH.
 */
describe('binOk tells the truth about the binary', () => {
  let dir;
  let exe;

  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'neuma-path-'));
    exe = path.join(dir, process.platform === 'win32' ? 'llama-server.EXE' : 'llama-server');
    writeFileSync(exe, '#!/bin/sh\n');
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test('the default name is FALSE when nothing provides it', () => {
    // The old rule short-circuited on `cfg.bin === 'llama-server'` and returned
    // true here without looking at anything. This is the exact input it lied on.
    expect(binaryPresent('llama-server')).toBe(false);
  });

  test('...and STILL false when a real file of that name sits on a real PATH entry', () => {
    // `bin` is handed to spawn. Resolving a bare name through PATH would let any
    // earlier writable PATH entry supply the substrate binary, so the name is no
    // longer resolvable at all — only an absolute path answers for itself.
    const savedPath = process.env.PATH;
    process.env.PATH = `${dir}${path.delimiter}${savedPath}`;
    try {
      expect(binaryPresent('llama-server')).toBe(false);
      expect(binaryPresent(exe)).toBe(true);
    } finally {
      process.env.PATH = savedPath;
    }
  });

  test('an explicit path answers for itself, present or absent', () => {
    expect(binaryPresent(exe)).toBe(true);
    expect(binaryPresent(path.join(dir, 'nope', 'llama-server'))).toBe(false);
  });

  test('empty input is false, never a throw', () => {
    expect(binaryPresent('')).toBe(false);
    expect(binaryPresent(undefined)).toBe(false);
  });
});

/**
 * The string a witness actually reads when the substrate cannot start. It used
 * to be `JSON.stringify(ready)` — rendered into the ceremony as
 * {"binOk":true,"modelOk":false,"lorasOk":true,"ready":false}.
 */
describe('what the ceremony says instead of a JSON dump', () => {
  test("Bastien's case names the missing model AND the way out", () => {
    const said = missingPrerequisites(
      { binOk: true, modelOk: false, lorasOk: true },
      { bin: 'llama-server', model: '' },
    );
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/no model file is configured/);
    expect(said[0]).toMatch(/Ollama or LM Studio/);   // the remedy he already had running
  });

  test('a missing binary is named as llama.cpp, not as a boolean', () => {
    const said = missingPrerequisites({ binOk: false, modelOk: true, lorasOk: true }, { bin: 'llama-server' });
    expect(said[0]).toMatch(/llama\.cpp is not installed/);
    // The remedy moved with the law: a bare name on PATH is no longer a way in,
    // so the message must name the absolute setting, and echo what it looked at.
    expect(said[0]).toMatch(/absolute LLAMA_SERVER_BIN path/);
    expect(said[0]).toMatch(/\(llama-server\)/);
  });

  test('a configured model that is simply gone says WHERE it looked', () => {
    const said = missingPrerequisites(
      { binOk: true, modelOk: false, lorasOk: true },
      { bin: 'llama-server', model: '/models/gemma-4-31b.gguf' },
    );
    expect(said[0]).toMatch(/nothing at \/models\/gemma-4-31b\.gguf/);
  });

  test('everything present says nothing at all', () => {
    expect(missingPrerequisites({ binOk: true, modelOk: true, lorasOk: true }, {})).toEqual([]);
  });
});
