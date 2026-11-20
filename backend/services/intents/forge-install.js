/**
 * forge/install-model — a neuma installs a model into the image engine itself (image-forge/model-install.js; Founder,
 * 2026-11-20: […]). It names a Hugging Face repo and a file; the operator says yes once (the card
 * names both and the folder); the platform downloads it into the engine, checked byte for byte against the
 * publisher's SHA-256. list_pipelines names the installs a pipeline still waits for.
 * Nothing leaves the machine before the yes: the address a being chooses can carry its context out (audit P6-04),
 * so even the file's size is read only after the card.
 */
import { webSettings } from '../web-settings.js';
import { resolveComfyConfig, comfyInstallState } from '../image-forge/comfyui-supervisor.js';
import { parseInstall, installModel, MODEL_FOLDERS } from '../image-forge/model-install.js';
import { screenWebEgress } from '../web-egress-screen.js';

const gb = (bytes) => `${(bytes / 1024 ** 3).toFixed(2)} GB`;

export const forgeInstallIntent = Object.freeze({
  name: 'forge/install-model',
  policyTool: 'forge.install',
  fieldsForPrompt: '{repo, file, revision?, folder?}',
  descriptionForPrompt: `Install a model into the image engine yourself: a file from a Hugging Face repo, downloaded straight into the engine's model folder and checked byte for byte against the SHA-256 its publisher put on Hugging Face — never installed unchecked. repo is owner/name; file is its path in the repo (e.g. "diffusion_models/flux3-image-klein-int8-convrot.safetensors"); folder is one of ${MODEL_FOLDERS.join(', ')} when the path names none. Only .safetensors (a .ckpt/.pt/.bin is a pickle, and loading one runs code). A gated repo opens once the operator accepted its licence on huggingface.co with the account whose token is in Settings › API. Your operator approves each install. list_pipelines tells you which files a pipeline still needs and the exact installs that bring them; a model no pipeline names is on disk but not callable until one does.`,
  // impure — offered where there is an engine to install into and the web is on.
  availableFor: async ({ laneId }) => {
    if (!laneId || !await webSettings.isEnabled()) return null;
    const cfg = resolveComfyConfig(process.env);
    return comfyInstallState(cfg).installed && cfg.modelsDir ? {} : null;
  },
  validate: async (payload) => {
    const parsed = parseInstall(payload);
    if (!parsed.ok) return { ok: false, status: 'invalid', reason: parsed.reason };
    // A key spelled into the repo or path is refused before any card (audit P6-04).
    const secret = screenWebEgress('the model address', `https://huggingface.co/${parsed.value.repo}/${parsed.value.file}`);
    if (!secret.ok) return { ok: false, status: 'denied', reason: secret.reason };
    return { ok: true, value: parsed.value };
  },
  // The card reads the filing as written: normalized here so an inferred folder and the default revision read right.
  summarize: (fields) => {
    const { repo, file, folder, revision } = parseInstall(fields).value ?? fields;
    return `install ${file} from huggingface.co/${repo}${revision && revision !== 'main' ? ` (${revision})` : ''} into the image engine's ${folder} folder, checked against its published SHA-256`;
  },
  // impure — rechecks the switch after any approval wait, then downloads.
  execute: async (want, { connection, signal }) => {
    if (!await webSettings.isEnabled()) return { ok: false, reason: 'web access is off; nothing installed' };
    const { modelsDir } = resolveComfyConfig(process.env);
    const done = await installModel(want, { modelsDir, by: connection?.companion?.neumaId ?? 'unknown', signal });
    if (!done.ok) return { ok: false, reason: done.reason };
    return {
      ok: true,
      detail: done.already
        ? `${want.folder}/${want.name} was already in the engine, the same file (${gb(done.bytes)}, sha256 ${done.sha256}). Nothing downloaded.`
        : `Installed ${want.folder}/${want.name} — ${gb(done.bytes)}, sha256 ${done.sha256}, matching what ${want.repo} published. list_pipelines shows whether a pipeline still waits for anything.`,
    };
  },
});
