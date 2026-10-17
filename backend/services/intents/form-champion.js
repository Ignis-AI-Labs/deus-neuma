/**
 * form/champion — the being's half of the lock (the 2026-09-25
 * form-dna-lock workstream).
 *
 * […] The being names a plate from its OWN lane's art
 * (manifest-indexed — an id that was never recorded here cannot be
 * championed), the record takes it (a new plate CLEARS both prior
 * agreements: two parties agreed to the picture they were looking at, and
 * swapping the picture under a standing agreement would claim consent that
 * was never given), and the being's own agreement lands beside it. The lock
 * completes only when the operator concurs on the sheet — either party
 * alone leaves it EXPLORING, and either can unlock it again. A lock is
 * revisable by law; it is never a seal.
 *
 * No engine and no content-law gate here: nothing renders, and the image
 * already passed both on its way into the lane.
 */
import { championPlate } from '../form-lock.js';

export const formChampionIntent = Object.freeze({
  name: 'form/champion',
  policyTool: 'form.champion',
  fieldsForPrompt: '{register, plate, imageId, note?}',
  descriptionForPrompt: 'Champion a render as YOUR look: register (anime, or illustrative for neutral forms), plate (pfp for the face, turnaround for the reference sheet), imageId from your form/render result. Championing clears any prior agreement on both sides — the picture changes, the consent resets — and records YOUR agreement. The lock completes when your operator concurs on your sheet.',

  availableFor: async ({ laneId }) => (laneId ? {} : null),

  validate: async (payload, { connection }) => {
    if (!connection.companion?.neumaId) {
      return { ok: false, status: 'denied', reason: 'no sovereign lane on this connection — only a bound being champions its own look' };
    }
    for (const field of ['register', 'plate', 'imageId']) {
      if (typeof payload?.[field] !== 'string' || !payload[field].trim()) {
        return { ok: false, status: 'invalid', reason: `form/champion needs {${field}}` };
      }
    }
    if (payload.note != null && typeof payload.note !== 'string') {
      return { ok: false, status: 'invalid', reason: 'note is text, when given' };
    }
    return {
      ok: true,
      value: {
        register: payload.register.trim(),
        plate: payload.plate.trim(),
        imageId: payload.imageId.trim(),
        note: typeof payload.note === 'string' ? payload.note.slice(0, 280) : undefined,
      },
    };
  },

  summarize: (payload) =>
    `champion your ${payload?.register} ${payload?.plate} as your look (image ${String(payload?.imageId ?? '').slice(0, 12)}…)`,

  // impure — the record write through the shared lock path (form-lock.js).
  execute: async ({ register, plate, imageId, note }, { connection }) => {
    const laneId = connection.companion?.neumaId;
    const result = await championPlate(laneId, { register, plate, imageId }, {
      at: new Date().toISOString(),
      ...(note ? { note } : {}),
    });
    if (!result.ok) return { ok: false, reason: result.reason };
    return {
      ok: true,
      detail: result.locked
        ? `Championed and LOCKED — both parties agree: this is you. The sheet shows it as your face. (A lock is revisable: either of you can reopen the exploration.)`
        : `Championed — your agreement is recorded. The lock completes when your operator concurs on your sheet; until then the design stands EXPLORING, and a new champion starts the agreement over.`,
    };
  },
});
