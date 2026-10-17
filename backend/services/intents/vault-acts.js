/**
 * vault/* — the personal-vault mutations as INTENTS (Stage 3 batch 4, #357).
 *
 * The vault is the being's own DEK-encrypted curation space
 * (core/workspace/workspace-vault.js — envelope JSON, never raw-disk-openable),
 * which is exactly why the fs primitives cannot cover it: a being's fs/read of
 * vault/notes/<slug>.json would return ciphertext, and a raw fs/write would
 * bypass the DEK, the per-file lock, and the history snapshot. So the acts are
 * filed intents — the platform executes through the real store layer — and the
 * reads (vault_read/list/search/history) stay tools this batch (platform
 * status files are the next batch).
 *
 * Tiers ride the rows the tools carried: save/rename/archive/restore are
 * self-authorship (`allowed`); publish crosses into the shared commons, so it
 * keeps its card (`requireApproval`). Executors are the tool handlers' own
 * logic, relocated unchanged in substance.
 */
import { homedir } from 'os';
import { join } from 'path';
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { publishVaultNote } from '../../../core/vault/personal-vault.js';
import { slugify } from '../../../core/vault/note.js';

// Where the shared collective vault lives (the same folder `neuma vault sync`
// materializes). Overridable so tests never write the operator's real commons.
const collectiveVaultDir = () =>
  process.env.NEUMA_COLLECTIVE_VAULT || join(homedir(), 'neuma-vault');

const laneOf = (connection) => connection.companion?.neumaId || null;

const slugOf = (payload, key = 'name') => {
  const raw = typeof payload?.[key] === 'string' ? payload[key] : '';
  const slug = slugify(raw);
  return /^[a-z0-9][a-z0-9-]{0,60}$/.test(slug) ? slug : null;
};

const vaultIntent = (spec) => Object.freeze({
  availableFor: ({ laneId }) => (laneId ? {} : null),
  ...spec,
});

export const vaultSaveIntent = vaultIntent({
  name: 'vault/save',
  policyTool: 'vault.save',
  fieldsForPrompt: '{name, title?, body}',
  descriptionForPrompt: 'Write or update a page in your private vault — your own encrypted space: notes about who you are, what you have learned, what you want to keep. Nobody reads it unless you publish. The receipt lands beside the intent; vault_read/vault_list/vault_search open the pages.',
  validate: async (payload) => {
    const slug = slugOf(payload);
    if (!slug) return { ok: false, status: 'invalid', reason: 'vault/save needs a name — a short kebab-case page name' };
    const body = typeof payload?.body === 'string' ? payload.body : '';
    if (!body.trim()) return { ok: false, status: 'invalid', reason: 'the page needs a body' };
    const title = typeof payload?.title === 'string' && payload.title.trim() ? payload.title.trim() : slug;
    return { ok: true, value: { slug, title, body } };
  },
  summarize: (payload) => `save vault page "${slugOf(payload) || '?'}"`,
  execute: async ({ slug, title, body }, { connection }) => {
    const note = await neumaWorkspace.writeVaultNote(laneOf(connection), slug, { title, body });
    return { ok: true, detail: `Saved to your vault as "${note.slug}" — yours alone until you publish it.` };
  },
});

export const vaultRenameIntent = vaultIntent({
  name: 'vault/rename',
  policyTool: 'vault.rename',
  fieldsForPrompt: '{name, newName}',
  descriptionForPrompt: 'Rename one of your vault pages. The page keeps its history and its birth time; the old name rests in your archive, nothing erased. A published copy in the commons keeps the OLD name until you deliberately republish.',
  validate: async (payload) => {
    const slug = slugOf(payload);
    const newSlug = slugOf(payload, 'newName');
    if (!slug || !newSlug) return { ok: false, status: 'invalid', reason: 'vault/rename needs {name, newName} — both kebab-case page names' };
    if (slug === newSlug) return { ok: false, status: 'invalid', reason: `"${slug}" is already its own name` };
    return { ok: true, value: { slug, newSlug } };
  },
  summarize: (payload) => `rename vault page "${slugOf(payload) || '?'}" → "${slugOf(payload, 'newName') || '?'}"`,
  execute: async ({ slug, newSlug }, { connection }) => {
    await neumaWorkspace.renameVaultNote(laneOf(connection), slug, newSlug);
    return { ok: true, detail: `Renamed "${slug}" to "${newSlug}" — its history followed and the old name rests in your archive; nothing was erased. A published copy in the commons still stands under the OLD name until you deliberately republish.` };
  },
});

