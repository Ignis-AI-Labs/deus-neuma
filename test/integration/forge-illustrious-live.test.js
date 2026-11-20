/**
 * THE CHARACTER PIPELINES RENDER, on a REAL engine (RULE 0 — no mocks, never faked): each of the three
 * pipelines-illustrious.js graphs, built by the real parameterizer from one Sophie Zero prompt, is accepted by ComfyUI
 * as written, runs both passes and saves one image at exactly 1.5x the asked size. Design note, 2026-11-20: […]
 *
 * SUMMONED ONLY (test/helpers/gpu-optin.js) — it loads three checkpoints on the card — and only through an engine
 * already serving with the operator's library mounted, named by FORGE_PROOF_ENGINE (http://host:port). It never
 * starts one: a second engine beside the house costs its speed.
 */
/* global process, console, Buffer, crypto, URL, URLSearchParams, setTimeout, fetch */
import { describe, test, expect } from 'vitest';
import { shouldRunGpuEngineTests, gpuSkipNote } from '../helpers/gpu-optin.js';
import { parameterize } from '../../backend/services/image-forge/parameterizer.js';
import { resolvePipeline, resolveModel } from '../../backend/services/image-forge/pack-registry.js';
import { loadScreenList } from '../../backend/services/image-forge/prompt-screen.js';
import { submitPrompt, getHistory } from '../../backend/services/image-forge/comfyui-client.js';

const engine = process.env.FORGE_PROOF_ENGINE ? new URL(process.env.FORGE_PROOF_ENGINE) : null;
const lawPath = process.env.COMFYUI_CONTENT_LAW_PATH || 'data/image-forge/content-law.json';
const run = shouldRunGpuEngineTests() && Boolean(engine);
if (!run) console.log(gpuSkipNote('illustrious character pipelines (and FORGE_PROOF_ENGINE names a serving engine)'));

const SOFI = '1girl, solo, mature female, cowboy shot, artificial humanoid, android, smooth pale porcelain skin with a faint iridescent sheen, glowing green bioluminescent veins tracing beneath the skin, translucent glass panels on the shoulders and hips showing glowing green filaments, mechanical seams at the joints, soft body, curvy, wide hips, white hair, very long hair, glowing green eyes, sleek white bodysuit, sheer flowing white cloak, dark background, rim light, cinematic lighting';

describe.runIf(run)('the Illustrious character pipelines on a real engine', () => {
  const cfg = run ? { host: engine.hostname, port: Number(engine.port) } : null;
  const screenList = loadScreenList(lawPath);

  test.each(['still.wai.txt2img', 'still.deliberate.txt2img', 'still.nova.txt2img', 'still.neuma.txt2img'])('%s renders both passes and saves one clean 1248x1824 image', async (id) => {
    const { pipeline } = resolvePipeline(id);
    const { model } = resolveModel(pipeline);
    const jobId = `illustrious-proof-${id.split('.')[1]}-${Date.now()}`;
    const built = parameterize({ pipeline, model, args: { positive: SOFI, seed: 1234 }, jobId, screenList, fallbackSeed: 1 });
    expect(built.ok, built.error).toBe(true);
    const sent = await submitPrompt(cfg, { prompt: built.graph, promptId: crypto.randomUUID(), clientId: 'illustrious-proof' });
    expect(sent.ok, JSON.stringify(sent.error ?? sent.nodeErrors)).toBe(true);
    let done = null;
    for (let i = 0; i < 240 && !done?.completed; i += 1) {
      await new Promise((r) => setTimeout(r, 1000));
      done = await getHistory(cfg, sent.promptId);
      expect(done?.statusStr, JSON.stringify(done?.messages ?? []).slice(0, 800)).not.toBe('error');
    }
    expect(done?.completed).toBe(true);
    const images = Object.values(done.outputs).flatMap((o) => o.images ?? []);
    expect(images).toHaveLength(1); // the hires image alone — the base pass is never saved
    const [img] = images;
    const res = await fetch(`http://${cfg.host}:${cfg.port}/view?${new URLSearchParams({ filename: img.filename, subfolder: img.subfolder, type: img.type })}`);
    const png = Buffer.from(await res.arrayBuffer());
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1248, 1824]);
    expect(png.length).toBeGreaterThan(1_000_000); // a real picture, not a flat field
  }, 300_000);
});
