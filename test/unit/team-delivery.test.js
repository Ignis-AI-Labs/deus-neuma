// team-delivery — the DELIVERY lane: a finished run's workspace, packaged so
// the witness opens every deliverable from the stream. Real disk (RULE 0):
// real workspaces, real manifests, real symlinks for the escape attempt.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { snapshotDelivery, readDelivery, readDeliveryFile, deliverableKind } from '../../backend/services/team-delivery.js';

const WALLET = '0xAbCd000000000000000000000000000000000001';
const OTHER = '0x9999000000000000000000000000000000000002';

let base; // holds the manifest dir AND the workspace

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'delivery-'));
  process.env.NEUMA_TEAM_DELIVERY_PATH = path.join(base, 'manifests');
});

afterEach(() => {
  delete process.env.NEUMA_TEAM_DELIVERY_PATH;
  fs.rmSync(base, { recursive: true, force: true });
});

const makeArena = () => {
  const root = path.join(base, 'arena');
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'main.py'), 'print("hi")\n');
  fs.writeFileSync(path.join(root, 'game.html'), '<html><script>1</script></html>');
  return root;
};

describe('the delivery lane', () => {
  it('registers a delivery and lists the workspace LIVE — later writes appear', async () => {
    const root = makeArena();
    const reg = await snapshotDelivery({ id: 'run-1', by: WALLET, root });
    expect(reg).toMatchObject({ id: 'run-1', root });

    // The LEAD keeps writing after team_run — the listing must see it.
    fs.writeFileSync(path.join(root, 'verify_test.py'), 'assert True\n');
    const d = await readDelivery('run-1', WALLET);
    expect(d.files.map((f) => f.file)).toEqual(['game.html', 'main.py', 'verify_test.py']);
    expect(d.files.find((f) => f.file === 'game.html').kind).toBe('html');
  });

  it('is owner-scoped — someone else reads absence, never the files', async () => {
    const root = makeArena();
    await snapshotDelivery({ id: 'run-2', by: WALLET, root });
    expect(await readDelivery('run-2', OTHER)).toBe(null);
    expect((await readDeliveryFile('run-2', OTHER, 'main.py')).ok).toBe(false);
  });

  it('serves a delivered file as data, by kind', async () => {
    const root = makeArena();
    await snapshotDelivery({ id: 'run-3', by: WALLET, root });
    const py = await readDeliveryFile('run-3', WALLET, 'main.py');
    expect(py).toMatchObject({ ok: true, kind: 'text' });
    expect(py.text).toContain('print');
    const html = await readDeliveryFile('run-3', WALLET, 'game.html');
    expect(html).toMatchObject({ ok: true, kind: 'html' });
  });

  it('refuses a path that leaves the workspace — including a planted symlink', async () => {
    const root = makeArena();
    const secret = path.join(base, 'secret.txt');
    fs.writeFileSync(secret, 'not yours');
    fs.symlinkSync(secret, path.join(root, 'innocent.txt'));
    await snapshotDelivery({ id: 'run-4', by: WALLET, root });

    const traversal = await readDeliveryFile('run-4', WALLET, '../secret.txt');
    expect(traversal.ok).toBe(false);
    const symlink = await readDeliveryFile('run-4', WALLET, 'innocent.txt');
    expect(symlink.ok).toBe(false);
    expect(symlink.error).toContain('leaves the delivery workspace');
  });

  it('kinds map to how the viewer renders', () => {
    expect(deliverableKind('a.png')).toBe('image');
    expect(deliverableKind('a.svg')).toBe('svg');
    expect(deliverableKind('a.html')).toBe('html');
    expect(deliverableKind('a.py')).toBe('text');
  });
});
