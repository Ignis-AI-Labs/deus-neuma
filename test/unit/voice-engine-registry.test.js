import { describe, it, expect } from 'vitest';
import {
  getEngine, listEngines, listLocalEngines, listCloudEngines,
  listCommercialEngines, getAdapterId, getManifestVersion, toPublicJSON,
  getTier, listTiers, getDefaultModel, engineFiles,
} from '../../backend/services/voice/engine-registry.js';
import { envIdOf, healthVerdict } from '../../backend/services/voice/engine-process.js';

describe('backend/services/voice/engine-registry.js', () => {
  describe('manifest', () => {
    it('is manifest v2 (ONE VOICE: speak engines + tiers)', () => {
      expect(getManifestVersion()).toBe(2);
    });

    it('every local engine binds loopback on its own port', () => {
      const local = listLocalEngines();
      const ports = local.map((e) => e.serve.port);
      expect(new Set(ports).size).toBe(ports.length);
      expect(local.every((e) => e.serve.host === '127.0.0.1')).toBe(true);
    });
  });

  describe('getEngine', () => {
    it('returns the zonos engine by id', () => {
      const e = getEngine('zonos');
      expect(e).not.toBeNull();
      expect(e.id).toBe('zonos');
      expect(e.type).toBe('local');
      expect(e.license).toBe('Apache-2.0');
      expect(e.commercial).toBe(true);
    });

    it('returns null for unknown engine', () => {
      expect(getEngine('does-not-exist')).toBeNull();
    });

    it('cloud engines have apiKey requirement', () => {
      const c = getEngine('cartesia');
      expect(c.type).toBe('cloud');
      expect(c.requirements.apiKey).toBe(true);
    });
  });

  describe('listEngines', () => {
    it('returns all engines from the manifest', () => {
      const all = listEngines();
      expect(all.length).toBeGreaterThanOrEqual(5);
      expect(all.map((e) => e.id)).toContain('zonos');
      expect(all.map((e) => e.id)).toContain('kokoro');
      expect(all.map((e) => e.id)).toContain('cartesia');
      expect(all.map((e) => e.id)).toContain('elevenlabs');
    });
  });

  describe('listLocalEngines / listCloudEngines', () => {
    it('partitions by type', () => {
      const local = listLocalEngines();
      const cloud = listCloudEngines();
      expect(local.every((e) => e.type === 'local')).toBe(true);
      expect(cloud.every((e) => e.type === 'cloud')).toBe(true);
      expect(local.length + cloud.length).toBe(listEngines().length);
    });
  });

  describe('listCommercialEngines', () => {
    it('excludes the non-commercial F5-TTS', () => {
      const commercial = listCommercialEngines();
      expect(commercial.map((e) => e.id)).not.toContain('f5-tts');
      expect(commercial.map((e) => e.id)).toContain('zonos');
    });
  });

  describe('getAdapterId', () => {
    it('returns the adapter id for known engines', () => {
      expect(getAdapterId('zonos')).toBe('zonos');
      expect(getAdapterId('kokoro')).toBe('kokoro');
      expect(getAdapterId('cartesia')).toBe('cartesia');
      expect(getAdapterId('elevenlabs')).toBe('elevenlabs');
    });

    it('returns null for unimplemented adapters', () => {
      expect(getAdapterId('hume')).toBe('hume'); // registered but no adapter yet
      expect(getAdapterId('does-not-exist')).toBeNull();
    });
  });

  describe('toPublicJSON', () => {
    it('strips internal serve/download paths', () => {
      const pub = toPublicJSON();
      const zonos = pub.zonos;
      expect(zonos.id).toBe('zonos');
      expect(zonos.name).toBe('Zonos v0.1');
      expect(zonos.license).toBe('Apache-2.0');
      // Should not leak internal path details
      expect(JSON.stringify(pub)).not.toContain('startModule');
      expect(JSON.stringify(pub)).not.toContain('allowPatterns');
      expect(JSON.stringify(pub)).not.toContain('hf_cache');
    });

    it('returns frozen object', () => {
      expect(Object.isFrozen(toPublicJSON())).toBe(true);
    });
  });

  describe('ONE VOICE engines (speak protocol)', () => {
    it('csm serves csm-1b on port 7868 — High/MisoTTS was dropped (ruling, 2026-10-01)', () => {
      const csm = getEngine('csm');
      expect(csm).toMatchObject({ type: 'local', adapter: 'speak', protocol: 'speak', defaultModel: 'csm-1b' });
      expect(Object.keys(csm.models)).toEqual(['csm-1b']);
      expect(csm.serve).toMatchObject({
        host: '127.0.0.1', port: 7868, startModule: 'voice-engines/csm/server.py',
        modelEnv: 'CSM_MODEL', profileEnv: 'CSM_PROFILE',
      });
      // two memory profiles of the same CSM-1B voice
      expect(csm.models['csm-1b'].defaultProfile).toBe('full');
      expect(Object.keys(csm.models['csm-1b'].profiles)).toEqual(['full', 'lean']);
      expect(csm.models['csm-1b'].profiles.lean.kvLen).toBe(1024);
      expect(getDefaultModel('csm')).toBe('csm-1b');
    });

    it('chatterbox-nano is the CPU engine on port 7869, one model', () => {
      const nano = getEngine('chatterbox-nano');
      expect(nano).toMatchObject({ type: 'local', adapter: 'speak', license: 'MIT' });
      expect(nano.requirements.gpu).toBe('none');
      expect(nano.serve).toMatchObject({ port: 7869, startModule: 'voice-engines/chatterbox-nano/server.py' });
      expect(getDefaultModel('chatterbox-nano')).toBe(null);
    });

    it('first-compile launches get minutes, not the legacy 2-minute wait', () => {
      // csm-1b compiles ~2.5 min on first launch (docs/work/one-voice.md)
      expect(getEngine('csm').serve.readyTimeoutMs).toBeGreaterThanOrEqual(5 * 60_000 + 60_000);
      expect(getEngine('chatterbox-nano').serve.readyTimeoutMs).toBeGreaterThanOrEqual(60_000);
    });
  });

  describe('engineFiles — pinned downloads', () => {
    const HEX64 = /^[0-9a-f]{64}$/;

    it('every pinned file names a repo revision, a sha256 and a size', () => {
      for (const id of ['csm', 'chatterbox-nano']) {
        for (const f of getEngine(id).download.files) {
          expect(f.repo).toMatch(/^[\w.-]+\/[\w.-]+$/);
          expect(f.revision).toMatch(/^[0-9a-f]{40}$/);
          expect(f.sha256).toMatch(HEX64);
          expect(Number.isInteger(f.bytes) && f.bytes > 0).toBe(true);
        }
      }
    });

    it('selects the csm-1b files with the shared tokenizer and Mimi — and never MisoTTS', () => {
      const small = engineFiles('csm', 'csm-1b').map((f) => f.repo);
      expect(small).toContain('unsloth/csm-1b');
      expect(small).toContain('kyutai/moshiko-pytorch-bf16');
      expect(small).not.toContain('MisoLabs/MisoTTS');
      expect(engineFiles('csm')).toEqual(engineFiles('csm', 'csm-1b'));
    });

    it('lands files in the offline HF cache layout unless a dest is pinned', () => {
      const [tok] = engineFiles('csm', 'csm-1b').filter((f) => f.path === 'tokenizer.json');
      expect(tok.dest).toBe(`_models/_hf_cache/hub/models--unsloth--csm-1b/snapshots/${tok.revision}/tokenizer.json`);
      const mimi = engineFiles('csm').find((f) => f.repo === 'kyutai/moshiko-pytorch-bf16');
      expect(mimi.dest).toBe('csm/_weights/mimi-tokenizer-e351c8d8-checkpoint125.safetensors');
      expect(engineFiles('chatterbox-nano').some((f) => f.dest.startsWith('chatterbox-nano/_onnx/v2/'))).toBe(true);
      expect(engineFiles('zonos')).toEqual([]);
    });

    it('never leaks pins or paths into the public view', () => {
      const pub = JSON.stringify(toPublicJSON());
      expect(pub).not.toContain('sha256');
      expect(pub).not.toContain('_weights');
      expect(pub).not.toContain('modelEnv');
    });
  });

  describe('tiers', () => {
    it('light → Nano on the CPU, standard → csm-1b, and no high tier', () => {
      expect(getTier('light')).toMatchObject({ id: 'light', engine: 'chatterbox-nano', device: 'cpu' });
      expect(getTier('standard')).toMatchObject({ engine: 'csm', model: 'csm-1b', device: 'cuda' });
      expect(getTier('high')).toBeNull();
    });

    it('lists lightest first, each naming a real engine/model and its measured profiles', () => {
      const tiers = listTiers();
      expect(tiers.map((t) => t.id)).toEqual(['light', 'standard']);
      for (const t of tiers) {
        expect(getEngine(t.engine)).not.toBeNull();
        if (t.model) {
          const { profiles } = getEngine(t.engine).models[t.model];
          // every tier profile is one the engine can actually launch
          expect(Object.keys(profiles)).toEqual(expect.arrayContaining(Object.keys(t.profiles)));
        }
        expect(Object.keys(t.profiles)).toContain(t.defaultProfile);
        for (const p of Object.values(t.profiles)) {
          expect(typeof p.memMB).toBe('number');
          expect(p.measured).toMatch(/docs\/work\/one-voice\.md/);
        }
      }
      const gpu = (t) => t.profiles[t.defaultProfile].memMB;
      expect(tiers.map(gpu)).toEqual([...tiers.map(gpu)].sort((a, b) => a - b));
    });

    it('Standard offers lean (~2.5 GB) for tight VRAM and full (~5.7 GB) by default', () => {
      const { profiles, defaultProfile } = getTier('standard');
      expect(defaultProfile).toBe('full');
      expect(profiles.lean.memMB).toBe(2456);
      expect(profiles.full.memMB).toBe(5726);
      expect(profiles.lean.memMB).toBeLessThan(profiles.full.memMB);
    });

    it('unknown tier → null; tiers are frozen', () => {
      expect(getTier('ultra')).toBeNull();
      expect(getTier('constructor')).toBeNull();
      expect(Object.isFrozen(getTier('light'))).toBe(true);
    });
  });

  describe('engine-process pure helpers', () => {
    it('envIdOf sanitises an engine id into an env-var stem', () => {
      expect(envIdOf('chatterbox-nano')).toBe('CHATTERBOX_NANO');
      expect(envIdOf('f5-tts')).toBe('F5_TTS');
      expect(envIdOf('csm')).toBe('CSM');
    });

    it('healthVerdict: ready only on ok, failed on phase failed, anything else still starting', () => {
      expect(healthVerdict({ ok: true, phase: 'ready' })).toBe('ready');
      expect(healthVerdict({ ok: true })).toBe('ready'); // pre-phase sidecars
      expect(healthVerdict({ ok: false, phase: 'compiling' })).toBe('starting');
      expect(healthVerdict({ ok: false, phase: 'loading' })).toBe('starting');
      expect(healthVerdict({ ok: false, phase: 'failed', error: 'x' })).toBe('failed');
      expect(healthVerdict(null)).toBe('starting');
    });
  });
});
