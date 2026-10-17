// Resolve the chain-reader config for CLI commands. Loads the operator's
// .env file into process.env (matching the daemon's dotenv+loadConfig
// contract), then runs backend/config.js's schema validation. The result
// is the same frozen config object the daemon sees at boot — single source
// of truth for chain addresses, RPC URLs, and defaults.
//
// impure (fs read + process.env mutation via dotenv).

import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { loadConfig } from '../../backend/config.js';
import { findProjectRoot } from './project-root.js';

/**
 * Load .env from the project root (if present) and return the validated
 * app config. Missing .env is OK — backend/config.js's schema has sensible
 * defaults (including the deployed contract addresses on Base Sepolia).
 *
 * @param {{ cwd?: string }} [opts]
 * @returns {object} frozen config from backend/config.js loadConfig()
 */
export const resolveChainConfig = ({ cwd = process.cwd() } = {}) => {
  const projectRoot = findProjectRoot(cwd);
  const envPath = resolve(projectRoot, '.env');
  if (existsSync(envPath)) {
    // Do NOT `override: true` — an operator-set env var (e.g. from a wrapper
    // script) should still win over the .env file's value, matching the
    // convention every other consumer of dotenv in this repo uses.
    dotenvConfig({ path: envPath });
  }
  return loadConfig();
};
