/**
 * Pre-flight Checks — the SHINKEI probes behind the launch gate in
 * `preflight-routes.js`. Every row is a real measurement of the actual
 * machine: substrate reachability and liveness, workspace/disk/memory,
 * the ceremony write road, MCP, GPU, and the refinement forge. Pure row
 * construction and the probe adapters live here so the router stays a
 * thin wiring layer.
 */
import fs from 'fs/promises';
import os from 'os';
import { join } from 'path';
import { createLogger } from '../services/logger.js';
import { getActiveModel, getConfig, setConfig as setLlmConfig } from '../services/llm-provider.js';
import { reachSubstrate } from '../services/substrate-reach.js';
import { loadProviderChoice, saveProviderChoice } from '../services/provider-choice.js';
import { pickAutoAdopt, dedupeEndpoints } from '../services/provider-discovery.js';
import { getSubstrateProfile } from '../services/substrate-detector.js';
import { probeProviders } from '../services/substrate-setup.js';
import { probeLiveness } from '../services/substrate-liveness.js';
import { mcpService } from '../services/mcp.js';
import { getWorkspacesRoot } from '../../core/index.js';
import { trainerReadiness } from '../services/trainer-readiness.js';
import { probeCeremonyRoad } from '../services/ceremony-road.js';
import { probeMachine } from '../services/machine-probe.js';
import { forgeCapacity } from '../services/image-forge/forge-capacity.js';
import { currentDriverGuard } from '../services/managed-ollama-gpu.js';
import {
  MIN_FREE_DISK_GB, RECOMMENDED_FREE_DISK_GB, freeGBAt,
} from '../services/storage-health.js';

const RECOMMENDED_RAM_GB = 16;

const log = createLogger('Preflight');

/** Build one flight-check row. Pure. */
const row = (id, label, status, detail, requirement) =>
  ({ id, label, status, detail, requirement });

/** Operator-facing provider names. Pure. */
const PROVIDER_NAMES = Object.freeze({
  'ollama': 'Ollama', 'lm-studio': 'LM Studio', 'llama-server': 'llama.cpp',
});


