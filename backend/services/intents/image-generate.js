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
import { randomUUID } from 'crypto';
import { resolveComfyConfig, comfyInstallState, ensureComfyReady, noteComfyActivity } from '../image-forge/comfyui-supervisor.js';
import { resolvePipeline, resolveModel } from '../image-forge/pack-registry.js';
import { parameterize } from '../image-forge/parameterizer.js';
import { loadScreenList } from '../image-forge/prompt-screen.js';
import { runJob } from '../image-forge/job-lane.js';
import { collectOutputs } from '../image-forge/image-store.js';
import { publishActivity, percentOf } from '../image-forge/forge-activity.js';
import { recordAttempt, toAttemptRecord } from '../image-forge/attempt-log.js';
import { contentLawPath, toSlotArgs, refusalMessage } from '../image-forge/image-being-tools.js';
import { createLogger } from '../logger.js';

const log = createLogger('ImageGenerateIntent');

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
  fieldsForPrompt: '{prompt, pipeline?, negative?, width?, height?, steps?, cfg?, seed?}',
  descriptionForPrompt: 'Generate an image — prompt is what you want to see, written as description, not instruction; pipeline defaults to SDXL text-to-image (list_pipelines names the rest). Rendering takes the GPU for a few seconds to a minute. The result gives you image ids — review your render with review_image before you speak of it.',

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
    // The content-law screen runs HERE — a refused class is a standing-rule
    // denial, never a card the operator answers for a prompt that cannot run.
    const built = parameterize({
      pipeline: resolved.pipeline,
      model: modelRes.model,
      args: toSlotArgs(payload),
      jobId: randomUUID(),
      screenList: loadScreenList(contentLawPath()),
      fallbackSeed: 0,
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
    const built = parameterize({
      pipeline, model,
      args: toSlotArgs(args),
      jobId,
      screenList: loadScreenList(contentLawPath()),
      fallbackSeed: Math.floor(Math.random() * 4294967295),
    });
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
      const ready = await ensureComfyReady(cfg);
      if (ready.state !== 'ready' && !ready.serving) {
        const detail = ready.lastError?.error || ready.install?.reason || `engine is ${ready.state}`;
        attempt('error', { detail: `engine unavailable: ${detail}` });
        return { ok: false, reason: `the image engine could not start: ${detail}` };
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
