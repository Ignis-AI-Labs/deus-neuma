#!/usr/bin/env node
/**
 * Sync the provider catalog from models.dev (the same data source OpenCode
 * builds its 75+ provider surface from).
 *
 * Fetches https://models.dev/api.json, maps every provider we can actually
 * SPEAK to (dialect honesty — no half-supported entries) into the platform's
 * provider-entry shape, and rewrites the committed snapshot at
 * backend/services/provider-catalog-data.js.
 *
 * Operator-invoked only — the running platform never fetches models.dev at
 * runtime. Re-run when the catalog should move forward; review the diff like
 * any other change.
 *
 * Usage: node scripts/sync-provider-catalog.mjs [--from <path>] [--check]
 *   --from <path>  map a previously downloaded api.json instead of fetching
 *   --check        report what would change without writing
 */

import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(REPO_ROOT, 'backend', 'services', 'provider-catalog-data.js');
const API_URL = 'https://models.dev/api.json';

const args = process.argv.slice(2);
const fromIdx = args.indexOf('--from');
const FROM_FILE = fromIdx !== -1 ? args[fromIdx + 1] : null;
const CHECK_ONLY = args.includes('--check');

// Ids the hand-written core registry already owns — generated entries must
// never shadow them (keys, route overrides, and UI reference these ids).
const CORE_IDS = new Set([
  'llama-server', 'lm-studio', 'ollama', 'openai', 'anthropic', 'xai',
  'z-ai', 'openrouter', 'deepseek', 'groq', 'custom', 'claude-code-local',
]);
// models.dev ids that collide with a core id under a DIFFERENT spelling.
const RENAMED_CORE = new Set(['zai']);
// models.dev entries a core entry already covers functionally (same server,
// different default port spelling) — the picker must not offer two rows for
// one substrate.
const COVERED_BY_CORE = new Set(['lmstudio', 'llama']);

// npm package → wire dialect we actually speak. Anything unmapped is excluded
// from the snapshot (signing-based clouds: bedrock/vertex/azure, and esoteric
// SDKs whose wire differs from chat/completions or the messages API).
const DIALECT_BY_NPM = Object.freeze({
  '@ai-sdk/openai-compatible': 'openai',
  '@ai-sdk/openai': 'openai',
  '@ai-sdk/anthropic': 'anthropic',
  '@ai-sdk/xai': 'openai',
  '@ai-sdk/groq': 'openai',
  '@ai-sdk/mistral': 'openai',
  '@ai-sdk/cerebras': 'openai',
  '@ai-sdk/google': 'openai', // generativelanguage openai-compat surface
  '@ai-sdk/cohere': 'openai',
  '@ai-sdk/deepinfra': 'openai',
  '@ai-sdk/togetherai': 'openai',
  '@ai-sdk/perplexity': 'openai',
  '@aihubmix/ai-sdk-provider': 'openai',
  'venice-ai-sdk-provider': 'openai',
  '@ai-sdk/gateway': 'openai',
  '@ai-sdk/vercel': 'openai',
  '@openrouter/ai-sdk-provider': 'openai',
  '@ai-sdk/ollama': 'ollama',
});

// Base URLs for npm-native providers whose models.dev entry carries no `api`.
const KNOWN_BASE_URL = Object.freeze({
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  xai: 'https://api.x.ai',
  groq: 'https://api.groq.com/openai',
  mistral: 'https://api.mistral.ai/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai',
  cerebras: 'https://api.cerebras.ai/v1',
  cohere: 'https://api.cohere.ai/compatibility/v1',
  deepinfra: 'https://api.deepinfra.com/v1/openai',
  togetherai: 'https://api.together.xyz/v1',
  perplexity: 'https://api.perplexity.ai',
  venice: 'https://api.venice.ai/api/v1',
  aihubmix: 'https://aihubmix.com/v1',
  vercel: 'https://ai-gateway.vercel.sh/v1',
  v0: 'https://api.v0.dev/v1',
});

const LOOPBACK = /^https?:\/\/(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|\[::1\])(:|\/|$)/i;
const VERSIONED_BASE = /\/v\d+[a-z0-9-]*$/i;

