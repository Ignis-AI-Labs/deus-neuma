/**
 * Brand kits — the livery a company or house presses onto its documents. // impure (fs)
 *
 * A kit lives at <kitsDir>/<kit-id>/kit.json beside its logo assets:
 *   {
 *     "name": "Ignis AI Labs",
 *     "companyName": "Ignis AI Labs",
 *     "documentFooter": "Confidential and Proprietary",
 *     "colors": { "accent": "#0366d6", ... },          // optional overrides
 *     "fonts": { "body": "...", "mono": "..." },       // optional overrides
 *     "logos": { "primary": "logo.svg", "badge": "badge.svg", ... },
 *     "pdf": { "format": "Letter", "marginCm": 1.5 },
 *     "charts": { "palette": ["#...", ...] }
 *   }
 *
 * Kit root resolution: explicit kitsDir param → NEUMA_BRAND_KITS_DIR env →
 * brand-kits under the shared writable data root.
 */

import { getDataRoot } from '../data-root.js';
import fs from 'fs/promises';
import path from 'path';
import { createLogger } from './../logger.js';

const log = createLogger('DocPress.BrandKit');

const KIT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

const MIME_BY_EXT = Object.freeze({
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg'
});

const DEFAULT_COLORS = Object.freeze({
  ink: '#333333',
  paper: '#ffffff',
  heading: '#000000',
  accent: '#0366d6',
  accentWash: '#f1f8ff',
  muted: '#6a737d',
  rule: '#dfe2e5',
  ruleSoft: '#eeeeee',
  wash: '#f6f8fa',
  washSoft: '#f8f9fa'
});

const DEFAULT_FONTS = Object.freeze({
  body: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  mono: "Consolas, Monaco, 'Andale Mono', monospace"
});

const DEFAULT_PDF = Object.freeze({ format: 'Letter', marginCm: 1.5 });

/**
 * The built-in neutral kit — pressing works out of the box with no
 * branding configured at all.
 */
export const DEFAULT_KIT = Object.freeze({
  id: 'default',
  name: 'Neutral',
  companyName: '',
  documentFooter: '',
  colors: DEFAULT_COLORS,
  fonts: DEFAULT_FONTS,
  logos: Object.freeze({}),
  logoData: Object.freeze({}),
  pdf: DEFAULT_PDF,
  charts: Object.freeze({ palette: null })
});

/**
 * Resolves the kits root directory. Impure: reads runtime environment.
 * @param {string} [kitsDir]
 * @returns {string}
 */
function resolveKitsDir(kitsDir) {
  return path.resolve(
    kitsDir || process.env.NEUMA_BRAND_KITS_DIR || path.join(getDataRoot(), 'brand-kits')
  );
}

function requireString(raw, field, fallback) {
  const value = raw[field];
  if (value === undefined) return fallback;
  if (typeof value !== 'string') throw new Error(`brand kit field "${field}" must be a string`);
  return value;
}

function mergeSection(defaults, overrides, kitId, section) {
  if (overrides === undefined) return defaults;
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new Error(`brand kit "${kitId}" field "${section}" must be an object`);
  }
  const merged = { ...defaults };
  for (const [key, value] of Object.entries(overrides)) {
    if (!(key in defaults)) continue;
    if (typeof value !== typeof defaults[key] && defaults[key] !== null) {
      throw new Error(`brand kit "${kitId}" field "${section}.${key}" has the wrong type`);
    }
    merged[key] = value;
  }
  return merged;
}

/**
 * Validates and normalizes a raw kit.json object against defaults. Pure.
 * @param {object} raw - Parsed kit.json
 * @param {string} kitId
 * @returns {object} - Normalized kit (without logoData)
 */
