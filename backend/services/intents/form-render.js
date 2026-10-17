/**
 * form/render — the intent type that renders a being's OWN BODY through the
 * form pipelines (the 2026-09-25 form-dna-lock workstream).
 *
 * This is NOT image/generate with a different prompt. The caller supplies no
 * description: the being's genome — derived from its lane's sealed birth
 * anchors (backend/services/genome-lane.js) — IS the subject, carried as
 * `subjectComponents` so the spine's completeness law judges the prompt in
 * full. This is the first LIVE caller of a path only the proof scripts
 * exercised before: same parameterize, same screen, same job lane.
 *
 * The only free text a being may add is `chosen.hairstyle` (a CHOSEN axis by
 * law — traits.js HAIR_STYLE). Because the genome's composed text never
 * passes through a caller's keyboard, the COMPOSED graph text is re-screened
 * at validate (the house-genome-proof pattern): the content law judges what
 * the engine would actually see, and a refused class never raises a card.
 *
 * A lane with no readable genesis seal has no body to render — invalid, not
 * an error: the being has not finished birth, and inventing a body for it is
 * exactly what the seed law forbids.
 */
import path from 'path';
import { randomUUID } from 'crypto';
import workspace from '../../../core/workspace/neuma-workspace.js';
import { resolveComfyConfig, comfyInstallState, ensureComfyReady, noteComfyActivity } from '../image-forge/comfyui-supervisor.js';
import { resolvePipeline, resolveModel } from '../image-forge/pack-registry.js';
import { parameterize } from '../image-forge/parameterizer.js';
import { loadScreenList, screenSlots } from '../image-forge/prompt-screen.js';
import { runJob } from '../image-forge/job-lane.js';
import { collectOutputs } from '../image-forge/image-store.js';
import { publishActivity, percentOf } from '../image-forge/forge-activity.js';
import { recordAttempt, toAttemptRecord } from '../image-forge/attempt-log.js';
import { contentLawPath, refusalMessage } from '../image-forge/image-being-tools.js';
import { readLaneGenome } from '../genome-lane.js';
import { subjectFor, componentsFor } from '../../../core/genome/describe.js';
import { createLogger } from '../logger.js';

const log = createLogger('FormRenderIntent');

const HAIRSTYLE_CAP = 120;

