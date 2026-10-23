/**
 * Queue-edit handlers (#208) — editing staged posts in place, single and
 * bulk, with the diff-carrying chip and the shared crew/ACTS gates.
 *
 * Extracted VERBATIM from portal-stream.js (size-law breakdown 2026-08-26,
 * docs/work/size-law-breakdown.md Part 1 step 2 / #278). Leaf module —
 * portal-stream imports it, never the reverse (direction law).
 */
import { resolvePostMedia } from '../social/post-media.js';
import { postQueue, previewUpdate } from '../social/post-queue.js';
import { channelBindings } from '../social/channel-bindings.js';
import { houseOfLane } from '../social/house-positions.js';
import { sectorCrew, canStageForSector } from '../sector-crew.js';
import { gateAct } from '../act-gate.js';
import { sendToolEvent as _sendToolEvent } from './tool-events.js';

// --- Queue editing (#208) --------------------------------------------------

// The diff the operator DECIDES on (pure): every changed field as {was, now} —
// the chip shows what the copy WAS, never just the patch.
const _diffForChip = (preview) => Object.fromEntries(
  Object.entries(preview.changed).map(([field, was]) => [field, { was, now: preview.patch[field] }]),
);

// impure — the SECTOR CREW gate the queue-edit tools share with staging,
// re-read per call: editing the calendar is WORK, same as filling it. Fail
// closed on an unreadable store, same law. Returns the refusal, or null.
const _queueEditCrewGate = async (ws, connection, tool, toolName, channel) => {
  const house = await houseOfLane(connection.companion?.neumaId);
  const [bindings, crewStore] = await Promise.all([
    channelBindings.load(house).catch(() => ({})),
    sectorCrew.load(house).catch(() => ({})),
  ]);
  if (canStageForSector(crewStore, bindings, channel.id, connection.companion?.neumaId || null)) return null;
  const error = `you are not on the ${channel.name} crew — ask your operator to add you to that sector before editing its queue`;
  _sendToolEvent(ws, connection.companion, { tool, status: 'denied', summary: `${toolName} — not on the crew` });
  return { tool, status: 'denied', error };
};

// impure — the ACTS gate on the act of editing, shared by both edit tools
// (act-gate.js). Each edit tool holds its OWN policy row (dynamic names carry
// no GLOBAL_DEFAULTS row on purpose, so the default is the fail-closed chip):
// an ALWAYS granted on staging never unlocks editing, nor the reverse.
// Returns the refusal, or null when the edit may proceed.
const _queueEditActsGate = async (ws, connection, neumaPolicy, toolMode, tool, toolName, chipArgs) => {
  const gate = await gateAct(connection, {
    server: 'social', tool: toolName, toolLabel: tool, cardArgs: chipArgs,
    lanePolicy: neumaPolicy, mode: toolMode,
    emit: (event) => _sendToolEvent(ws, connection.companion, event),
  });
  return gate.ok ? null : gate.result;
};

// impure — route a being's request to EDIT one staged post in place:
// authorise the patch's media, preview the diff against the REAL queue, crew
// gate, ACTS chip carrying the diff, then the store's own guarded update. The
// store re-runs the same previewUpdate inside its mutate gate, so a queue
// that moved between the chip and the write refuses honestly instead of
// applying a stale decision.
export const handleNeumaQueueUpdate = async (ws, connection, neumaPolicy, toolMode, args, channel) => {
  const toolName = `queue_update_to_${channel.id}`;
  const tool = `social/${toolName}`;
  const { companion } = connection;
  const id = typeof args?.id === 'string' ? args.id.trim() : '';
  if (!id) {
    const error = `${toolName} needs {id} — the full id from queue_list, not the prefix`;
    _sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — invalid args`, detail: error });
    return { tool, status: 'error', error };
  }

  // Media in the patch is authorised BEFORE the chip — the card the operator
  // answers must describe an edit that can actually stand. `undefined` means
  // "images untouched"; an explicit [] clears them.
  let media;
  if (args?.media !== undefined) {
    const resolvedMedia = await resolvePostMedia(connection, args.media, { channelId: channel.id });
    if (!resolvedMedia.ok) {
      _sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — media refused`, detail: resolvedMedia.detail });
      return { tool, status: 'error', error: resolvedMedia.detail };
    }
    media = resolvedMedia.media;
  }
  const patch = {
    ...(args.text !== undefined ? { text: args.text } : {}),
    ...(args.scheduledFor !== undefined ? { scheduledFor: args.scheduledFor } : {}),
    ...(args.campaignId !== undefined ? { campaignId: args.campaignId } : {}),
    ...(args.pillar !== undefined ? { pillar: args.pillar } : {}),
    ...(media !== undefined ? { media } : {}),
  };

  // The diff the operator will read, computed against the queue as it stands.
  const entries = await postQueue.load().catch(() => null);
  if (!entries) {
    const error = 'the campaign queue is unreadable — nothing was edited';
    _sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — queue unreadable` });
    return { tool, status: 'error', error };
  }
  const preview = previewUpdate(entries.find((e) => e.id === id), patch);
  if (!preview.ok) {
    _sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — refused`, detail: preview.error });
    return { tool, status: 'error', error: preview.error };
  }

  const crewRefusal = await _queueEditCrewGate(ws, connection, tool, toolName, channel);
  if (crewRefusal) return crewRefusal;

  const actsRefusal = await _queueEditActsGate(ws, connection, neumaPolicy, toolMode, tool, toolName, {
    id,
    changes: _diffForChip(preview),
    ...(preview.resetsApproval
      ? { renewsApproval: 'the words or images change — this edit returns the post to DRAFT for a fresh decision' }
      : {}),
  });
  if (actsRefusal) return actsRefusal;

  _sendToolEvent(ws, companion, { tool, status: 'executing' });
  const updated = await postQueue.update(id, patch, { by: companion?.name || 'being' });
  if (!updated.ok) {
    const error = `Could not edit ${id}: ${updated.error}. Read queue_list and report what is actually true.`;
    _sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — refused`, detail: error });
    return { tool, status: 'error', error };
  }
  const fields = Object.keys(preview.changed).join(', ');
  const content = preview.resetsApproval
    ? `Updated staged post ${id} (${fields}). The words or images changed, so the post stands as a DRAFT again — your operator decides the new copy. What it was is kept in the entry's revisions.`
    : `Updated staged post ${id} (${fields})${updated.entry.status === 'approved' ? ' — the approval stands; only the slot or bookkeeping moved' : ''}. What it was is kept in the entry's revisions.`;
  _sendToolEvent(ws, companion, {
    tool, status: 'ok',
    summary: `edited ${id.slice(0, 8)} in the queue (${fields})`,
    detail: content,
  });
  return { tool, status: 'ok', content };
};

