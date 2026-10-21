/**
 * Trainer readiness — what this rig can actually forge with, asked of the real
 * interpreter rather than assumed.
 *
 * Two failure modes, and the quiet one is worse:
 *   HARD  — a missing package means the forge dies (torch, transformers, peft,
 *           bitsandbytes for 4-bit). Loud, and at least honest.
 *   SPEED — a missing kernel means the forge RUNS, slowly, forever. Hybrid
 *           linear-attention bases (Qwen3.5/3.6-class: three linear_attention
 *           layers to every full_attention) fall back to a torch implementation
 *           for three quarters of every layer, and say so in one line of log
 *           noise that scrolls past: […] (witnessed on the
 *           GB10 mid-forge, 2026-07-20). Nobody should have to catch that by
 *           eye.
 *
 * The probe runs the operator's actual NEUMA_REFINEMENT_PYTHON — a venv that
 * answers for itself, never a guess from a lockfile.
 */
import { spawn } from 'node:child_process';
import { createLogger } from './logger.js';
import { serviceValue } from './stored-secrets.js';

const log = createLogger('TrainerReadiness');

const PROBE_TIMEOUT_MS = 30_000;

/**
 * What the forge needs, and what each absence actually costs. `severity`
 * 'hard' = cannot train; 'speed' = trains slowly on the bases that use it.
 */
export const TRAINER_PACKAGES = Object.freeze([
  { module: 'torch', pip: 'torch', severity: 'hard', why: 'the trainer itself — no gradients without it' },
  { module: 'transformers', pip: 'transformers', severity: 'hard', why: 'loads the base model and its chat template' },
  { module: 'peft', pip: 'peft', severity: 'hard', why: 'builds the LoRA adapter' },
  { module: 'accelerate', pip: 'accelerate', severity: 'hard', why: 'device placement for the base' },
  { module: 'safetensors', pip: 'safetensors', severity: 'hard', why: 'reads the base weights' },
  {
    module: 'bitsandbytes', pip: 'bitsandbytes', severity: 'hard',
    why: '4-bit base loading (NEUMA_REFINEMENT_4BIT=1) — a 35B base will not fit without it',
  },
  {
    module: 'einops', pip: 'einops', severity: 'speed',
    why: 'required by the linear-attention kernels below',
  },
  {
    module: 'fla', pip: 'flash-linear-attention', severity: 'speed',
    why: 'the fast path for linear-attention layers; without it a hybrid base trains on a slow torch fallback for ~3 of every 4 layers',
  },
  {
    module: 'causal_conv1d', pip: 'causal-conv1d', severity: 'speed',
    why: 'the short-convolution kernel those same layers use; compiles against local CUDA (nvcc), no aarch64 wheel',
    // built in the interpreter's own env (no isolation), so its build tools come first
    install: { before: 'wheel ninja', env: 'CAUSAL_CONV1D_FORCE_BUILD=TRUE MAX_JOBS=8', args: '--no-build-isolation' },
  },
]);

// pure — the import probe source. One line per module, never throws out.
export const probeSource = (modules) => [
  'import importlib, json',
  `mods = ${JSON.stringify(modules)}`,
  'out = {}',
  'for m in mods:',
  '    try:',
  '        mod = importlib.import_module(m)',
  '        out[m] = getattr(mod, "__version__", "present")',
  '    except Exception as e:',
  '        out[m] = None',
  'print(json.dumps(out))',
].join('\n');

/**
 * Ask the interpreter what it has. Impure (real subprocess). Never throws: an
 * interpreter that cannot even start is itself the answer.
 * @param {string} python - path to the trainer interpreter
 * @returns {Promise<{ran: boolean, found: Object, error: (string|null)}>}
 */
