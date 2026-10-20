import { describe, test, expect } from 'vitest';
import path from 'path';
import {
  resolveComfyConfig,
  buildComfyArgs,
  argvViolations,
  decideReapAction,
} from '../../backend/services/image-forge/comfyui-supervisor.js';

// The spawn/stop/probe/adopt path is proven by integration against the real
// pinned engine (RULE 0 — test/integration/comfyui-supervisor.test.js);
// these cover the pure launch planning and the reap decision.

describe('resolveComfyConfig', () => {
  test('defaults: port 8190 loopback, lane absent without an install dir, T-3 TTLs', () => {
    const cfg = resolveComfyConfig({});
    expect(cfg.host).toBe('127.0.0.1');
    expect(cfg.port).toBe(8190);
    expect(cfg.installDir).toBe('');
    expect(cfg.python).toBe('');
    expect(cfg.mainPy).toBe('');
    expect(cfg.idleTtlMs).toBe(600_000);
    expect(cfg.reapTtlMs).toBe(1_800_000);
    expect(cfg.headroomGb).toBe('');
    // staging defaults live under the gitignored data root
    expect(cfg.outputDir.endsWith(path.join('data', 'comfyui', 'output'))).toBe(true);
    expect(cfg.userDir.endsWith(path.join('data', 'comfyui', 'user'))).toBe(true);
  });

  test('COMFYUI_DATA_DIR relocates the whole sidecar data tree', () => {
    const cfg = resolveComfyConfig({ COMFYUI_DATA_DIR: '/iso/forge-data' });
    expect(cfg.outputDir).toBe(path.join('/iso/forge-data', 'output'));
    expect(cfg.tempDir).toBe(path.join('/iso/forge-data', 'tmp'));
    expect(cfg.userDir).toBe(path.join('/iso/forge-data', 'user'));
    expect(cfg.logDir).toBe(path.join('/iso/forge-data', 'logs'));
  });

  test('derives python and main.py from the install dir', () => {
    const cfg = resolveComfyConfig({ COMFYUI_INSTALL_DIR: '/mnt/external/comfyui/app' });
    expect(cfg.python).toBe('/mnt/external/comfyui/app/.venv/bin/python');
    expect(cfg.mainPy).toBe('/mnt/external/comfyui/app/main.py');
  });

  test('parses COMFYUI_URL and normalizes localhost to 127.0.0.1', () => {
    const cfg = resolveComfyConfig({ COMFYUI_URL: 'http://localhost:8191' });
    expect(cfg.host).toBe('127.0.0.1');
    expect(cfg.port).toBe(8191);
  });

  test('falls back to safe defaults on a malformed url', () => {
    const cfg = resolveComfyConfig({ COMFYUI_URL: 'not a url' });
    expect(cfg.host).toBe('127.0.0.1');
    expect(cfg.port).toBe(8190);
  });

  test('a non-loopback COMFYUI_URL is clamped to loopback — the lane is loopback by law', () => {
    const cfg = resolveComfyConfig({ COMFYUI_URL: 'http://10.0.0.5:8190' });
    expect(cfg.host).toBe('127.0.0.1');
    expect(cfg.port).toBe(8190);
  });

  test('TTL ≤ 0 disables a tier and rides through as configured', () => {
    const cfg = resolveComfyConfig({ COMFYUI_IDLE_TTL_MS: '0', COMFYUI_REAP_TTL_MS: '-1' });
    expect(cfg.idleTtlMs).toBe(0);
    expect(cfg.reapTtlMs).toBe(-1);
  });
});

