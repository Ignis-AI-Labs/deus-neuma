/**
 * The sessions directory handle must close when control throws after open.
 * Live leak: FdCustody named `/…/sessions` because checkControl sat outside
 * the try that closed openedDirectory.handle.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { resetWorkspaceCryptoKey } from '../../core/workspace/workspace-crypto.js';
import { openSubjectCorpusSources } from '../../core/refinement/corpus-source-authority.js';
import { installFdCustody, leakedOpenHandles } from '../../backend/services/fd-custody.js';

const KEY = 'gnosis-sessions-fd-leak-key-long-ok';

describe('openSubjectCorpusSources returns the sessions directory handle', () => {
  let prevKey;
  let prevRoot;
  let neumaId;
  let uninstall;

  beforeAll(async () => {
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = KEY;
    resetWorkspaceCryptoKey();
    prevRoot = getWorkspacesRoot();
    const root = await createTempDir('corpus-sessions-fd');
    setWorkspacesRoot(path.join(root, 'workspaces'));
    uninstall = installFdCustody({ trace: true, logger: { info: () => {}, error: () => {} } });
    neumaId = `fd-sessions-${Math.floor(Math.random() * 1e9).toString(36)}`;
    await workspace.create(neumaId);
    await workspace.writeNeumaDEK(neumaId, 'c0'.repeat(32));
    await workspace.writeDNA(neumaId, { version: '1.0.0', identity: { name: 'Fd Sessions' } });
  });

  afterAll(() => {
    uninstall();
    setWorkspacesRoot(prevRoot);
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
    resetWorkspaceCryptoKey();
  });

  it('an already-aborted signal leaves no standing sessions handle', async () => {
    const before = new Set(leakedOpenHandles().map((h) => h.fd));
    const signal = AbortSignal.abort();
    await expect(openSubjectCorpusSources(workspace, neumaId, { signal }))
      .rejects.toMatchObject({ code: 'ABORT_ERR' });
    const leftover = leakedOpenHandles()
      .filter((h) => !before.has(h.fd))
      .filter((h) => String(h.path).endsWith(`${path.sep}sessions`) || String(h.path).includes('/sessions'));
    expect(leftover).toEqual([]);
  });
});