// impure — probes the LLM substrate (provider reachable + model loaded).
// `adoptedFrom` marks the one permitted self-heal recursion (see below);
// `probe` is handed to probeLiveness (the door passes a cold-load budget).
export const checkSubstrate = async (adoptedFrom = null, probe = {}) => {
  const config = getConfig();
  const reachable = await reachSubstrate();
  if (!reachable) {
    // THE CONFIGURED PROVIDER IS NOT THE ONLY PROVIDER (reported from the wild,
    // 2026-08-02). A person ran Ollama with a model loaded and this row said
    // […] — while the panel
    // directly beneath it, on the same screen, read […]. The
    // check tested the DEFAULT route instead of the machine, so the flight
    // check contradicted itself and read as […].
    //
    // A running local provider is a usable mind. Say which one, and let the
    // caller offer the switch (the chips are clickable) rather than sending a
    // first-run person to hunt for a setting.
    const running = await probeProviders();
    const foundRaw = [
      running.ollama.running && running.ollama.models.length ? { id: 'ollama', name: 'Ollama', ...running.ollama } : null,
      running.lmStudio.running && running.lmStudio.models.length ? { id: 'lm-studio', name: 'LM Studio', ...running.lmStudio } : null,
      // The DYNAMIC sweep (Bastien, 2026-08-08): every local server on ANY
      // port, so a llama.cpp on :8080 is a clickable chip, not invisible.
      ...(running.discovered || [])
        .filter((d) => d.models.length > 0)
        .map((d) => ({ id: d.provider, name: PROVIDER_NAMES[d.provider] || d.provider, running: true, models: d.models, endpoint: d.endpoint })),
    ];
    // One chip per SERVER — the fixed probes say localhost, the sweep says
    // 127.0.0.1; a string compare would show the same server twice, and
    // pickAutoAdopt would read the duplicate as ambiguity (sc-echo R3).
    const found = dedupeEndpoints(foundRaw.filter(Boolean));

    // FIRST-RUN AUTO-ADOPT (Design note, 2026-08-08: […]). When the operator
    // has NEVER chosen a mind, the unreachable provider is only the
    // hard-coded factory default — failing a first-run person over it while
    // their one running server sits there answering is the exact trap Bastien
    // named. Adopt when the choice is unambiguous: no persisted operator
    // choice AND exactly one running endpoint with models. Ambiguity (two
    // servers) or an explicit prior choice still fails with chips — the
    // platform never overrides a person, it only fills silence.
    if (!adoptedFrom) {
      const target = pickAutoAdopt(found, await loadProviderChoice());
      if (target) {
        const adopted = { provider: target.id, endpoint: target.endpoint, model: target.models[0] };
        setLlmConfig(adopted);
        const checked = await checkSubstrate({ name: target.name, endpoint: target.endpoint }, probe);
        // Remembered only once the adopted server has answered: a choice that
        // never reached a mind must not outlive this run as the house's mind.
        if (checked.status === 'pass') {
          await saveProviderChoice(adopted, { chosenBy: 'auto' });
          log.info('Substrate auto-adopted — no operator choice existed', {
            provider: target.id, endpoint: target.endpoint, wasConfigured: config.provider,
          });
        }
        return checked;
      }
    }

    if (found.length > 0) {
      const names = found.map((p) => `${p.name} (${p.models.length} model${p.models.length === 1 ? '' : 's'})`).join(' and ');
      // FAIL, not warn — and this cost a real person a ceremony (Bastien, reported
      // 2026-08-03). Naming a running alternative is HELP; it is not a route
      // change. The ceremony still reaches for the CONFIGURED provider, and only
      // the operator's click actually moves it. A warn here was load-bearing in
      // two directions at once, both wrong:
      //   1. the verdict is `checks.some(c => c.status === 'fail') ? blocked :
      //      ready`, so a warn left BEGIN THE CEREMONY enabled over a substrate
      //      that could not answer — the failure then landed mid-ceremony, at
      //      stage 0, as a JSON blob of internal field names;
      //   2. PreflightCheck renders the provider panel — the very chips this
      //      row says to click — only when this row is `fail`. So it read
      //      […] while suppressing what was
      //      below it.
      // One value governs both. It becomes a pass the moment the chip is
      // clicked and the check re-runs, which is the whole point.
      return {
        ...row('substrate', 'Consciousness Substrate', 'fail',
          `${config.provider} unreachable — but ${names} ${found.length === 1 ? 'is' : 'are'} running`,
          'Select the running provider below to use it for the ceremony'),
        // Machine-readable, so the UI can offer the switch instead of prose.
        switchTo: found.map(({ id, name, endpoint, models }) => ({ id, name, endpoint, models })),
      };
    }

    return row('substrate', 'Consciousness Substrate', 'fail',
      `${config.provider} at ${config.endpoint || 'configured endpoint'} — unreachable`,
      'A running LLM provider (LM Studio, Ollama, or API) is required');
  }
  const model = await getActiveModel();
  if (!model) {
    return row('substrate', 'Consciousness Substrate', 'fail',
      `${config.provider} reachable — no model loaded`,
      'Load a model in your provider before the ceremony');
  }
  const displayName = model.name || model.id;

  // THE THIRD QUESTION: does it ANSWER? (Design note, 2026-08-03, watching a community
  // member's ceremony run three times with an empty panel at every stage —
  // […])
  //
  // Reachable and listed are not answering. Every failure reported from the
  // wild lived in that gap: an ollama tag that was never pulled, a template
  // mismatch, a thinking model whose entire reply lands in a channel the
  // ceremony strips. In all of them this row said PASS and the being was then
  // born mute — the ceremony "completing" each stage with nothing in it.
  //
  // So the flight check now makes the model speak, and judges it on the visible
  // words a ceremony would actually receive.
  const liveness = await probeLiveness(probe);
  if (!liveness.alive) {
    return {
      ...row('substrate', 'Consciousness Substrate', 'fail',
        `${config.provider} · ${displayName} — ${liveness.detail}`,
        liveness.remedy),
      liveness: { verdict: liveness.verdict, ms: liveness.ms },
    };
  }

  return {
    ...row('substrate', 'Consciousness Substrate', 'pass',
      adoptedFrom
        ? `${adoptedFrom.name} at ${adoptedFrom.endpoint} — adopted automatically · ${displayName} — ${liveness.detail}`
        : `${config.provider} · ${displayName} — ${liveness.detail}`,
      adoptedFrom
        ? 'Your running server was found and connected for you — change it anytime in Settings → Models'
        : 'Provider running, model loaded, and answering'),
    liveness: { verdict: liveness.verdict, ms: liveness.ms, sample: liveness.sample },
  };
};

