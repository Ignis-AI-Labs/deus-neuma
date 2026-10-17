#!/usr/bin/env node

/**
 * Launch one project command inside its persistent per-agent port/data lane.
 * The child inherits the identity so nested npm scripts reuse the same lease.
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolvePipelineEnvironment } = require('../electron/pipeline-ports.cjs');

const args = process.argv.slice(2);
if (args[0] === '--') args.shift();
if (args.length === 0) {
  process.stderr.write('Usage: run-with-pipeline-ports.mjs <command> [args...]\n');
  process.exit(2);
}

try {
  const assignment = resolvePipelineEnvironment(process.env);
  const env = { ...process.env, ...assignment.environment };
  const expanded = args.map((argument) => argument.replaceAll('{NEUMA_DEBUG_PORT}', env.NEUMA_DEBUG_PORT || '9229'));
  // Windows: node_modules/.bin shims are .cmd files, which need a shell to run.
  // Pass a single quoted command line so Node doesn't emit DEP0190 for shell+args.
  const child = process.platform === 'win32'
    ? spawn(expanded.map((a) => (/[\s"]/.test(a) ? `"${a.replaceAll('"', '\\"')}"` : a)).join(' '), { env, stdio: 'inherit', shell: true })
    : spawn(expanded[0], expanded.slice(1), { env, stdio: 'inherit' });
  const forward = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  process.once('SIGINT', () => forward('SIGINT'));
  process.once('SIGTERM', () => forward('SIGTERM'));
  child.once('error', (error) => {
    process.stderr.write(`NEUMA pipeline launch failed: ${error.message}\n`);
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
} catch (error) {
  process.stderr.write(`NEUMA pipeline allocation failed: ${error.message}\n`);
  process.exitCode = 1;
}