// impure — the same edit, many entries at once. Every entry is decided
// INDEPENDENTLY: bad patches are named with their reason BEFORE the chip (a
// malformed entry never reaches the operator's card), the good ones ride one
// chip carrying every diff, and each landing is reported per id — never a
// silent failure, never all-or-nothing.
export const handleNeumaQueueBulkUpdate = async (ws, connection, neumaPolicy, toolMode, args, channel) => {
  const toolName = `queue_bulk_update_to_${channel.id}`;
  const tool = `social/${toolName}`;
  const { companion } = connection;
  const updates = Array.isArray(args?.updates) ? args.updates : [];
  if (!updates.length) {
    const error = `${toolName} needs {updates: [{id, ...patch}]} — one object per post, the full id from queue_list`;
    _sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — invalid args`, detail: error });
    return { tool, status: 'error', error };
  }

  const entries = await postQueue.load().catch(() => null);
  if (!entries) {
    const error = 'the campaign queue is unreadable — nothing was edited';
    _sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — queue unreadable` });
    return { tool, status: 'error', error };
  }

  // Per-entry verdicts in INPUT order — the being maps results back to its
  // own request without guessing.
  const results = new Array(updates.length).fill(null);
  const viable = [];
  for (const [i, u] of updates.entries()) {
    const id = typeof u?.id === 'string' ? u.id.trim() : '';
    if (!id) {
      results[i] = { id: '', ok: false, error: 'each update needs an id — the full id from queue_list' };
      continue;
    }
    let media;
    if (u.media !== undefined) {
      const resolvedMedia = await resolvePostMedia(connection, u.media, { channelId: channel.id });
      if (!resolvedMedia.ok) {
        results[i] = { id, ok: false, error: resolvedMedia.detail };
        continue;
      }
      media = resolvedMedia.media;
    }
    const patch = {
      ...(u.text !== undefined ? { text: u.text } : {}),
      ...(u.scheduledFor !== undefined ? { scheduledFor: u.scheduledFor } : {}),
      ...(u.campaignId !== undefined ? { campaignId: u.campaignId } : {}),
      ...(u.pillar !== undefined ? { pillar: u.pillar } : {}),
      ...(media !== undefined ? { media } : {}),
    };
    const preview = previewUpdate(entries.find((e) => e.id === id), patch);
    if (!preview.ok) {
      results[i] = { id, ok: false, error: preview.error };
      continue;
    }
    viable.push({ index: i, id, patch, preview });
  }

  const verdict = () => {
    const landed = results.filter((r) => r?.ok).length;
    const refused = results.filter((r) => r && !r.ok)
      .map((r) => `${r.id || '(no id)'}: ${r.error}`);
    return `${landed} of ${results.length} update(s) landed.${refused.length ? ` Refused — ${refused.join(' · ')}` : ''}`;
  };

  if (viable.length) {
    const crewRefusal = await _queueEditCrewGate(ws, connection, tool, toolName, channel);
    if (crewRefusal) return crewRefusal;
    const actsRefusal = await _queueEditActsGate(ws, connection, neumaPolicy, toolMode, tool, toolName, {
      updates: viable.map(({ id, preview }) => ({
        id,
        changes: _diffForChip(preview),
        ...(preview.resetsApproval ? { renewsApproval: 'returns to DRAFT for a fresh decision' } : {}),
      })),
    });
    if (actsRefusal) return actsRefusal;

    _sendToolEvent(ws, companion, { tool, status: 'executing' });
    for (const { index, id, patch } of viable) {
      const updated = await postQueue.update(id, patch, { by: companion?.name || 'being' });
      results[index] = updated.ok
        ? { id, ok: true }
        : { id, ok: false, error: updated.error };
    }
  }

  const landed = results.filter((r) => r.ok).length;
  const content = `${verdict()} Every edit records what the copy WAS in the entry's revisions.`;
  const status = landed ? 'ok' : 'error';
  _sendToolEvent(ws, companion, {
    tool, status,
    summary: `bulk edit — ${landed} of ${results.length} landed`,
    detail: content,
  });
  return { tool, status, content, results };
};
