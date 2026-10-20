/**
 * The parameterizer (B-15) — caller intent becomes an engine graph, or a
 * refusal. Pure.
 *
 * This is the ONLY door onto the template path, so it owns three duties that
 * must never be skippable:
 *   1. THE SCREEN. Every caller-writable text slot crosses the content law
 *      BEFORE a graph is built or anything is enqueued (FR-15). A refusal
 *      names the CLASS only, never the matched term (FR-31).
 *   2. THE WHITELIST. Only slots the pipeline declares may be set. An unknown
 *      slot is a refusal, not a silently-dropped key — a caller that believes
 *      in a knob that does not exist should be told so.
 *   3. THE SERVER-SIDE MINTS. `filename_prefix` and the seed are minted here
 *      from the job id, never taken from caller text. A caller-controlled
 *      prefix is a path-traversal primitive into the output tree.
 *
 * Prompt text lands as DATA in a freshly-built graph (`templates.js` builds
 * object literals) — never string-templated into JSON, so no prompt can inject
 * a node.
 */
import {
  buildTxt2Img, buildImg2Img, buildForm, buildAnima, buildZImage,
} from './templates.js';
import { buildFlux2, buildFlux2Edit, buildZImageControl } from './templates-flux2.js';
import { buildLtxI2v } from './templates-video.js';
import { VIDEO_ASPECTS, VIDEO_FILE_KEYS } from './pipelines-video.js';
import { resolveLoras, resolveControlNet, resolvePatch } from './pack-registry.js';
import {
  composeSpine, missingFrom, unknownIn, PIPELINE, BEING,
} from '../../../core/genome/prompt-spine.js';
import { screenSlots } from './prompt-screen.js';

// A reference costs a VAE encode and lengthens the model's context; past three
// photos of one face the likeness stops improving and the render slows.
export const MAX_MORE_REFERENCES = 2;

/** Clamp a number into a closed range. Pure. */
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

// A job id reaches the filesystem through `filename_prefix`, so it is reduced
// to an unmistakably safe alphabet here regardless of who minted it. Defense in
// depth: templates.js also refuses an escaping prefix.
const safeJobSegment = (jobId) => String(jobId ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);

// THE OUTPUT GROUP — the folder a render lands in, and it is NOT a caller knob.
//
// Every job used to write into one flat `neuma/` directory: a being's actual
// requested picture beside two hundred lab renders from a prompt sweep. Founder,
// 2026-08-27: […]
//
// So a TRUSTED IN-REPO SCRIPT may name its own group (`samples/sweeps`), while
// the production path keeps `neuma/` and never passes one. This is reachable
// from `parameterize`'s signature and not from any slot, so no prompt, no being
// and no HTTP body can steer it — and it is reduced to a safe alphabet here
// anyway, with templates.js refusing an escaping prefix as the second gate.
const safeGroup = (group) => String(group ?? 'neuma')
  .split('/')
  .map((s) => s.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32))
  .filter(Boolean)
  .slice(0, 3)
  .join('/') || 'neuma';

/**
 * Coerce and bound ONE declared slot. Enums refuse on a miss (so the caller
 * learns the real vocabulary); numeric slots clamp (so an over-eager number
 * yields a picture rather than an error). Pure.
 * @returns {{ok: true, value: *} | {ok: false, error: string}}
 */
const applySlot = (name, spec, raw) => {
  switch (spec.type) {
    case 'text': {
      if (typeof raw !== 'string') return { ok: false, error: `'${name}' must be text` };
      return { ok: true, value: raw };
    }
    case 'enum': {
      const n = typeof raw === 'string' ? Number(raw) : raw;
      const value = Number.isFinite(n) ? n : raw;
      if (!spec.values.includes(value)) {
        return { ok: false, error: `'${name}' must be one of: ${spec.values.join(', ')}` };
      }
      return { ok: true, value };
    }
    case 'int': {
      const n = Number(raw);
      if (!Number.isFinite(n)) return { ok: false, error: `'${name}' must be a number` };
      return { ok: true, value: Math.round(clamp(n, spec.min, spec.max)) };
    }
    case 'float': {
      const n = Number(raw);
      if (!Number.isFinite(n)) return { ok: false, error: `'${name}' must be a number` };
      return { ok: true, value: clamp(n, spec.min, spec.max) };
    }
    default:
      // An unknown slot TYPE is a registry authoring error; fail closed rather
      // than passing an unvalidated value to the engine.
      return { ok: false, error: `'${name}' has an unsupported slot type` };
  }
};

/**
 * Resolve caller args against a pipeline's declared slots. Unknown args refuse;
 * absent args take the declared default. Pure.
 * @returns {{ok: true, values: object} | {ok: false, error: string}}
 */