describe('buildComfyArgs — the frozen §3.1 launch line', () => {
  const fullCfg = resolveComfyConfig({
    COMFYUI_INSTALL_DIR: '/opt/forge/app',
    COMFYUI_MODELS_DIR: '/big/models',
    COMFYUI_OUTPUT_DIR: '/data/out',
    COMFYUI_VRAM_HEADROOM_GB: '44',
    COMFYUI_URL: 'http://127.0.0.1:8190',
  });

  test('emits the exact frozen line for a full config', () => {
    expect(buildComfyArgs(fullCfg)).toEqual([
      '/opt/forge/app/main.py',
      '--port', '8190',
      '--disable-all-custom-nodes',
      '--offline',
      '--disable-metadata',
      '--output-directory', '/data/out',
      '--temp-directory', fullCfg.tempDir,
      '--user-directory', fullCfg.userDir,
      '--models-directory', '/big/models',
      '--vram-headroom', '44',
    ]);
  });

  test('never emits the banned flags — the law asserted on our own output', () => {
    const args = buildComfyArgs(fullCfg);
    for (const banned of ['--listen', '--whitelist-custom-nodes', '--enable-cors-header', '--multi-user']) {
      expect(args).not.toContain(banned);
    }
    expect(argvViolations(args)).toEqual([]);
  });

  test('omits models-directory, extra-model-paths, and headroom when unset', () => {
    const cfg = resolveComfyConfig({ COMFYUI_INSTALL_DIR: '/opt/forge/app' });
    const args = buildComfyArgs(cfg);
    expect(args).not.toContain('--models-directory');
    expect(args).not.toContain('--extra-model-paths-config');
    expect(args).not.toContain('--vram-headroom');
  });

  test('a reference mount rides --extra-model-paths-config when configured', () => {
    const cfg = resolveComfyConfig({
      COMFYUI_INSTALL_DIR: '/opt/forge/app',
      COMFYUI_EXTRA_MODEL_PATHS: '/mnt/external/comfyui/extra_model_paths_ai_reference.yaml',
    });
    const args = buildComfyArgs(cfg);
    const i = args.indexOf('--extra-model-paths-config');
    expect(args[i + 1]).toBe('/mnt/external/comfyui/extra_model_paths_ai_reference.yaml');
  });
});

describe('argvViolations — the safety law', () => {
  const safe = ['main.py', '--port', '8190', '--disable-all-custom-nodes', '--disable-api-nodes',
    '--disable-metadata', '--output-directory', '/data/out'];

  test('a safe argv passes clean', () => {
    expect(argvViolations(safe)).toEqual([]);
  });

  test('bare --listen (= 0.0.0.0) is refused by name', () => {
    const v = argvViolations([...safe, '--listen']);
    expect(v.some((s) => s.includes('bare --listen'))).toBe(true);
  });

  test('bare --listen followed by another flag is still bare', () => {
    const v = argvViolations(['main.py', '--listen', '--port', '8190', '--disable-all-custom-nodes']);
    expect(v.some((s) => s.includes('bare --listen'))).toBe(true);
  });

  test('a non-loopback bind is refused; an explicit loopback bind passes', () => {
    expect(argvViolations([...safe, '--listen', '0.0.0.0']).some((s) => s.includes('non-loopback'))).toBe(true);
    expect(argvViolations([...safe, '--listen', '192.168.1.5']).some((s) => s.includes('non-loopback'))).toBe(true);
    expect(argvViolations([...safe, '--listen', '127.0.0.1'])).toEqual([]);
  });

  test('the argparse = spelling is the SAME flag — no bypass through --listen=0.0.0.0 (echo r1 finding)', () => {
    expect(argvViolations([...safe, '--listen=0.0.0.0']).some((s) => s.includes('non-loopback'))).toBe(true);
    expect(argvViolations([...safe, '--listen=192.168.1.5']).some((s) => s.includes('non-loopback'))).toBe(true);
    expect(argvViolations([...safe, '--listen=']).some((s) => s.includes('bare --listen'))).toBe(true);
    expect(argvViolations([...safe, '--listen=127.0.0.1'])).toEqual([]);
    expect(argvViolations([...safe, '--enable-cors-header=http://evil']).some((s) => s.includes('enable-cors-header'))).toBe(true);
    expect(argvViolations([...safe, '--whitelist-custom-nodes=pack']).some((s) => s.includes('whitelist-custom-nodes'))).toBe(true);
  });

  test('the whitelist flag, CORS, and multi-user are each refused by name', () => {
    expect(argvViolations([...safe, '--whitelist-custom-nodes', 'pack']).some((s) => s.includes('whitelist-custom-nodes'))).toBe(true);
    expect(argvViolations([...safe, '--enable-cors-header']).some((s) => s.includes('enable-cors-header'))).toBe(true);
    expect(argvViolations([...safe, '--multi-user']).some((s) => s.includes('multi-user'))).toBe(true);
  });

  test('missing --disable-all-custom-nodes is a violation', () => {
    const v = argvViolations(['main.py', '--port', '8190']);
    expect(v.some((s) => s.includes('disable-all-custom-nodes'))).toBe(true);
  });

  test('adoption expectation: the output dir must be OURS — both argparse spellings honored', () => {
    expect(argvViolations(safe, { requireOutputDir: '/data/out' })).toEqual([]);
    expect(argvViolations(safe, { requireOutputDir: '/elsewhere' }).some((s) => s.includes('output-directory'))).toBe(true);
    const noOut = safe.filter((t) => t !== '--output-directory' && t !== '/data/out');
    expect(argvViolations(noOut, { requireOutputDir: '/data/out' }).some((s) => s.includes('output-directory'))).toBe(true);
    // The = spelling of OUR dir is not over-refused.
    expect(argvViolations([...noOut, '--output-directory=/data/out'], { requireOutputDir: '/data/out' })).toEqual([]);
  });

  test('a non-array argv yields no crash (adoption wraps it with its own refusal)', () => {
    expect(argvViolations(undefined).length).toBeGreaterThan(0); // missing disable-all
  });
});