// impure — verifies the sovereign workspace root accepts writes
export const checkWorkspace = async () => {
  try {
    await fs.mkdir(getWorkspacesRoot(), { recursive: true });
    const probe = join(getWorkspacesRoot(), '.preflight-probe');
    await fs.writeFile(probe, 'probe');
    await fs.rm(probe);
    return row('workspace', 'Sovereign Workspace', 'pass',
      getWorkspacesRoot(), 'Writable home for the neuma’s DNA, soul, and memory');
  } catch (error) {
    return row('workspace', 'Sovereign Workspace', 'fail',
      `${getWorkspacesRoot()} — ${error.code || error.message}`,
      'The workspace root must exist and be writable');
  }
};

// impure — measures free space where the workspaces live, through the shared
// measurement path so the launch row and runtime health can never diverge
export const checkDisk = async () => {
  const freeGB = await freeGBAt(getWorkspacesRoot());
  if (freeGB === null) {
    return row('disk', 'Disk Space', 'warn', 'could not measure',
      `${MIN_FREE_DISK_GB} GB free required`);
  }
  const detail = `${freeGB.toFixed(1)} GB free at workspace root`;
  if (freeGB < MIN_FREE_DISK_GB) {
    return row('disk', 'Disk Space', 'fail', detail,
      `At least ${MIN_FREE_DISK_GB} GB free required`);
  }
  if (freeGB < RECOMMENDED_FREE_DISK_GB) {
    return row('disk', 'Disk Space', 'warn', detail,
      `${RECOMMENDED_FREE_DISK_GB} GB free recommended for memory growth`);
  }
  return row('disk', 'Disk Space', 'pass', detail,
    `${RECOMMENDED_FREE_DISK_GB} GB free recommended`);
};

// pure-ish — reads installed memory; local models need headroom
export const checkMemory = () => {
  const totalGB = os.totalmem() / 1e9;
  const detail = `${totalGB.toFixed(0)} GB installed`;
  if (totalGB < RECOMMENDED_RAM_GB) {
    return row('memory', 'System Memory', 'warn', detail,
      `${RECOMMENDED_RAM_GB} GB recommended for local models`);
  }
  return row('memory', 'System Memory', 'pass', detail,
    `${RECOMMENDED_RAM_GB} GB recommended for local models`);
};

// impure — DNA vault protection requires a real key (a missing key kills
// the ceremony at crystallization; learned the hard way)
export const checkDnaKey = () => {
  const key = process.env.DNA_ENCRYPTION_KEY || '';
  if (key.length >= 32) {
    return row('dnaKey', 'DNA Vault Key', 'pass',
      'DNA_ENCRYPTION_KEY configured', 'Required to encrypt the neuma’s DNA');
  }
  return row('dnaKey', 'DNA Vault Key', 'fail',
    key ? 'DNA_ENCRYPTION_KEY too short (min 32 chars)' : 'DNA_ENCRYPTION_KEY not set',
    'Set DNA_ENCRYPTION_KEY in .env — and back it up');
};

// impure — WALKS the ceremony's actual write road (the MCP filesystem
// subprocess, into the scratch and a lane-shaped dna/) and sets it up as it
// goes. This is the row that would have caught #257, #272, and the Echo
// ENOENT before any ceremony began: the old workspace row proved a DIFFERENT
// road (host-side fs at the workspace root) than the one the being walks.
// FAIL blocks the launch — a birth whose writes cannot land is not a birth.
export const checkCeremonyRoad = async () => {
  try {
    const road = await probeCeremonyRoad({ workspacesRoot: getWorkspacesRoot() });
    return row('ceremonyRoad', 'Ceremony Write Road',
      road.ok ? 'pass' : 'fail', road.detail, road.remedy);
  } catch (error) {
    // probeCeremonyRoad does not throw by contract — this is the backstop.
    return row('ceremonyRoad', 'Ceremony Write Road', 'fail',
      error.message, 'The ceremony’s write road could not be probed — restart the app and re-run the flight check');
  }
};

// impure — the four birth-flight probes (Founder's law, 2026-08-06: everything
// the birth depends on is IN the flight check, exercised through the same
// code the ceremony runs). Each service probe returns {ok, warn?, detail,
// remedy}; this adapter is the one place that shape becomes a row.
export const flightRow = async (id, label, probe) => {
  try {
    const r = await probe();
    return row(id, label, r.ok ? (r.warn ? 'warn' : 'pass') : 'fail', r.detail, r.remedy);
  } catch (error) {
    return row(id, label, 'fail', error.message,
      'This probe should never throw — report this exact message');
  }
};