export const resolveSlots = (pipeline, args) => {
  const supplied = args && typeof args === 'object' ? args : {};
  const unknown = Object.keys(supplied).filter((k) => !(k in pipeline.slots));
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `unknown parameter${unknown.length > 1 ? 's' : ''} for '${pipeline.id}': ${unknown.join(', ')} — accepted: ${Object.keys(pipeline.slots).join(', ')}`,
    };
  }
  const values = {};
  for (const [name, spec] of Object.entries(pipeline.slots)) {
    const has = Object.prototype.hasOwnProperty.call(supplied, name) && supplied[name] !== null && supplied[name] !== undefined;
    if (!has) {
      if (spec.required) return { ok: false, error: `'${name}' is required for '${pipeline.id}'` };
      values[name] = spec.default ?? null;
      continue;
    }
    const applied = applySlot(name, spec, supplied[name]);
    if (!applied.ok) return applied;
    values[name] = applied.value;
  }
  return { ok: true, values };
};

/**
 * Build the enqueueable graph for one call, or refuse.
 *
 * `fallbackSeed` is supplied by the impure caller (a pure function cannot mint
 * randomness) and is used only when the caller named no seed.
 *
 * @param {object} p
 * @param {object} p.pipeline   from `resolvePipeline`
 * @param {object} p.model      from `resolveModel`
 * @param {object} p.args       caller-supplied slot values
 * @param {string} p.jobId      server-minted
 * @param {object} p.screenList compiled content law (`loadScreenList`)
 * @param {number} p.fallbackSeed
 * @param {string} [p.sourceImageName] engine-authoritative name from /upload/image
 * @param {string[]} [p.moreReferenceNames] further uploaded photos of the same
 *   subject, for the edit pipelines that read references (at most
 *   MAX_MORE_REFERENCES; extra are refused, not silently dropped).
 * @param {Record<string, string>} [p.subjectComponents] a GENOME's own spine
 *   components. When present the completeness law is enforced in full — that is
 *   the prompt a look gets locked on. A being's free-text `positive` instead
 *   takes the subject band and only the structured parts are enforced.
 * @param {string} [p.outputGroup] output subfolder — 'neuma' for real jobs, a
 *   `samples/...` group for in-repo lab scripts. NOT a slot: unreachable from
 *   caller args, and sanitized regardless.
 * @returns {{ok: true, graph: object, values: object} | {ok: false, error: string, refusalClass?: string}}
 */
