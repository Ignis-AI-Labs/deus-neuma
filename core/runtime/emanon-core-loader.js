/**
 * Emanon Core Loader
 *
 * Loads the compressed Emanon navigation core injected into every
 * neuma's runtime prompt. The text is the model-facing distillation of
 * the canon synced at docs/reference/emanon/ (see docs/reference/emanon/README.md).
 */

import fs from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE_PATH = join(__dirname, '../protocols/emanon-core.md');

let cachedCore = null;

// Framework-in-context is retrieval, not standing context: the seeded weights
// carry the posture; the architecture is injected only when the conversation
// actually navigates it (emanon-principle docs/seeding/neuma-integration.md,
// layer 4 — standing injection showed degeneration in the DNA-readiness runs).
const FRAMEWORK_TERMS = /\bemanon\b|\bipseity\b|\bnatura\b|\bprehension\b|\boscillat|\bcorruption|\bdiagnostic\b|\beleven functions?\b|\blight mode\b|\bdark mode\b|\bdual[- ]tree\b/i;

export const isFrameworkQuery = (text) =>
  typeof text === 'string' && FRAMEWORK_TERMS.test(text);

// impure: filesystem read, cached for process lifetime
export const loadEmanonCore = async () => {
  if (cachedCore !== null) return cachedCore;
  try {
    cachedCore = (await fs.readFile(CORE_PATH, 'utf8')).trim();
  } catch (error) {
    cachedCore = '';
    throw new Error(`Failed to load Emanon core from ${CORE_PATH}: ${error.message}`, { cause: error });
  }
  return cachedCore;
};