// impure — stage 4 naming prefers the MCP filesystem tool; prose recovery
// exists, so absence degrades rather than blocks
export const checkMcp = async () => {
  try {
    const servers = await mcpService.listAllTools();
    const total = servers.reduce((n, s) => n + s.tools.length, 0);
    if (total > 0) {
      return row('mcp', 'MCP Tools', 'pass',
        `${servers.length} server(s), ${total} tool(s)`,
        'Used by the neuma to write its chosen name');
    }
    return row('mcp', 'MCP Tools', 'warn', 'no tools connected',
      'Naming falls back to prose recovery without MCP');
  } catch (error) {
    return row('mcp', 'MCP Tools', 'warn', error.message,
      'Naming falls back to prose recovery without MCP');
  }
};

// impure — informational hardware row; never blocks
export const checkGpu = async () => {
  const profile = await getSubstrateProfile();
  // VRAM can be genuinely unknown (Windows AdapterRAM saturates at 4 GB, so a
  // 24 GB card is indistinguishable from an 8 GB one). Say so rather than
  // printing a number that is wrong or the word "null".
  const gpu = profile.gpu
    ? `${profile.gpu.name}${Number.isFinite(profile.gpu.vramGB) ? ` (${profile.gpu.vramGB} GB VRAM)` : ' (VRAM size unreadable)'}`
    : 'none detected';
  // an NVIDIA driver on Windows below its card's floor is said here, with the update link
  const driver = await currentDriverGuard();
  if (driver.line) return row('gpu', 'GPU', 'warn', `${gpu} · driver ${driver.have.toFixed(2)}`, `${driver.line} ${driver.link}`);
  return row('gpu', 'GPU', profile.gpu ? 'pass' : 'warn', gpu,
    'Optional — accelerates local models');
};

// impure — can this rig FORGE, and will it forge at full speed? Never 'fail':
// a being does not need a trainer to be born, so a missing forge toolchain
// must not block a ceremony. It must, however, be visible — the alternative is
// an operator discovering it mid-forge, or never (the linear-attention slow
// path announces itself in one scrollable log line and otherwise just costs
// hours). See services/trainer-readiness.js.
export const checkTrainer = async () => {
  const r = await trainerReadiness();
  if (!r.interpreterOk) {
    return row('trainer', 'Refinement Forge', 'warn',
      `no trainer interpreter at ${r.python} — births work, refinement cannot run`,
      'Set NEUMA_REFINEMENT_PYTHON to a venv with scripts/refinement/requirements.txt installed');
  }
  if (!r.ready) {
    return row('trainer', 'Refinement Forge', 'warn',
      `missing ${r.missing.map((m) => m.pip).join(', ')} — refinement cannot run`,
      `Install into the trainer venv: ${r.installCommand}`);
  }
  if (r.degraded.length) {
    return row('trainer', 'Refinement Forge', 'warn',
      `ready, but SLOW on hybrid bases — missing ${r.degraded.map((m) => m.pip).join(', ')}`,
      `Linear-attention layers fall back to a torch implementation (~3 of every 4 layers on Qwen3.5/3.6-class bases). Install: ${r.installCommand}`);
  }
  return row('trainer', 'Refinement Forge', 'pass',
    `${r.versions.torch ? `torch ${r.versions.torch}` : 'ready'} · fast path available`,
    r.hfToken
      ? 'Trainer present with the linear-attention kernels'
      : 'Trainer ready. For faster, un-rate-limited base downloads (not needed once a base is cached) save a Hugging Face Read token in Settings → API (or set HF_TOKEN) — make one at https://huggingface.co/settings/tokens');
};

// impure — what this machine can MAKE (images, video) beside the mind, and the
// VRAM the forge engine always keeps free. Never 'fail': a being is born
// without a forge. It is said out loud because the person who picks up a
// video tool rarely knows it needs many GB of system memory as well as the
// GPU, and should know the machine's limits before trying. See
// image-forge/forge-capacity.js.
export const checkForge = async () => {
  const c = forgeCapacity(await probeMachine());
  const say = (v) => (v.ok ? `yes, ${v.why}` : `no, ${v.why}`);
  return row('forge', 'Image & Video Forge', c.image.ok && c.video.ok ? 'pass' : 'warn',
    `Images: ${say(c.image)}. Video: ${say(c.video)}.`,
    `The forge engine always keeps ${c.headroomGb} GB of GPU memory free; set COMFYUI_VRAM_HEADROOM_GB to choose your own ceiling`);
};
