/**
 * image/generate — the intent type that renders an image on the operator's
 * own GPU through the supervised ComfyUI hearth (Stage 3 of the
 * being-tool-surface doctrine). This was the `generate_image` tool
 * (image-forge/image-being-tools.js) until the act became a filed intent;
 * `list_pipelines` and `review_image` stay tools — a review records a
 * judgment into the being's OWN review log (self-authorship, no card, no
 * publication gate — the memory_note shape), which is why it did not move.
 *
 * The two honesty gates stand at validate time, before any card: a missing
 * engine and an unreadable content law mean the act could only ever refuse
 * (FR-15), and the content-law screen itself runs at validate — a refused
 * prompt never raises a card. The refusal names the CLASS, never the term
 * (FR-31).
 */
import path from 'path';
import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { resolveComfyConfig, comfyInstallState, ensureComfyReady, noteComfyActivity } from '../image-forge/comfyui-supervisor.js';
import { resolvePipeline, resolveModel } from '../image-forge/pack-registry.js';
import { parameterize } from '../image-forge/parameterizer.js';
import { loadScreenList } from '../image-forge/prompt-screen.js';
import { runJob } from '../image-forge/job-lane.js';
import { withMachine } from '../machine-lease.js';
import { MIN_ENGINE_VRAM_GB, forgeCapacity } from '../image-forge/forge-capacity.js';
import { probeMachine } from '../machine-probe.js';
import { uploadImage } from '../image-forge/comfyui-client.js';
import { collectOutputs, resolveImage } from '../image-forge/image-store.js';
import { videoSight } from '../image-forge/video-sight.js';
import { publishActivity, percentOf } from '../image-forge/forge-activity.js';
import { recordAttempt, toAttemptRecord } from '../image-forge/attempt-log.js';
import { contentLawPath, toSlotArgs, refusalMessage } from '../image-forge/image-being-tools.js';
import { createLogger } from '../logger.js';

const log = createLogger('ImageGenerateIntent');

// pure — the slot args: `image` names a source, it is not a knob the pipeline tunes.
const slotArgs = (payload) => {
  const { image: _source, ...rest } = payload && typeof payload === 'object' ? payload : {};
  return toSlotArgs(rest);
};

// impure (reads the lane's manifest) — the caller's OWN still to edit or animate.
// A being can only start from its own renders; another lane's image is "no such image".
const sourceFor = (connection, pipeline, imageId) => {
  if (typeof imageId !== 'string' || !imageId) {
    return { ok: false, reason: `'${pipeline.id}' starts from one of your own images — pass its image id as {image}` };
  }
  const found = resolveImage(connection.companion?.neumaId, imageId);
  if (!found.ok) return { ok: false, reason: `image ${imageId}: ${found.error}` };
  if (!String(found.record?.mime ?? 'image/png').startsWith('image/')) {
    return { ok: false, reason: `image ${imageId} is not a still image` };
  }
  return found;
};

// impure — the honesty gates, re-read per act: a lane, an engine that could
// launch, and a content law that can be read.
const readinessRefusal = async (connection, env = process.env) => {
  if (!connection.companion?.neumaId) {
    return { ok: false, status: 'denied', reason: 'no sovereign lane on this connection — image generation is for bound seats' };
  }
  const cfg = resolveComfyConfig(env);
  if (!comfyInstallState(cfg).installed) {
    return { ok: false, status: 'denied', reason: 'the image engine is not installed on this machine — your operator sets it up' };
  }
  if (loadScreenList(contentLawPath(env)).failClosed) {
    return { ok: false, status: 'denied', reason: refusalMessage('list_unavailable') };
  }
  return null;
};