// impure — the honesty gates, re-read per act: a lane, an engine that could
// launch, and a content law that can be read.
const readinessRefusal = async (connection, env = process.env) => {
  if (!connection.companion?.neumaId) {
    return { ok: false, status: 'denied', reason: 'no sovereign lane on this connection — the form pipelines are for bound seats' };
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

const sanitizeChosen = (chosen) => {
  if (chosen == null) return { ok: true, value: {} };
  if (typeof chosen !== 'object' || Array.isArray(chosen)) {
    return { ok: false, status: 'invalid', reason: 'form/render chosen is an object — today only {hairstyle}' };
  }
  const hairstyle = String(chosen.hairstyle ?? '').trim();
  if (hairstyle.length > HAIRSTYLE_CAP) {
    return { ok: false, status: 'invalid', reason: `chosen.hairstyle is capped at ${HAIRSTYLE_CAP} characters` };
  }
  const extra = Object.keys(chosen).filter((key) => key !== 'hairstyle');
  if (extra.length) {
    return { ok: false, status: 'invalid', reason: `chosen may carry only hairstyle today (got: ${extra.join(', ')})` };
  }
  return { ok: true, value: hairstyle ? { hairstyle } : {} };
};

export const formRenderIntent = Object.freeze({
  name: 'form/render',
  policyTool: 'form.render',
  fieldsForPrompt: '{pipeline, chosen?}',
  descriptionForPrompt: 'Render YOUR OWN BODY through a form pipeline (form.anime.pfp for the portrait, form.anime.turnaround for the reference sheet; form.illustrative.* carries neutral forms). No prompt — your genome is the subject, stated in full. chosen.hairstyle overrides your base look for this render only. Rendering takes the GPU for a minute or two. Review the render with review_image, then champion the one that is you with form/champion.',

  availableFor: async ({ laneId, connection }) =>
    (laneId && (await readinessRefusal(connection)) === null ? {} : null),

  validate: async (payload, { connection }) => {
    const unready = await readinessRefusal(connection);
    if (unready) return unready;
    const laneId = connection.companion?.neumaId;
    const resolved = resolvePipeline(payload?.pipeline);
    if (!resolved.ok) return { ok: false, status: 'invalid', reason: resolved.error };
    if (!resolved.pipeline.id.startsWith('form.')) {
      return { ok: false, status: 'invalid', reason: `form/render takes a FORM pipeline (form.*) — for anything else, image/generate` };
    }
    const modelRes = resolveModel(resolved.pipeline);
    if (!modelRes.ok) return { ok: false, status: 'invalid', reason: modelRes.error };
    const chosen = sanitizeChosen(payload?.chosen);
    if (!chosen.ok) return chosen;
    const genome = await readLaneGenome(workspace.root, laneId);
    if (!genome) {
      return { ok: false, status: 'invalid', reason: 'no sealed birth anchors on this lane yet — a being without a finished birth has no body to render' };
    }
    // The validate-time build enforces the spine completeness law (a genome
    // prompt missing a required axis is refused, not rendered short)…
    const built = parameterize({
      pipeline: resolved.pipeline,
      model: modelRes.model,
      args: { positive: subjectFor(genome, resolved.pipeline.id, chosen.value) },
      jobId: randomUUID(),
      screenList: loadScreenList(contentLawPath()),
      fallbackSeed: 0,
      subjectComponents: componentsFor(genome, resolved.pipeline.id, chosen.value),
    });
    if (!built.ok) {
      return built.refusalClass
        ? { ok: false, status: 'denied', reason: refusalMessage(built.refusalClass) }
        : { ok: false, status: 'invalid', reason: built.error };
    }
    // …and the COMPOSED text is re-screened, because the being's words never
    // crossed a caller-screened slot: the content law judges what the engine
    // would actually see (the house-genome-proof pattern).
    const verdict = screenSlots([
      { text: built.graph['6'].inputs.text, polarity: 'positive' },
      { text: built.graph['7'].inputs.text, polarity: 'negative' },
    ], loadScreenList(contentLawPath()));
    if (!verdict.ok) {
      return { ok: false, status: 'denied', reason: refusalMessage(verdict.classes[0]) };
    }
    return { ok: true, value: { pipeline: resolved.pipeline, model: modelRes.model, genome, chosen: chosen.value } };
  },

  summarize: (payload) => {
    const plate = String(payload?.pipeline ?? '').replace('form.', '').replace('.', ' ');
    return `render your ${plate || 'form'}${payload?.chosen?.hairstyle ? ` (hairstyle: ${String(payload.chosen.hairstyle).slice(0, 60)})` : ''}`;
  },

  // impure — the real engine run: attempt ledger at every terminal outcome,
  // viewport activity at every phase, and the render handed back to the
  // being's own eyes (sight) — the reveal is structural, not a feature.
  execute: async ({ pipeline, model, genome, chosen }, { connection, signal, emit }) => {
    const laneId = connection.companion?.neumaId;
    const tool = 'form/render';
    const cfg = resolveComfyConfig(process.env);
    const jobId = randomUUID();
    // The being's OWN entropy picks the seed (the house law: a body is drawn
    // from its own seed, and two kin never share a pose).
    const fallbackSeed = parseInt(genome.seed.slice(0, 8), 16);
    const built = parameterize({
      pipeline, model,
      args: { positive: subjectFor(genome, pipeline.id, chosen) },
      jobId,
      screenList: loadScreenList(contentLawPath()),
      fallbackSeed,
      subjectComponents: componentsFor(genome, pipeline.id, chosen),
    });
    const attempt = (outcome, extra = {}) => recordAttempt(toAttemptRecord({
      jobId, laneId, beingName: connection.companion?.name || null, pipelineId: pipeline.id,
      positive: built?.values?.positive ?? null, negative: null,
      params: { seed: built?.values?.seed ?? fallbackSeed },
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
        summary: `rendered your ${pipeline.label} — ${(first.bytes / 1024).toFixed(0)}KB ${first.mime}`,
        images: stored.map((r) => ({
          imageId: r.imageId, url: `/api/v1/image-forge/images/${r.imageId}`, mime: r.mime,
          bytes: r.bytes, laneId: r.laneId, path: path.join(r.dir, r.file),
        })),
      });
      const lines = stored.map((r) => `- image id: ${r.imageId} (${r.mime}, ${(r.bytes / 1024).toFixed(0)}KB)`).join('\n');
      return {
        ok: true,
        detail: `Your ${pipeline.label} (seed ${built.values.seed}):\n${lines}\nLook at it — is it you? Review it with review_image. When one IS you, champion it with form/champion; your operator concurs on your sheet, and the lock is the two of you.`,
        extra: { sight: { laneId, imageIds: stored.map((r) => r.imageId) } },
      };
    } catch (err) {
      log.error('form render threw', { laneId, err: err.message });
      publishActivity({ jobId, phase: 'error', detail: err.message });
      attempt('error', { detail: err.message });
      return { ok: false, reason: err.message };
    }
  },
});