describe('decideReapAction — the two-tier idle law', () => {
  const base = {
    state: 'ready', adopted: false, queueBusy: false,
    now: 1_000_000, readySince: 0, lastActivityAt: null, lastFreeAt: null,
    idleTtlMs: 600_000, reapTtlMs: 1_800_000,
  };
  // readySince 0 is "unknown" (falsy floor) — use 1 for "long ago".
  const longAgo = { ...base, readySince: 1 };

  test('never acts unless READY', () => {
    expect(decideReapAction({ ...longAgo, state: 'launching' })).toBe('none');
    expect(decideReapAction({ ...longAgo, state: 'stopped' })).toBe('none');
  });

  test('a busy queue blocks every tier — the operator may be mid-render', () => {
    expect(decideReapAction({ ...longAgo, queueBusy: true, now: 10_000_000 })).toBe('none');
  });

  test('grace window: a fresh engine is never touched inside the idle TTL', () => {
    expect(decideReapAction({ ...base, readySince: 999_000, now: 1_000_000 })).toBe('none');
  });

  test('tier-1 fires /free past the idle TTL', () => {
    expect(decideReapAction({ ...longAgo, now: 600_002 })).toBe('free');
  });

  test('free-once: a /free newer than the last activity ends the tier-1 loop', () => {
    expect(decideReapAction({ ...longAgo, now: 700_000, lastFreeAt: 650_000 })).toBe('none');
  });

  test('new activity re-arms tier-1 after an earlier free', () => {
    expect(decideReapAction({
      ...longAgo, now: 2_000_000, lastFreeAt: 650_000, lastActivityAt: 1_200_000,
    })).toBe('free');
  });

  test('tier-2 stops an OWNED engine past the reap TTL', () => {
    expect(decideReapAction({ ...longAgo, now: 1_800_002 })).toBe('stop');
  });

  test('an ADOPTED engine is never stopped — /free forever', () => {
    expect(decideReapAction({ ...longAgo, adopted: true, now: 90_000_000, lastFreeAt: null })).toBe('free');
    expect(decideReapAction({ ...longAgo, adopted: true, now: 90_000_000, lastFreeAt: 89_999_999 })).toBe('none');
  });

  test('TTL ≤ 0 disables exactly its tier', () => {
    expect(decideReapAction({ ...longAgo, now: 90_000_000, idleTtlMs: 0, reapTtlMs: 1_800_000 })).toBe('stop');
    expect(decideReapAction({ ...longAgo, now: 90_000_000, idleTtlMs: 600_000, reapTtlMs: 0 })).toBe('free');
    expect(decideReapAction({ ...longAgo, now: 90_000_000, idleTtlMs: 0, reapTtlMs: 0 })).toBe('none');
  });

  test('activity later than readySince moves the idle floor', () => {
    expect(decideReapAction({ ...longAgo, now: 1_000_000, lastActivityAt: 999_000 })).toBe('none');
  });
});