export const imageGenerateIntent = Object.freeze({
  name: 'image/generate',
  policyTool: 'image.generate',
  fieldsForPrompt: '{prompt, pipeline?, image?, negative?, width?, height?, steps?, cfg?, seed?, seconds?, aspect?}',
  descriptionForPrompt: 'Generate an image or a video — prompt is what you want to see, written as description, not instruction; pipeline defaults to SDXL text-to-image (list_pipelines names the rest, including video.ltx.i2v, which animates one of your images with sound). Pipelines that edit or animate need image: the id of one of your own renders. Rendering takes the GPU for a few seconds to a minute; the house pauses meanwhile. The result gives you ids — review a still with review_image before you speak of it.',

  availableFor: async ({ laneId, connection }) =>
    (laneId && (await readinessRefusal(connection)) === null ? {} : null),

  validate: async (payload, { connection }) => {
    const unready = await readinessRefusal(connection);
    if (unready) return unready;
    if (typeof payload?.prompt !== 'string' || !payload.prompt.trim()) {
      return { ok: false, status: 'invalid', reason: 'image/generate needs {prompt} — what the image should show, as description' };
    }
    const resolved = resolvePipeline(payload?.pipeline);
    if (!resolved.ok) return { ok: false, status: 'invalid', reason: resolved.error };
    const modelRes = resolveModel(resolved.pipeline);
    if (!modelRes.ok) return { ok: false, status: 'invalid', reason: modelRes.error };
    const source = resolved.pipeline.requiresSourceImage ? sourceFor(connection, resolved.pipeline, payload?.image) : null;
    if (source && !source.ok) return { ok: false, status: 'invalid', reason: source.reason };
    if (resolved.pipeline.kind === 'video') {
      // Said before any card: a machine that cannot hold the job is told so, never left to crash.
      const fit = forgeCapacity(await probeMachine()).video;
      if (!fit.ok) return { ok: false, status: 'denied', reason: `this machine cannot render video: ${fit.why}` };
    }
    // The content-law screen runs HERE — a refused class is a standing-rule
    // denial, never a card the operator answers for a prompt that cannot run.
    const built = parameterize({
      pipeline: resolved.pipeline,
      model: modelRes.model,
      args: slotArgs(payload),
      jobId: randomUUID(),
      screenList: loadScreenList(contentLawPath()),
      fallbackSeed: 0,
      sourceImageName: source ? path.basename(source.path) : null,
    });
    if (!built.ok) {
      return built.refusalClass
        ? { ok: false, status: 'denied', reason: refusalMessage(built.refusalClass) }
        : { ok: false, status: 'invalid', reason: built.error };
    }
    return { ok: true, value: { args: payload, pipeline: resolved.pipeline, model: modelRes.model } };
  },

  summarize: (payload) =>
    `render an image: "${String(payload?.prompt ?? '').replace(/\s+/g, ' ').trim().slice(0, 140)}"${payload?.pipeline ? ` (${payload.pipeline})` : ''}`,

  // impure — the real engine run, unchanged: attempt ledger at every terminal
  // outcome, viewport activity at every phase, progress chips in fifths, and
  // the render handed back to the being's own eyes (sight).
  execute: async ({ args, pipeline, model }, { connection, signal, emit }) => {
    const laneId = connection.companion?.neumaId;
    const tool = 'image/generate';
    const cfg = resolveComfyConfig(process.env);
    // A BARE uuid: the engine refuses any prompt_id that is not canonical.
    const jobId = randomUUID();
    const build = (sourceImageName = null) => parameterize({
      pipeline, model,
      args: slotArgs(args),
      jobId,
      screenList: loadScreenList(contentLawPath()),
      fallbackSeed: Math.floor(Math.random() * 4294967295),
      sourceImageName,
    });
    // A source pipeline is built once the engine has the image and names it.
    let built = pipeline.requiresSourceImage ? null : build();
    // The attempt is logged with its VERBATIM text at every terminal outcome.
    const attempt = (outcome, extra = {}) => recordAttempt(toAttemptRecord({
      jobId, laneId, beingName: connection.companion?.name || null, pipelineId: pipeline.id,
      positive: args?.prompt, negative: args?.negative,
      params: {
        width: args?.width, height: args?.height, steps: args?.steps,
        cfg: args?.cfg, seed: args?.seed ?? built?.values?.seed,
      },
      outcome, at: new Date().toISOString(), ...extra,
    }));

    publishActivity({
      jobId, laneId, beingName: connection.companion?.name || null,
      pipelineId: pipeline.id, pipelineLabel: pipeline.label,
      phase: 'queued', detail: 'waiting for the engine',
    });

    try {
      // THE MACHINE LANE (machine-lease.js): the render waits for the machine to itself, and the
      // house waits for the render — never two heavy things on the card at once.
      const run = await withMachine({
        label: `Image Forge — ${pipeline.label}`, needGB: pipeline.needGB ?? MIN_ENGINE_VRAM_GB, signal,
        onWait: ({ position }) => publishActivity({ jobId, phase: 'queued', detail: `waiting for the machine — place ${position}` }),
      }, async () => {
        const ready = await ensureComfyReady(cfg);
        if (ready.state !== 'ready' && !ready.serving) return { ready };
        if (pipeline.requiresSourceImage) {
          const source = sourceFor(connection, pipeline, args?.image);
          if (!source.ok) return { ready, error: source.reason };
          const uploaded = await uploadImage(cfg, {
            bytes: readFileSync(source.path), filename: `${jobId}${path.extname(source.path)}`, mime: source.record?.mime || 'image/png',
          });
          built = build(uploaded.name);
          if (!built.ok) return { ready, error: built.error };
        }
        noteComfyActivity();
        emit({ tool, status: 'running', summary: `rendering — ${pipeline.label}` });
        publishActivity({ jobId, phase: 'rendering', percent: null, detail: 'rendering' });

        // Progress is throttled to fifths: a step-by-step feed would drown the
        // stream for no added meaning.
        let lastFifth = -1;
        const outcome = await runJob(cfg, {
          graph: built.graph,
          promptId: jobId,
          signal,
          onProgress: ({ value, max }) => {
            publishActivity({ jobId, phase: 'rendering', percent: percentOf({ value, max }) });
            const fifth = max > 0 ? Math.floor((value / max) * 5) : 0;
            if (fifth === lastFifth) return;
            lastFifth = fifth;
            emit({ tool, status: 'running', summary: `rendering — ${Math.round((value / max) * 100)}%` });
          },
        });
        noteComfyActivity();
        return { ready, outcome };
      });
      if (run.error) {
        attempt('error', { detail: run.error });
        return { ok: false, reason: run.error };
      }
      if (!run.outcome) {
        const { ready } = run;
        const detail = ready.lastError?.error || ready.install?.reason || `engine is ${ready.state}`;
        attempt('error', { detail: `engine unavailable: ${detail}` });
        return { ok: false, reason: `the image engine could not start: ${detail}` };
      }
      const { outcome } = run;

      if (outcome.status === 'interrupted') {
        publishActivity({ jobId, phase: 'stopped', detail: 'the render was stopped' });
        attempt('stopped');
        return { ok: false, reason: 'the render was stopped' };
      }
      if (outcome.status !== 'ok') {
        publishActivity({ jobId, phase: 'error', detail: outcome.detail ?? 'unknown engine error' });
        attempt('error', { detail: outcome.detail ?? 'unknown engine error' });
        return { ok: false, reason: `the render failed: ${outcome.detail ?? 'unknown engine error'}` };
      }

      const stored = collectOutputs({ outputDir: cfg.outputDir, outputs: outcome.outputs, laneId, jobId });
      if (stored.length === 0) {
        publishActivity({ jobId, phase: 'error', detail: 'engine reported success but no image could be collected' });
        attempt('error', { detail: 'engine reported success but no image could be collected' });
        return { ok: false, reason: 'the engine reported success but no image could be collected' };
      }

      const first = stored[0];
      publishActivity({
        jobId, phase: 'done', percent: 100,
        detail: `${stored.length} image(s) · seed ${built.values.seed}`,
        images: stored.map((r) => ({ imageId: r.imageId, url: `/api/v1/image-forge/images/${r.imageId}`, mime: r.mime })),
      });
      attempt('ok', { detail: `${stored.length} image(s)` });
      emit({
        tool, status: 'ok',
        summary: `generated ${stored.length} image(s) — ${(first.bytes / 1024).toFixed(0)}KB ${first.mime}`,
        images: stored.map((r) => ({
          imageId: r.imageId, url: `/api/v1/image-forge/images/${r.imageId}`, mime: r.mime,
          bytes: r.bytes, laneId: r.laneId, path: path.join(r.dir, r.file),
        })),
      });
      const lines = stored.map((r) => `- image id: ${r.imageId} (${r.mime}, ${(r.bytes / 1024).toFixed(0)}KB)`).join('\n');
      if (pipeline.kind === 'video') {
        // The being looks at its clip across time and hears what it says (video-sight.js) —
        // the only way to judge adherence and cohesion. What could not be shown is said.
        const clip = stored[0];
        const seen = await videoSight(laneId, path.join(clip.dir, clip.file));
        const heard = seen.heard === null ? 'Its words could not be heard: the speech engine did not answer.'
          : seen.heard ? `Heard in it: "${seen.heard}"` : 'No words are heard in it.';
        const frames = seen.imageIds.length
          ? `Frames shown to you at ${seen.times.map((t) => `${t}s`).join(', ')}.`
          : 'Its frames could not be shown to you — speak of it by what you asked for, never as if you had seen it.';
        return {
          ok: true,
          detail: `Rendered with ${pipeline.label} (seed ${built.values.seed}):\n${lines}\n${heard}\n${frames} Your operator can watch and hear it in the gallery.`,
          ...(seen.imageIds.length ? { extra: { sight: { laneId, imageIds: seen.imageIds, store: 'ephemeral', purpose: 'video-frames' } } } : {}),
        };
      }
      return {
        ok: true,
        detail: `Generated with ${pipeline.label} (seed ${built.values.seed}):\n${lines}\nYour operator can see it in the stream. Review it with review_image before you speak — your judgment is kept, and it is how taste accumulates.`,
        // THE RETURN rides `extra` into the sweep's receipt, so the stream
        // places the render in front of the being's own eyes (image-sight.js).
        extra: { sight: { laneId, imageIds: stored.map((r) => r.imageId) } },
      };
    } catch (err) {
      log.error('generation threw', { laneId, err: err.message });
      publishActivity({ jobId, phase: 'error', detail: err.message });
      attempt('error', { detail: err.message });
      return { ok: false, reason: err.message };
    }
  },
});
