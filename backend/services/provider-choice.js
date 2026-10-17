/**
 * provider-choice.js — the operator's chosen mind SURVIVES a restart.
 *
 * PUT /api/llm/provider called setConfig() and nothing else: in-memory. On a
 * packaged install every launch woke up back on the hard-coded default
 * (lm-studio :1234) until the operator re-clicked their provider — Bastien's
 * […], every
 * single boot. Endpoints per provider were already persisted (credential
 * store); WHICH provider is the active mind never was.
 *
 * One JSON file under the data root (settings-store beside the other stores;
 * no secrets — the apiKey stays in the encrypted credential store and is
 * deliberately NOT written here). `chosenBy` records whether an operator
 * picked it ('operator') or the platform adopted a discovered server on a
 * fresh install ('auto') — auto-adoption must never overwrite an operator's
 * explicit choice, and the flight check words the two differently.
 */
import fs from 'fs/promises';
import path from 'path';
import { getDataRoot } from './data-root.js';
import { createLogger } from './logger.js';

const log = createLogger('ProviderChoice');

// impure — reads env via getDataRoot at call time (packaged vs dev roots).
export const providerChoicePath = () =>
  process.env.NEUMA_PROVIDER_CHOICE_PATH
  || path.join(getDataRoot(), 'settings-store', 'llm-provider.json');

/**
 * The persisted choice, or null when none was ever made. impure.
 * @returns {Promise<{provider: string, endpoint?: string, model?: string, chosenBy: 'operator'|'auto', chosenAt: string}|null>}
 */
export const loadProviderChoice = async () => {
  try {
    const raw = await fs.readFile(providerChoicePath(), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.provider === 'string' ? parsed : null;
  } catch {
    return null;
  }
};

/**
 * Persist the active-mind choice. Never the apiKey. impure.
 * @param {{provider: string, endpoint?: string, model?: string}} choice
 * @param {{ chosenBy?: 'operator'|'auto' }} [opts]
 */
export const saveProviderChoice = async ({ provider, endpoint, model }, { chosenBy = 'operator' } = {}) => {
  if (typeof provider !== 'string' || !provider) return;
  const file = providerChoicePath();
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const record = {
      provider,
      ...(endpoint ? { endpoint } : {}),
      ...(model ? { model } : {}),
      chosenBy,
      chosenAt: new Date().toISOString(),
    };
    // Atomic tmp+rename (Realm Persistence law): a crash mid-write on a
    // whole-file store destroys the file — and a corrupt choice file reads
    // as "never chose", the exact loss this store exists to prevent.
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(record, null, 2));
    await fs.rename(tmp, file);
    log.info('Provider choice persisted', { provider, endpoint, chosenBy });
  } catch (err) {
    // A failed persist must not fail the switch — but it is never silent.
    log.error('Provider choice could not be persisted — the choice will not survive a restart', {
      file, error: err.message,
    });
  }
};
