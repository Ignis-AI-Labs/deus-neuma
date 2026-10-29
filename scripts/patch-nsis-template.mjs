#!/usr/bin/env node
/**
 * PATCH NSIS TEMPLATE — keep electron-builder's installer from crashing on a fresh Windows install.
 * The reason and the pure rule are in nsis-template-patch.mjs.
 *
 *   node scripts/patch-nsis-template.mjs            patch (postinstall; never fails an install)
 *   node scripts/patch-nsis-template.mjs --check    exit 1 unless the template is safe (the Windows
 *                                                   build runs this before it makes an installer)
 *
 * Safe to re-run: a patched template is left as it is.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchMultiUser } from './nsis-template-patch.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const template = path.join(repoRoot, 'node_modules', 'app-builder-lib', 'templates', 'nsis', 'multiUser.nsh');
const check = process.argv.includes('--check');

// impure — reads and rewrites the one template file
const run = () => {
  if (!fs.existsSync(template)) { console.log('[patch-nsis-template] electron-builder is not installed; nothing to patch'); return check ? 1 : 0; }
  const { state, text } = patchMultiUser(fs.readFileSync(template, 'utf8'));
  if (state === 'patched') fs.writeFileSync(template, text);
  console.log(`[patch-nsis-template] multiUser.nsh: ${state}`);
  // absent: the code changed under us. An install carries on; a build must not ship what it has not read
  return check && state === 'absent' ? 1 : 0;
};

try {
  process.exit(run());
} catch (err) {
  // never fail an install over this patch; a build checks with --check and stops
  console.warn(`[patch-nsis-template] ${err.message}`);
  process.exit(check ? 1 : 0);
}
