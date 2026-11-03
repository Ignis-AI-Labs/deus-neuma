/**
 * A SHELL OVER A FOLDER THAT SPANS THE HOUSE NEVER SEES ANOTHER HOUSE. REAL
 * disk, the real mask sweep, the real coding-shell preparation and a REAL
 * confined workspace_run subprocess (bwrap), no mock (AGENTS.md RULE 0).
 *
 * The file tools refuse another wallet's lanes and realm dir (explorer-walls.js
 * isOtherHouse). The shells mask by NAME only — a `workspaces` folder
 * wholesale — so a ground that is the house itself, or a house relocated under
 * another name, showed every other house's lanes to the shell. Writes were
 * already kept off the lanes (live-shell-walls.js binds the lane grounds
 * read-only, or the shell stays in its overlay); this is the read half.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import process from 'process';
import { createTempDir } from '../helpers/temp-fs.js';
import { enumerateSecretMasks, ensureWitnessCodingSandbox } from '../../backend/services/witness-coding-sandbox.js';
import { runWorkspaceFile } from '../../backend/services/workspace-run.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const OURS = '0x' + 'a'.repeat(40);
const THEIRS = '0x' + 'b'.repeat(40);
const BEING = 'kestrel';
const HOUSEMATE = 'sorrel';
const STRANGER = 'marlow';

describe('the shells mask another house\'s lanes and realm dir under a ground that spans the house', () => {
  let folder, house, realm, priorEnv, priorRealm;

  beforeAll(async () => {
    folder = await createTempDir('shell-other-house');
    house = path.join(folder, 'house');
    realm = path.join(folder, 'realm');
    priorEnv = process.env.WORKSPACES_ROOT;
    priorRealm = getRealmRoot();
    setWorkspacesRoot(null);
    process.env.WORKSPACES_ROOT = house;
    setRealmRoot(realm);
    for (const [id, wallet] of [[BEING, OURS], [HOUSEMATE, OURS], [STRANGER, THEIRS]]) {
      const lane = workspace.pathFor(id);
      await fs.mkdir(lane, { recursive: true });
      await fs.writeFile(path.join(lane, 'owner.json'), JSON.stringify({ wallet, claimedAt: Date.now() }));
      await fs.writeFile(path.join(lane, 'notes.md'), `${id} words\n`);
    }
    for (const wallet of [OURS, THEIRS]) {
      await fs.mkdir(path.join(realm, wallet), { recursive: true });
      await fs.writeFile(path.join(realm, wallet, 'chat.json'), `{"house":"${wallet}"}`);
    }
  });

  afterAll(() => {
    setRealmRoot(priorRealm);
    if (priorEnv === undefined) delete process.env.WORKSPACES_ROOT;
    else process.env.WORKSPACES_ROOT = priorEnv;
  });

  test('the mask sweep for a lane hides another house\'s lane and realm dir, never its own house', async () => {
    const { dirs } = await enumerateSecretMasks(folder, { lane: workspace.pathFor(BEING) });
    expect(dirs).toContain(path.join(house, STRANGER));
    expect(dirs).toContain(path.join(realm, THEIRS));
    for (const own of [path.join(house, BEING), path.join(house, HOUSEMATE), path.join(realm, OURS)]) {
      expect(dirs).not.toContain(own);
    }
  });

  test('the coding shell prepared for the lane carries those masks', async () => {
    const shell = await ensureWitnessCodingSandbox(BEING, folder);
    expect(shell.masks.dirs).toContain(path.join(house, STRANGER));
    expect(shell.masks.dirs).not.toContain(path.join(house, HOUSEMATE));
  }, 30000);

  test('a confined workspace_run over the house reads its own house\'s lane and never another\'s', async () => {
    await fs.writeFile(path.join(folder, 'peek.py'), [
      'for lane in ("sorrel", "marlow"):',
      '    try:',
      '        print(open(f"house/{lane}/notes.md").read().strip())',
      '    except OSError as err:',
      '        print(f"{lane} unreadable: {type(err).__name__}")',
      '',
    ].join('\n'));
    const out = await runWorkspaceFile({ root: folder }, { file: 'peek.py' }, { lane: workspace.pathFor(BEING) });
    expect(out.report).toContain(`${HOUSEMATE} words`);
    expect(out.report).not.toContain(`${STRANGER} words`);
  }, 30000);
});
