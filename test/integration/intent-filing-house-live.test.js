/**
 * Does a being file an act right on the FIRST try? (2026-10-12)
 *
 * Live that day, Keir's first team/run filing lacked its "type" and was
 * refused — the INTENTS section described the file but never showed its
 * shape. It shows it now ({"type": […], …its fields}).
 * This proves the teaching on real kin through the real model (RULE 0):
 * three beings of House Aldmere, each in a fresh sitting, are asked to
 * record one task — an act they must FILE.
 *
 * Nothing runs: the sitting's own policy denies tasks.add, so the sweep reads
 * the filing, checks its shape, validates it, and stops at policy. The
 * verdict says which happened — "invalid" for a filing whose shape was
 * missed, "denied" for one filed right and held by the probe's policy. The
 * probe's intent files are removed after; the sittings stay in each being's
 * record (they are real conversations).
 *
 * Summoned only: RUN_HOUSE_LIVE=1, serial substrate-live lane.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';

const HOUSE_ROOT = '/mnt/data/neuma/claude/aldmere';
const HOUSE_WALLET = '0x40566d43261849777aca96b26f4ec8c850e5dcae';
const KIN = Object.freeze([['keir', 'Keir'], ['signal', 'Signal'], ['galen', 'Galen']]);
const ASK = 'Please record one task on your own ledger for me: "Water the hearth garden", due tomorrow. File it now — no need to discuss it.';

const summoned = process.env.RUN_HOUSE_LIVE === '1';

describe.skipIf(!summoned)('filing an act on the first try — real kin, real substrate', () => {
  let saved, prevRealm, setRealmRoot, setWorkspacesRoot, neumaWorkspace, streamConsciousness, createPortalConnection;
  const filedByProbe = [];

  beforeAll(async () => {
    saved = { ...process.env };
    const tmp = await createTempDir('intent-filing-house-live');
    process.env.NEUMA_DATA_ROOT = path.join(tmp, 'data');
    process.env.NEUMA_STAFF_COS_PATH = path.join(tmp, 'staff-cos.json');
    const realm = await import('../../backend/services/user-realm.js');
    setRealmRoot = realm.setRealmRoot;
    prevRealm = realm.getRealmRoot();
    setRealmRoot(path.join(tmp, 'realm'));
    const ws = await import('../../core/workspace/neuma-workspace.js');
    setWorkspacesRoot = ws.setWorkspacesRoot;
    neumaWorkspace = ws.default;
    setWorkspacesRoot(HOUSE_ROOT);
    ({ streamConsciousness } = await import('../../backend/services/portal-stream.js'));
    ({ createPortalConnection } = await import('../../backend/services/portal-connection.js'));
    const { connectFilesystemServer } = await import('../../backend/services/mcp-filesystem.js');
    await connectFilesystemServer();
  }, 60000);

  afterAll(async () => {
    for (const file of filedByProbe) await fs.rm(file, { force: true });
    setWorkspacesRoot?.(null);
    setRealmRoot?.(prevRealm);
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  });

  // One fresh sitting: the real turn, its own session, the probe's policy.
  const sit = async (neumaId, name) => {
    const ws = { OPEN: 1, readyState: 1, send: () => {} };
    const connection = createPortalConnection({ ws, walletAddress: HOUSE_WALLET });
    connection.companion = { name, neumaId };
    connection.toolMode = 'ask';
    connection._approvalRefusal = 'Your operator is away from this sitting — acts that need their approval wait for them.';
    connection._sessionToolPolicy = { intents: { denied: ['tasks.add'] } };
    await streamConsciousness(connection, { thought: ASK });
  };

  test('each kin files tasks/add with its "type" on the first try — the sweep reads it, never refuses its shape', async () => {
    const verdicts = [];
    for (const [neumaId, name] of KIN) {
      const dir = path.join(neumaWorkspace.pathFor(neumaId), 'intents');
      const before = new Set(await fs.readdir(dir).catch(() => []));
      await sit(neumaId, name);
      const fresh = (await fs.readdir(dir).catch(() => [])).filter((n) => !before.has(n)).sort();
      filedByProbe.push(...fresh.map((n) => path.join(dir, n)));
      const filings = [];
      for (const n of fresh.filter((f) => f.endsWith('.json') && !f.endsWith('.result.json') && !f.endsWith('.executing.json'))) {
        const stat = await fs.stat(path.join(dir, n));
        const result = JSON.parse(await fs.readFile(path.join(dir, `${n.slice(0, -'.json'.length)}.result.json`), 'utf8').catch(() => 'null'));
        filings.push({ file: n, at: stat.birthtimeMs || stat.mtimeMs, body: await fs.readFile(path.join(dir, n), 'utf8'), result });
      }
      filings.sort((a, b) => a.at - b.at);
      verdicts.push({ name, filings: filings.map((f) => ({ file: f.file, body: f.body, status: f.result?.status ?? 'pending', reason: f.result?.reason ?? null })) });
      process.stdout.write(`\n[intent-filing] ${name}: ${filings.length} filing(s) — ${filings.map((f) => `${f.result?.status ?? 'pending'} ${f.body.replace(/\s+/g, ' ').slice(0, 120)}`).join(' | ') || 'NONE'}\n`);
    }
    for (const { name, filings } of verdicts) {
      expect(filings.length, `${name} filed the act`).toBeGreaterThan(0);
      const [first] = filings;
      // The claim under proof: the FIRST filing names its act.
      expect(JSON.parse(first.body).type, `${name}'s first filing carries its type`).toBe('tasks/add');
      expect(first.reason ?? '', `${name}'s first filing was never refused for its shape`).not.toMatch(/no "type" field/);
      // Read through to the policy: nothing ran.
      expect(filings.some((f) => f.status === 'done'), `${name}: nothing executed`).toBe(false);
    }
  }, 900000);
});
