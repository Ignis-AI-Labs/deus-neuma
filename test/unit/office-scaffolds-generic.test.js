/**
 * Every house's offices start from its OWN facts. The legal and security offices
 * are seeded into a new house's workspace when the operator seats them; what they
 * seed is read as the truth about the house, so it must name no one company, no
 * one machine, and no one developer's repositories. Real scaffolds, real disk.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { scaffoldCloWorkspace } from '../../backend/services/legal/clo-scaffold.js';
import { scaffoldCsoWorkspace } from '../../backend/services/security/cso-scaffold.js';

// One company's, one machine's, one developer's facts — none belongs in every house.
const NOT_EVERY_HOUSE = /Ignis|Wyoming|Sheridan|528813|2026-002058193|Fedora|Xid 79|evm-contracts|unavis-site|umbrae|Tavirel|Aldmere|\/mnt\/(ignis|ai|neuma)/i;

let root; let prior;
beforeEach(async () => {
  prior = getWorkspacesRoot();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'office-scaffold-'));
  setWorkspacesRoot(root);
});
afterEach(async () => {
  setWorkspacesRoot(prior);
  await fs.rm(root, { recursive: true, force: true });
});

const filesIn = async (dir) => (await fs.readdir(dir, { withFileTypes: true }))
  .filter((d) => d.isFile()).map((d) => path.join(dir, d.name));

describe('a new house\'s offices carry no other house\'s facts', () => {
  test('the legal office: charter and register', async () => {
    const { dir } = await scaffoldCloWorkspace('new-house-praetor');
    for (const file of await filesIn(dir)) expect(await fs.readFile(file, 'utf8'), path.basename(file)).not.toMatch(NOT_EVERY_HOUSE);
  });

  test('the security office: playbook and surfaces', async () => {
    const { dir } = await scaffoldCsoWorkspace('new-house-cso');
    for (const file of await filesIn(dir)) expect(await fs.readFile(file, 'utf8'), path.basename(file)).not.toMatch(NOT_EVERY_HOUSE);
  });
});
