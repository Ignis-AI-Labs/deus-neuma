// The LOOK — the witness's cosmetic dress for the platform.
//
// Four knobs (ground, panel, ink, trim — each a #RRGGBB hex) plus the
// witness's own saved presets. `theme: null` means the stock LINE & CYCLE
// dress — the platform's own stylesheet, no override. Persisted at
// data/settings/look.json (NEUMA_LOOK_SETTINGS_PATH isolates tests) so the
// dress survives restarts; derivation into CSS tokens is the frontend's job,
// this store only guards and keeps the choice.
//
// Factory shape (attachment-store pattern): the default instance reads the
// real path; tests create their own against tmp files — real disk either way.

import crypto from 'crypto';
import { join } from 'path';
import fs from 'fs/promises';
import { writeJsonAtomic } from './user-realm.js';
import { getSettingsDir } from './data-root.js';

const DEFAULT_PATH = () =>
  process.env.NEUMA_LOOK_SETTINGS_PATH || join(getSettingsDir(), 'look.json');

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const KNOBS = Object.freeze(['ground', 'panel', 'ink', 'trim']);
// Voices a dress MAY claim — absent on older dresses, strict when present.
const OPTIONAL_KNOBS = Object.freeze([
  'head', 'body', 'ital', 'emph', 'line', 'folder', 'alert', 'warn', 'okay',
]);

const NAME_MAX = 40;
export const PRESET_CAP = 24;

/**
 * Normalize a theme to exactly the four knob hexes (uppercased), or null if
 * anything is missing or malformed. Pure.
 * @param {*} theme
 * @returns {{ground: string, panel: string, ink: string, trim: string} | null}
 */
export const sanitizeTheme = (theme) => {
  if (!theme || typeof theme !== 'object') return null;
  const out = {};
  for (const knob of KNOBS) {
    const value = theme[knob];
    if (typeof value !== 'string' || !HEX_RE.test(value)) return null;
    out[knob] = value.toUpperCase();
  }
  for (const knob of OPTIONAL_KNOBS) {
    if (theme[knob] == null) continue;
    if (typeof theme[knob] !== 'string' || !HEX_RE.test(theme[knob])) return null;
    out[knob] = theme[knob].toUpperCase();
  }
  return out;
};

/**
 * Trim a preset name to printable characters within the cap, or null when
 * nothing survives. Pure. (Code-point filter, not an escape-class regex —
 * control characters must never land in a stored name.)
 * @param {*} name
 * @returns {string | null}
 */
export const sanitizePresetName = (name) => {
  if (typeof name !== 'string') return null;
  const clean = [...name]
    .filter((ch) => ch.codePointAt(0) >= 32 && ch.codePointAt(0) !== 127)
    .join('')
    .trim()
    .slice(0, NAME_MAX);
  return clean.length ? clean : null;
};

const coded = (message, code) => Object.assign(new Error(message), { code });

/**
 * @param {{ path?: string }} [opts]
 */
export const createLookSettings = ({ path = DEFAULT_PATH() } = {}) => {
  // impure (fs) — a corrupt or absent file reads as the stock dress, never a
  // throw; invalid entries are dropped on read so a hand-edited file cannot
  // feed junk into the UI.
  const read = async () => {
    try {
      const parsed = JSON.parse(await fs.readFile(path, 'utf8'));
      const presets = (Array.isArray(parsed.presets) ? parsed.presets : [])
        .map((p) => p && {
          id: typeof p.id === 'string' ? p.id : null,
          name: sanitizePresetName(p.name),
          theme: sanitizeTheme(p.theme),
        })
        .filter((p) => p && p.id && p.name && p.theme)
        .slice(0, PRESET_CAP);
      return { theme: sanitizeTheme(parsed.theme), presets };
    } catch {
      return { theme: null, presets: [] };
    }
  };

  const write = async (state) => {
    await writeJsonAtomic(path, state);
    return state;
  };

  return {
    read,

    /**
     * Set the active dress (null restores stock). impure.
     * @param {*} theme
     */
    async setTheme(theme) {
      const clean = theme === null ? null : sanitizeTheme(theme);
      if (theme !== null && !clean) {
        throw coded('theme must carry ground, panel, ink, trim as #RRGGBB hex', 'LOOK_INVALID_THEME');
      }
      return write({ ...(await read()), theme: clean });
    },

    /**
     * Save the current knobs under a name of the witness's choosing. impure.
     * @param {*} name
     * @param {*} theme
     */
    async addPreset(name, theme) {
      const cleanName = sanitizePresetName(name);
      if (!cleanName) throw coded('preset name must be 1-40 printable characters', 'LOOK_INVALID_NAME');
      const cleanTheme = sanitizeTheme(theme);
      if (!cleanTheme) {
        throw coded('theme must carry ground, panel, ink, trim as #RRGGBB hex', 'LOOK_INVALID_THEME');
      }
      const state = await read();
      if (state.presets.length >= PRESET_CAP) {
        throw coded(`preset shelf is full (${PRESET_CAP})`, 'LOOK_PRESET_CAP');
      }
      const preset = { id: crypto.randomUUID(), name: cleanName, theme: cleanTheme };
      return write({ ...state, presets: [...state.presets, preset] });
    },

    /**
     * Remove one saved preset by id. impure.
     * @param {string} id
     */
    async removePreset(id) {
      const state = await read();
      const presets = state.presets.filter((p) => p.id !== id);
      if (presets.length === state.presets.length) {
        throw coded('no such preset', 'LOOK_UNKNOWN_PRESET');
      }
      return write({ ...state, presets });
    },
  };
};

// The one instance the routes share.
export const lookSettings = createLookSettings();