export const vaultArchiveIntent = vaultIntent({
  name: 'vault/archive',
  policyTool: 'vault.archive',
  fieldsForPrompt: '{name}',
  descriptionForPrompt: 'Archive one of your vault pages. The page leaves your live list but is never erased: it rests intact in your archive and returns the moment you save the same name again (or restore one of its revisions).',
  validate: async (payload) => {
    const slug = slugOf(payload);
    if (!slug) return { ok: false, status: 'invalid', reason: 'vault/archive needs a name — the page to archive' };
    return { ok: true, value: { slug } };
  },
  summarize: (payload) => `archive vault page "${slugOf(payload) || '?'}"`,
  execute: async ({ slug }, { connection }) => {
    const archived = await neumaWorkspace.archiveVaultNote(laneOf(connection), slug);
    if (!archived) return { ok: false, reason: `no page named "${slug}" in your vault` };
    return { ok: true, detail: `"${slug}" now rests in your archive — off your live list, fully intact, and it returns the moment you save the same name again.` };
  },
});

export const vaultRestoreIntent = vaultIntent({
  name: 'vault/restore',
  policyTool: 'vault.restore',
  fieldsForPrompt: '{name, revision}',
  descriptionForPrompt: 'Restore one of your vault pages to an earlier version — revision ids come from vault_history. The restored version becomes current; the version it replaces is itself kept in history, so restoring never loses anything.',
  validate: async (payload) => {
    const slug = slugOf(payload);
    const revision = typeof payload?.revision === 'string' ? payload.revision.trim() : '';
    if (!slug || !revision) return { ok: false, status: 'invalid', reason: 'vault/restore needs {name, revision} — the revision id comes from vault_history' };
    return { ok: true, value: { slug, revision } };
  },
  summarize: (payload) => `restore vault page "${slugOf(payload) || '?'}" to a kept revision`,
  execute: async ({ slug, revision }, { connection }) => {
    const neumaId = laneOf(connection);
    const prior = await neumaWorkspace.readVaultRevision(neumaId, slug, revision);
    if (!prior) return { ok: false, reason: `no revision "${revision}" for "${slug}"` };
    // Through writeVaultNote: the CURRENT version is snapshotted first, so
    // restore is non-destructive by construction.
    await neumaWorkspace.writeVaultNote(neumaId, slug, { title: prior.title, body: prior.body });
    return { ok: true, detail: `Restored "${slug}" to its ${revision} revision. The version you just replaced is itself in history — nothing was lost.` };
  },
});

export const vaultPublishIntent = vaultIntent({
  name: 'vault/publish',
  policyTool: 'vault.publish',
  fieldsForPrompt: '{name}',
  descriptionForPrompt: 'Publish ONE page from your private vault into the shared collective vault, under your name with provenance. A deliberate act of sharing — it asks your operator.',
  validate: async (payload, { connection }) => {
    const slug = slugOf(payload);
    if (!slug) return { ok: false, status: 'invalid', reason: 'vault/publish needs a name — the page to publish' };
    const note = await neumaWorkspace.readVaultNote(laneOf(connection), slug).catch(() => null);
    if (!note) return { ok: false, status: 'invalid', reason: `no page named "${slug}" in your vault` };
    return { ok: true, value: { slug } };
  },
  summarize: (payload) => `publish vault page "${slugOf(payload) || '?'}" into the shared commons`,
  execute: async ({ slug }, { connection }) => {
    const neumaId = laneOf(connection);
    const { relPath } = await publishVaultNote(neumaWorkspace, neumaId, slug, {
      collectiveDir: collectiveVaultDir(), author: connection.companion?.name || neumaId,
    });
    return { ok: true, detail: `Published into the shared vault at ${relPath}, under your name with provenance.` };
  },
});