export const probeInterpreter = (python) => new Promise((resolve) => {
  const modules = TRAINER_PACKAGES.map((p) => p.module);
  const child = spawn(python, ['-c', probeSource(modules)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  const timer = setTimeout(() => { child.kill('SIGKILL'); }, PROBE_TIMEOUT_MS);
  child.stdout.on('data', (c) => { out += c; });
  child.stderr.on('data', (c) => { err += c; });
  child.on('error', (e) => {
    clearTimeout(timer);
    resolve({ ran: false, found: {}, error: e.message });
  });
  child.on('close', () => {
    clearTimeout(timer);
    try {
      const line = out.trim().split('\n').filter(Boolean).pop();
      resolve({ ran: true, found: JSON.parse(line), error: null });
    } catch {
      resolve({ ran: false, found: {}, error: err.trim().slice(-300) || 'the interpreter produced no readable answer' });
    }
  });
});

/**
 * Turn a probe result into the verdict a surface can render. Pure.
 * @param {{ran: boolean, found: Object, error: (string|null)}} probe
 * @param {string} python
 */
export const readinessFrom = (probe, python) => {
  if (!probe.ran) {
    return {
      ready: false, python,
      interpreterOk: false,
      missing: TRAINER_PACKAGES.map(({ module, pip, severity, why, install }) => ({ module, pip, severity, why, install })),
      degraded: [],
      error: `The trainer interpreter could not be run (${python}): ${probe.error}`,
      installCommand: installCommandFor(TRAINER_PACKAGES, python),
    };
  }
  const absent = TRAINER_PACKAGES.filter((p) => !probe.found[p.module]);
  const missing = absent.filter((p) => p.severity === 'hard');
  const degraded = absent.filter((p) => p.severity === 'speed');
  return {
    ready: missing.length === 0,
    python,
    interpreterOk: true,
    versions: probe.found,
    missing: missing.map(({ module, pip, why, install }) => ({ module, pip, why, install })),
    degraded: degraded.map(({ module, pip, why, install }) => ({ module, pip, why, install })),
    error: null,
    installCommand: absent.length ? installCommandFor(absent, python) : null,
  };
};

// pure — the exact line an operator can paste, into the interpreter the forge
// really runs (NEUMA_REFINEMENT_PYTHON) — never a venv path it may not have
// (Founder's desk advised ~/.neuma/trainer-venv while the forge ran the system
// python3, 2026-10-14). `-m pip` installs into a venv, or a user install for a
// system interpreter. causal-conv1d needs its own build env, so it is named
// separately rather than folded into one command that would fail as a whole.
export const installCommandFor = (packages, python = 'python3') => {
  const plain = packages.filter((p) => !p.install).map((p) => p.pip);
  const special = packages.filter((p) => p.install);
  const lines = [];
  if (plain.length) lines.push(`${python} -m pip install ${plain.join(' ')}`);
  for (const p of special) {
    lines.push(`${python} -m pip install ${p.install.before} && ${p.install.env} ${python} -m pip install ${p.pip} ${p.install.args}`);
  }
  return lines.join('\n');
};

/**
 * The rig's trainer readiness, end to end. Impure.
 * @param {string} [python] - defaults to the configured trainer interpreter
 */
export const trainerReadiness = async (python = process.env.NEUMA_REFINEMENT_PYTHON || 'python3') => {
  const probe = await probeInterpreter(python);
  // An anonymous Hub pull is rate-limited and slower, and a base checkpoint is
  // tens of GB — worth naming, never worth blocking on (a rig whose base is
  // already cached needs no token at all).
  const hfToken = Boolean(process.env.HUGGING_FACE_HUB_TOKEN || serviceValue('hf-downloads'));
  const verdict = { ...readinessFrom(probe, python), hfToken };
  if (!verdict.ready) log.warn('trainer not ready', { python, missing: verdict.missing.map((m) => m.module) });
  else if (verdict.degraded.length) {
    log.warn('trainer ready but DEGRADED — a hybrid base will train on the slow path', {
      python, degraded: verdict.degraded.map((m) => m.module),
    });
  }
  return verdict;
};