// pure — the chat path for a dialect + base URL. The openai-compatible
// convention (what @ai-sdk/openai-compatible does) appends /chat/completions
// to the base as-is; anthropic appends /messages to a versioned base.
const chatPathFor = (dialect, base) => {
  if (dialect === 'anthropic') return VERSIONED_BASE.test(base) ? '/messages' : '/v1/messages';
  if (dialect === 'ollama') return '/api/chat';
  return '/chat/completions';
};

// pure — map one models.dev provider into our entry shape, or null to exclude.
const mapProvider = (id, p) => {
  const dialect = DIALECT_BY_NPM[p.npm];
  if (!dialect) return { entry: null, reason: `unspeakable npm (${p.npm})` };
  const endpoint = p.api || KNOWN_BASE_URL[id] || null;
  if (!endpoint) return { entry: null, reason: 'no base URL' };
  if (!/^https:\/\//i.test(endpoint) && !LOOPBACK.test(endpoint)) {
    return { entry: null, reason: `refused endpoint scheme (${endpoint})` };
  }
  const base = endpoint.replace(/\/$/, '');
  // Carry the windows models.dev publishes — the catalog is the only limit
  // source most third-party models have (Design note, 2026-07-27: […]). Dropping them at sync
  // time was why the desk read LIMIT UNKNOWN on catalog models. Only finite
  // positive values cross over; an absent limit stays absent, never invented.
  const models = Object.entries(p.models || {})
    .slice(0, 20)
    .map(([modelId, m]) => {
      const entry = { id: modelId, name: m?.name || modelId };
      const context = m?.limit?.context;
      const output = m?.limit?.output;
      if (Number.isFinite(context) && context > 0) entry.contextWindow = context;
      if (Number.isFinite(output) && output > 0) entry.maxOutput = output;
      return entry;
    });
  const local = LOOPBACK.test(base);
  const entry = {
    id,
    name: p.name || id,
    kind: local ? 'local' : 'cloud',
    dialect,
    endpoint: base,
    chatPath: chatPathFor(dialect, base),
    keyEnv: Array.isArray(p.env) && p.env.length ? p.env[0] : null,
    requiresKey: !local,
    defaultModel: models[0]?.id ?? null,
    models,
  };
  return { entry, reason: null };
};

const fetchCatalog = async () => {
  if (FROM_FILE) return JSON.parse(await readFile(FROM_FILE, 'utf8'));
  const res = await fetch(API_URL);
  if (!res.ok) throw new Error(`models.dev fetch failed: ${res.status}`);
  return res.json();
};

const run = async () => {
  const raw = await fetchCatalog();
  const entries = [];
  const skipped = [];
  for (const [id, p] of Object.entries(raw)) {
    if (CORE_IDS.has(id) || RENAMED_CORE.has(id)) {
      skipped.push(`${id} (core-owned)`);
      continue;
    }
    if (COVERED_BY_CORE.has(id)) {
      skipped.push(`${id} (covered by core)`);
      continue;
    }
    const { entry, reason } = mapProvider(id, p);
    if (entry) entries.push(entry);
    else skipped.push(`${id} (${reason})`);
  }
  entries.sort((a, b) => a.id.localeCompare(b.id));

  const body = `/**
 * GENERATED FILE — do not edit by hand.
 * Regenerate with: node scripts/sync-provider-catalog.mjs
 *
 * Provider catalog snapshot from models.dev (${API_URL}), mapped into the
 * platform's provider-entry shape. Synced ${new Date().toISOString().split('T')[0]}
 * — ${entries.length} providers, ${skipped.length} excluded (core-owned or
 * unspeakable dialect; see the sync script's report).
 *
 * Only providers whose wire the platform actually speaks are included:
 * openai chat/completions, anthropic messages, ollama. Signing-based clouds
 * (Bedrock/Vertex/Azure) are excluded by construction.
 */

export const GENERATED_PROVIDERS = Object.freeze([
${entries.map((e) => `  Object.freeze(${JSON.stringify(e)}),`).join('\n')}
]);
`;

  console.log(`mapped:   ${entries.length} providers`);
  console.log(`excluded: ${skipped.length}`);
  for (const s of skipped) console.log(`  - ${s}`);
  if (CHECK_ONLY) {
    console.log('--check: nothing written');
    return;
  }
  await writeFile(TARGET, body);
  console.log(`\nwrote ${path.relative(REPO_ROOT, TARGET)}`);
};

run().catch((err) => {
  console.error(`sync failed: ${err.message}`);
  process.exit(1);
});
