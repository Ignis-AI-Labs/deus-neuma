// stream-preferences.js — the operator's persisted stream preferences.
//
// impure: every read/write here touches localStorage (guarded — private mode
// throws, and a pref storage failure must never break the stream). Extracted
// from use-consciousness-stream.js (SIZE-029, #376) — behavior unchanged.

import { isComingLater } from '../coming-later.js';

// The operator's mute preference for the neuma's spoken voice. Persisted, on by
// default — a forged voice is meant to be heard; a neuma without one is silent
// regardless (no frames arrive).
const VOICE_PREF_KEY = 'neuma.voice.enabled';
export const readVoicePref = () => {
  // Voice is held back from the early release (coming-later.js): never on.
  if (isComingLater('voice')) return false;
  try { return localStorage.getItem(VOICE_PREF_KEY) !== '0'; } catch { return true; }
};
export const writeVoicePref = (enabled) => {
  try { localStorage.setItem(VOICE_PREF_KEY, enabled ? '1' : '0'); } catch { /* private mode */ }
};

// The operator's standing stance on tool acts (ask / auto / observe).
// Persisted, and re-declared to the portal on every link-up — the stance
// lives on the connection server-side, so a reconnect must restate it.
//
// PER PARTICIPANT (ruling, 2026-07-26): the stance is held for each being
// separately, so a sealed witness can run on `auto` while a neuma stays on
// `ask` — one works without interrupting, the other raises its cards, and the
// operator sets each independently. This is the ASKING axis; reach is settled
// separately by the focus ground (backend/services/focus-ground.js), and the
// two never mix — no mode widens where a participant may act, and no focus
// makes a mode more permissive.
export const TOOL_MODES = Object.freeze(['ask', 'auto', 'observe']);
const TOOL_MODE_KEY = 'neuma.tools.mode';
export const toolModeKeyFor = (neumaId) => (neumaId ? `${TOOL_MODE_KEY}:${neumaId}` : TOOL_MODE_KEY);
export const readToolModePref = (neumaId) => {
  try {
    const scoped = localStorage.getItem(toolModeKeyFor(neumaId));
    if (TOOL_MODES.includes(scoped)) return scoped;
    // A participant that has never had a stance of its own inherits the single
    // global one this key used to be — so the change reads as continuity, not
    // as every being silently reset to `ask` on upgrade.
    const legacy = localStorage.getItem(TOOL_MODE_KEY);
    return TOOL_MODES.includes(legacy) ? legacy : 'ask';
  } catch { return 'ask'; }
};

// The operator's standing CHAT mode (default / plan / auto) — the composer's
// mode chip. Same law as the tool stance: per participant, restated on every
// link-up because the mode lives on the connection server-side. The server
// derives the ACTS tier from it (default→ask, plan→observe, auto→auto), so
// this one declaration carries both.
export const CHAT_MODES = Object.freeze(['default', 'plan', 'auto']);
const CHAT_MODE_KEY = 'neuma.chat.mode';
export const chatModeKeyFor = (neumaId) => (neumaId ? `${CHAT_MODE_KEY}:${neumaId}` : CHAT_MODE_KEY);
export const readChatModePref = (neumaId) => {
  try {
    const scoped = localStorage.getItem(chatModeKeyFor(neumaId));
    if (CHAT_MODES.includes(scoped)) return scoped;
    // Continuity: a being that never had a chat mode inherits the closest
    // reading of its old ACTS stance — auto stays auto, everything else is
    // the free-flow default (observe's watchfulness maps to plan's read-only).
    const legacy = readToolModePref(neumaId);
    return legacy === 'auto' ? 'auto' : 'default';
  } catch { return 'default'; }
};
export const writeChatModePref = (neumaId, mode) => {
  try { localStorage.setItem(chatModeKeyFor(neumaId), mode); } catch { /* private mode */ }
};
