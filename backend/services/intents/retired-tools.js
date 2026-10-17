/**
 * Retired tool names → the intent or file surface that replaced them (Stage 3
 * batches 4/5). Mutations → filed intents under intents/. Reads for state →
 * prompt sections (WORKING STATE etc.) + fs primitives. Platform observations →
 * status/*.json files written by the house. The unavailable wall (both seats)
 * returns the hint, never a bare error. Pure data + one lookup.
 */
export const RETIRED_TOOL_HINTS = Object.freeze({
  vault_save: 'vault_save is now an intent — file {"type": "vault/save", "name": "...", "body": "..."} in your intents/ folder',
  vault_rename: 'vault_rename is now an intent — file {"type": "vault/rename", "name": "...", "newName": "..."} in your intents/ folder',
  vault_archive: 'vault_archive is now an intent — file {"type": "vault/archive", "name": "..."} in your intents/ folder',
  vault_restore: 'vault_restore is now an intent — file {"type": "vault/restore", "name": "...", "revision": "..."} in your intents/ folder',
  vault_publish: 'vault_publish is now an intent — file {"type": "vault/publish", "name": "..."} in your intents/ folder (asks your operator)',
  task_add: 'task_add is now an intent — file {"type": "tasks/add", "title": "..."} in your intents/ folder',
  task_update: 'task_update is now an intent — file {"type": "tasks/update", "id": "...", "status": "..."} in your intents/ folder',
  task_focus: 'task_focus is now an intent — file {"type": "tasks/focus", "id": "..."} in your intents/ folder',
  task_take: 'task_take is now an intent — file {"type": "tasks/take", "id": "..."} in your intents/ folder',
  operator_task_add: 'operator_task_add is now an intent — file {"type": "tasks/operator-add", "title": "..."} in your intents/ folder',
  witness_task_add: 'witness_task_add is now an intent — file {"type": "tasks/operator-add", "title": "..."} in your intents/ folder',
  lead_add: 'lead_add is now an intent — file {"type": "leads/add", "name": "...", "contact": "..."} in your intents/ folder',
  lead_touch: 'lead_touch is now an intent — file {"type": "leads/touch", "id": "...", "status": "..."} in your intents/ folder',
  campaign_create: 'campaign_create is now an intent — file {"type": "campaigns/create", "name": "...", "brand": "..."} in your intents/ folder',
  campaign_update: 'campaign_update is now an intent — file {"type": "campaigns/update", "id": "...", ...} in your intents/ folder',
  memory_pin: 'memory_pin is now an intent — file {"type": "memory/pin", "ref": "..."} in your intents/ folder',
  memory_unpin: 'memory_unpin is now an intent — file {"type": "memory/unpin", "ref": "..."} in your intents/ folder',
  memory_supersede: 'memory_supersede is now an intent — file {"type": "memory/supersede", "ref": "...", "content": "..."} in your intents/ folder',
  memory_retract: 'memory_retract is now an intent — file {"type": "memory/retract", "ref": "..."} in your intents/ folder',
  memory_merge: 'memory_merge is now an intent — file {"type": "memory/merge", "refs": ["..."], "content": "..."} in your intents/ folder',
  memory_archive: 'memory_archive is now an intent — file {"type": "memory/archive", "ref": "..."} in your intents/ folder',

  // Read surfaces retired in favor of prompt-injected state + fs primitives.
  //
  // THIS LIST MEANS "GONE", NOT "PLANNED TO GO" (2026-08-23 audit). It had
  // grown to name nine reads that are still advertised and still dispatched,
  // because S3b4's policy rows landed but its catalog cut did not (#414). A
  // name listed here is served the migration hint at the unavailable wall and
  // is reported by mapview as dead surface — so listing a LIVE tool told both
  // the being and the instrument something false. Each of the nine had a
  // concrete reason it could not go, and they were removed from this list:
  //
  //   vault_list/read/search/history — the vault is DEK-encrypted at rest, so
  //     the fs primitives this pointed at return CIPHERTEXT. vault-acts.js
  //     says it plainly: the reads stay tools, the platform decrypts.
  //   task_list — WORKING STATE carries LIVE tasks only; this is the sole path
  //     to settled history and to work held in another chat.
  //   lead_list / campaign_list — the prompt replacement is the CMO briefing,
  //     which renders for the CMO office alone. Every other being had nothing.
  //   wallet_view / substrate_facts — pointed at status/*.json files written
  //     by the S3b5 writer, which was PARKED and never built. Nothing writes
  //     them; nothing can read them.
  //   skies_read — still advertised, and policy-allowed.
  //
  // Add a name here when its replacement is LIVE, not when it is intended.
});

/**
 * The migration pointer for a retired state-tool name, or null. Pure.
 * Accepts the bare name or a server-prefixed one (`vault/vault_save`).
 * @param {string} name
 * @returns {string|null}
 */
export const retiredToolHint = (name) => {
  const bare = String(name || '').replace(/^[^/]+\//, '');
  if (RETIRED_TOOL_HINTS[bare]) return RETIRED_TOOL_HINTS[bare];
  // The Stage 2 cut removed the channel-parameterized families
  // (tool-surface-primitives.md: post_to_*/queue_post_to_*) — exact keys cannot
  // name every channel, so the family prefix points at its intent.
  if (/^queue_post_to_/.test(bare)) {
    return `${bare} is now an intent — file {"type": "social/queue", "channel": "<channel>", "text": "...", "scheduledFor": "..."} in your intents/ folder`;
  }
  if (/^post_to_/.test(bare)) {
    return `${bare} is now an intent — file {"type": "social/post", "channel": "<channel>", "text": "..."} in your intents/ folder (asks your operator)`;
  }
  return null;
};