export function validateKit(raw, kitId) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`brand kit "${kitId}" must be a JSON object`);
  }
  const logos = raw.logos ?? {};
  if (typeof logos !== 'object' || Array.isArray(logos)) {
    throw new Error(`brand kit "${kitId}" field "logos" must be an object`);
  }
  for (const [key, filename] of Object.entries(logos)) {
    if (!KIT_ID_PATTERN.test(key)) {
      throw new Error(`brand kit "${kitId}" logo key "${key}" must be alphanumeric`);
    }
    if (typeof filename !== 'string' || path.basename(filename) !== filename) {
      throw new Error(`brand kit "${kitId}" logo "${key}" must be a bare filename inside the kit directory`);
    }
  }
  const palette = raw.charts?.palette;
  if (palette !== undefined && (!Array.isArray(palette) || palette.some((c) => typeof c !== 'string'))) {
    throw new Error(`brand kit "${kitId}" field "charts.palette" must be an array of color strings`);
  }
  return {
    id: kitId,
    name: requireString(raw, 'name', kitId),
    companyName: requireString(raw, 'companyName', ''),
    documentFooter: requireString(raw, 'documentFooter', ''),
    colors: mergeSection(DEFAULT_COLORS, raw.colors, kitId, 'colors'),
    fonts: mergeSection(DEFAULT_FONTS, raw.fonts, kitId, 'fonts'),
    logos: { ...logos },
    pdf: mergeSection(DEFAULT_PDF, raw.pdf, kitId, 'pdf'),
    charts: { palette: palette ?? null }
  };
}

async function loadLogoData(kitDir, logos, kitId) {
  const logoData = {};
  for (const [key, filename] of Object.entries(logos)) {
    const ext = path.extname(filename).toLowerCase();
    const mime = MIME_BY_EXT[ext];
    if (!mime) {
      log.warn('Unsupported logo format skipped', { kit: kitId, logo: key, filename });
      continue;
    }
    try {
      const bytes = await fs.readFile(path.join(kitDir, filename));
      logoData[key] = `data:${mime};base64,${bytes.toString('base64')}`;
    } catch (err) {
      log.warn('Logo asset missing — pressing without it', { kit: kitId, logo: key, filename, err: err.message });
    }
  }
  return logoData;
}

/**
 * Loads a brand kit with its logo assets resolved to data URIs. // impure
 * No kitId → the built-in neutral kit.
 * @param {object} [params]
 * @param {string} [params.kitId]
 * @param {string} [params.kitsDir]
 * @returns {Promise<object>} - Frozen kit
 */
export async function loadBrandKit({ kitId, kitsDir } = {}) {
  if (!kitId || kitId === 'default') return DEFAULT_KIT;
  if (!KIT_ID_PATTERN.test(kitId)) {
    throw new Error(`Invalid brand kit id: "${kitId}" (alphanumeric, dash, underscore only)`);
  }
  const kitDir = path.join(resolveKitsDir(kitsDir), kitId);
  let raw;
  try {
    raw = JSON.parse(await fs.readFile(path.join(kitDir, 'kit.json'), 'utf8'));
  } catch (err) {
    throw new Error(`Brand kit "${kitId}" not readable at ${kitDir}: ${err.message}`, { cause: err });
  }
  const kit = validateKit(raw, kitId);
  kit.logoData = await loadLogoData(kitDir, kit.logos, kitId);
  return Object.freeze(kit);
}

/**
 * Lists available brand kits (id + display fields). // impure
 * @param {object} [params]
 * @param {string} [params.kitsDir]
 * @returns {Promise<Array<{id: string, name: string, companyName: string}>>}
 */
export async function listBrandKits({ kitsDir } = {}) {
  const root = resolveKitsDir(kitsDir);
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const kits = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !KIT_ID_PATTERN.test(entry.name)) continue;
    try {
      const raw = JSON.parse(await fs.readFile(path.join(root, entry.name, 'kit.json'), 'utf8'));
      const kit = validateKit(raw, entry.name);
      kits.push({ id: kit.id, name: kit.name, companyName: kit.companyName });
    } catch (err) {
      log.warn('Skipping unreadable brand kit', { kit: entry.name, err: err.message });
    }
  }
  return kits;
}