export const parameterize = ({
  pipeline, model, args, jobId, screenList, fallbackSeed,
  sourceImageName = null, moreReferenceNames = [], outputGroup = 'neuma', subjectComponents = null,
}) => {
  const resolved = resolveSlots(pipeline, args);
  if (!resolved.ok) return resolved;
  const v = resolved.values;

  // ── THE SCREEN, before anything is built or enqueued ──
  // Polarity travels with each slot: a NEGATIVE prompt excludes a concept, so
  // reading its terms as requests inverts their meaning and refuses the being
  // for protecting itself (see screenSlots). A slot with no declared polarity
  // is treated as positive — the conservative default.
  const screened = Object.entries(pipeline.slots)
    .filter(([, spec]) => spec.screened)
    .map(([name, spec]) => ({ text: v[name], polarity: spec.polarity === 'negative' ? 'negative' : 'positive' }))
    .filter((s) => typeof s.text === 'string' && s.text.length > 0);
  const verdict = screenSlots(screened, screenList);
  if (!verdict.ok) {
    // The class only — echoing the matched term would teach the filter.
    return { ok: false, error: 'refused by content law', refusalClass: verdict.classes[0] };
  }

  if (pipeline.requiresSourceImage && !sourceImageName) {
    return { ok: false, error: `'${pipeline.id}' needs a source image — upload one first` };
  }

  const segment = safeJobSegment(jobId);
  if (!segment) return { ok: false, error: 'job id did not survive sanitization — cannot mint an output path' };

  // ── THE SCAFFOLD, composed AFTER the screen ──
  // A pipeline may own quality anchors and framing so craft is not something
  // every caller has to know how to write (Founder: […]). Order is load-bearing and must never be
  // swapped: the caller's own text was screened UNCHANGED above, so a scaffold
  // can neither smuggle anything past the screen nor change which class a
  // refusal reports. The scaffold itself is a frozen in-repo constant — screening
  // our own authored text would be theatre, not safety.
  const sc = pipeline.scaffold;
  let positive = v.positive;
  if (sc?.components) {
    // ⭐ THE SPINE — Design note, 2026-08-27: […]
    //
    // The caller's SUBJECT is a genome already composed through the genome half
    // of the spine (`describeAsComponents`), so it arrives as one string and
    // occupies the genome band. The pipeline contributes the rest by NAME, and
    // `composeSpine` — not whoever wrote the scaffold — decides where each sits.
    //
    // ⚠️ Byte-identical to the prefix/suffix concatenation it replaced at default
    // weights. The structure became data; the output did not move, so no
    // approved render is invalidated.
    // A GENOME arrives as components and is audited in full — that prompt is the
    // one that gets locked. A being's own free text arrives as one string, takes
    // the subject band, and only the parts we structure are enforced.
    const fromGenome = subjectComponents && typeof subjectComponents === 'object';
    // `__excludeSex` rides alongside the components rather than in them: it is
    // NEGATIVE text, and the spine composes the positive. Stripped here so the
    // unknown-component check still sees only real spine keys.
    const { __excludeSex: _ignored, ...genomeParts } = subjectComponents ?? {};
    const parts = fromGenome
      ? { ...sc.components, ...genomeParts }
      : { ...sc.components, sex: v.positive };
    const missing = missingFrom(parts, fromGenome ? null : [PIPELINE, BEING]);
    if (missing.length > 0) {
      // A prompt that lost a required component still RENDERS, still looks fine,
      // and is quietly a different being — and if that render is the one somebody
      // locks, the body is wrong forever. So this refuses instead.
      return { ok: false, error: `prompt spine incomplete for '${pipeline.id}': missing ${missing.join(', ')}` };
    }
    const unknown = unknownIn(parts);
    if (unknown.length > 0) {
      // A clause the schema does not know has no defined position and no weight,
      // and it silently drifts the LoRA's caption schema.
      return { ok: false, error: `'${pipeline.id}' declares components the spine does not know: ${unknown.join(', ')}` };
    }
    positive = composeSpine(parts, sc.weights ?? {});
  }
  const callerNegative = v.negative ?? '';
  // ⭐ THE GENOME REACHES THE NEGATIVE TOO — Design note, 2026-08-27: […] Genome path only: a being's free text has no derived sex to
  // enforce, and inventing one for it would be the platform deciding.
  const sexGuard = subjectComponents && typeof subjectComponents === 'object'
    ? String(subjectComponents.__excludeSex ?? '')
    : '';
  const negative = [callerNegative, sc?.negative?.append, sexGuard]
    .filter((part) => typeof part === 'string' && part.trim() !== '')
    .join(', ');

  const common = {
    positive,
    negative,
    ckptName: model.ckptName,
    seed: v.seed ?? fallbackSeed,
    steps: v.steps,
    cfg: v.cfg,
    samplerName: v.samplerName,
    scheduler: v.scheduler,
    // Server-minted, never caller text. The GROUP separates a being's requested
    // renders from in-repo lab output; both halves are sanitized above.
    filenamePrefix: `${safeGroup(outputGroup)}/${segment}`,
  };

  if (pipeline.template === 'ltxi2v') {
    // Video: the model's own two-stage recipe is pinned inside the builder, so
    // only the prompt, seed, length and canvas travel from the slots; the
    // model's files travel by name.
    const canvas = VIDEO_ASPECTS[v.aspect];
    const files = Object.fromEntries(VIDEO_FILE_KEYS.filter((k) => model[k]).map((k) => [k, model[k]]));
    const values = {
      positive, seed: common.seed, seconds: v.seconds, ...canvas, imageName: sourceImageName,
      filenamePrefix: common.filenamePrefix, ...files,
    };
    return { ok: true, graph: buildLtxI2v(values), values };
  }

  if (pipeline.template === 'flux2' || pipeline.template === 'flux2edit' || pipeline.template === 'zimagecontrol') {
    // The custom-sampler families. Guidance, sampler and scheduler are the
    // MODEL'S (pinned inside the builders), so only seed and steps travel from
    // the slots; there is no negative — both zero it by construction.
    //
    // A pipeline-owned `instruction` (the team portrait's house look) LEADS and
    // the caller's screened text follows as direction. The caller's words were
    // screened unchanged above; the instruction is a frozen in-repo constant.
    const text = [pipeline.instruction, v.positive ? `Additional direction: ${v.positive}` : '']
      .filter((part) => typeof part === 'string' && part.trim() !== '')
      .join(' ');
    const { ckptName, negative: _zeroed, ...rest } = common;
    const base = {
      ...rest,
      positive: pipeline.instruction ? text : v.positive,
      unetName: model.unetName,
      clipName: model.clipName,
      clipType: model.clipType,
      vaeName: model.vaeName,
    };
    if (pipeline.template === 'flux2') {
      const graph = buildFlux2({ ...base, width: v.width, height: v.height });
      return { ok: true, graph, values: { ...base, width: v.width, height: v.height } };
    }
    if (pipeline.template === 'flux2edit') {
      const more = Array.isArray(moreReferenceNames) ? moreReferenceNames.filter((n) => typeof n === 'string' && n) : [];
      if (more.length > MAX_MORE_REFERENCES) {
        return { ok: false, error: `'${pipeline.id}' takes at most ${MAX_MORE_REFERENCES + 1} photos of one subject` };
      }
      // Said once, by the platform, and only for a PORTRAIT: there the extra
      // photos are likeness, not content. A general edit may combine images.
      const withRefs = more.length > 0 && pipeline.kind === 'portrait'
        ? `${base.positive} The other reference images show the same person from other angles; use them for likeness only.`
        : base.positive;
      const geometry = pipeline.fixed ? { width: pipeline.fixed.width, height: pipeline.fixed.height } : {};
      const graph = buildFlux2Edit({
        ...base, positive: withRefs, ...geometry, imageNames: [sourceImageName, ...more],
      });
      return { ok: true, graph, values: { ...base, ...geometry } };
    }
    const patch = resolvePatch(pipeline);
    if (!patch.ok) return patch;
    if (!patch.patch) return { ok: false, error: `'${pipeline.id}' is a controlled pipeline but names no model patch` };
    const control = {
      shift: model.shift, patchName: patch.patch.patchName,
      strength: v.strength, controlMode: v.controlMode, imageName: sourceImageName,
    };
    const graph = buildZImageControl({ ...base, ...control });
    return { ok: true, graph, values: { ...base, strength: v.strength, controlMode: v.controlMode } };
  }

  if (pipeline.template === 'anima' || pipeline.template === 'zimage') {
    // A different FAMILY, not a different style: three loaders instead of one,
    // so `ckptName` is meaningless here and the model's own file names travel
    // instead. The geometry pin and the LoRA chain work exactly as they do for
    // the SDXL form pipelines; there is no control branch, because an SDXL
    // OpenPose net cannot condition a diffusion transformer.
    //
    // Anima and Z-Image share this door because they share the LOADER SHAPE —
    // UNET + separate text encoder + separate VAE. They differ downstream (SD3
    // latent, an AuraFlow sampling shift), and that difference lives entirely in
    // the two template builders, where it can be read against the two bundled
    // ComfyUI templates it was copied from. `shift` rides on the MODEL, not on
    // the pipeline: it is a property of the architecture, not a house knob.
    const loras = resolveLoras(pipeline);
    if (!loras.ok) return loras;
    const { ckptName, ...rest } = common;
    const geometry = { width: pipeline.fixed.width, height: pipeline.fixed.height };
    const build = pipeline.template === 'zimage' ? buildZImage : buildAnima;
    const graph = build({
      ...rest,
      ...geometry,
      unetName: model.unetName,
      clipName: model.clipName,
      clipType: model.clipType,
      vaeName: model.vaeName,
      shift: model.shift,
      loras: loras.loras,
      // Declared by the pipeline, never by a caller — the framing of a plate is
      // the pipeline's job, exactly like its geometry.
      portraitCrop: pipeline.portraitCrop === true,
    });
    return { ok: true, graph, values: { ...rest, ...geometry } };
  }

  if (pipeline.template === 'form') {
    // `fixed` is the pipeline's own pinned geometry — a turnaround is 1344x768
    // because that is what fits three figures, and squaring it would destroy
    // the only thing the pipeline is for. Pinned values are not slots, so
    // naming one is an unknown-parameter refusal like any other.
    const loras = resolveLoras(pipeline);
    if (!loras.ok) return loras;
    const control = resolveControlNet(pipeline);
    if (!control.ok) return control;
    const graph = buildForm({
      ...common,
      width: pipeline.fixed.width,
      height: pipeline.fixed.height,
      loras: loras.loras,
      ...(control.controlNet
        ? {
          controlNetName: control.controlNet.controlNetName,
          controlImage: control.poseImage,
          controlStrength: pipeline.controlStrength,
        }
        : {}),
    });
    return { ok: true, graph, values: { ...common, width: pipeline.fixed.width, height: pipeline.fixed.height } };
  }

  const graph = pipeline.template === 'img2img'
    ? buildImg2Img({ ...common, imageName: sourceImageName, denoise: v.denoise })
    : buildTxt2Img({ ...common, width: v.width, height: v.height });

  return { ok: true, graph, values: { ...common } };
};
