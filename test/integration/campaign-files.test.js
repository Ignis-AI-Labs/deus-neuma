/**
 * A campaign carries its own material — and cannot be used to read a secret.
 *
 * Design note, 2026-07-27: […]
 *
 * The security half is the part that needs the most proof. A tied file's
 * CONTENT becomes always-on context for whoever works the campaign, so […] is a READ GRANT, not a bookmark. Unguarded, it would be a way to read
 * any secret on the box by having a being recite it back — attach `.env`, ask
 * the being what its material says. Every path therefore crosses
 * `checkPathAccess`, the same gate every tool call crosses.
 *
 * Real store on real disk, real files, real path guard (RULE 0). Nothing here
 * is mocked; a mocked filesystem could not exhibit the denial being claimed.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { createCampaignStore } from '../../backend/services/marketing/campaign-store.js';
import { buildSharedFilesSection, CAMPAIGN_FILES_SHAPE } from '../../backend/services/project-files.js';

let dir;
let store;
let campaignId;

beforeEach(async () => {
  dir = await createTempDir('campaign-files');
  store = createCampaignStore({ path: path.join(dir, 'campaigns.json') });
  const c = await store.add({ name: 'Umbrae Market Depth', brand: 'Umbrae', channelId: 'x' });
  campaignId = c.id;
});

const write = async (rel, body) => {
  const p = path.join(dir, rel);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, body);
  return p;
};

describe('tying material to a campaign', () => {
  it('ties a real file and keeps who tied it, and when', async () => {
    const brief = await write('brief.md', '# Brief\nMarket depth, not hype.');
    const res = await store.attachFile(campaignId, brief, { addedBy: '0xELI' });
    expect(res.ok).toBe(true);
    const [f] = res.campaign.sharedFiles;
    expect(f.path).toBe(brief);
    expect(f.addedBy).toBe('0xELI');
    expect(Date.parse(f.addedAt)).not.toBeNaN();
  });

  it('is idempotent — tying twice does not duplicate', async () => {
    const brief = await write('brief.md', 'x');
    await store.attachFile(campaignId, brief);
    const again = await store.attachFile(campaignId, brief);
    expect(again.ok).toBe(true);
    expect(again.campaign.sharedFiles).toHaveLength(1);
  });

  it('refuses a file that is not there rather than tying a ghost', async () => {
    const res = await store.attachFile(campaignId, path.join(dir, 'nope.md'));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no such file/);
  });

  it('refuses a directory — only files carry text', async () => {
    await fs.mkdir(path.join(dir, 'folder'), { recursive: true });
    const res = await store.attachFile(campaignId, path.join(dir, 'folder'));
    expect(res.ok).toBe(false);
  });

  it('unties without touching the file itself', async () => {
    const brief = await write('brief.md', 'keep me');
    await store.attachFile(campaignId, brief);
    const res = await store.detachFile(campaignId, brief);
    expect(res.ok).toBe(true);
    expect(res.campaign.sharedFiles).toHaveLength(0);
    expect(await fs.readFile(brief, 'utf8')).toBe('keep me'); // still on disk
  });

  it('says so when asked to untie something that was never tied', async () => {
    const res = await store.detachFile(campaignId, path.join(dir, 'brief.md'));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not tied/);
  });

  it('refuses to tie anything to a campaign that does not exist', async () => {
    const brief = await write('brief.md', 'x');
    expect((await store.attachFile('nope', brief)).error).toMatch(/no such campaign/);
  });
});

describe('attaching is a READ GRANT, so the denied-path gate applies', () => {
  const denied = [
    ['a .env', '.env'],
    ['a file inside .git', '.git/config'],
    ['the .git directory itself', '.git'],
    ['a vault file', 'vault/secrets.json'],
    ['key material', 'keys/keypair.json'],
    ["another being's DNA", 'data/dna/being.json'],
  ];
  it.each(denied)('refuses %s', async (_label, rel) => {
    // The file is REAL — the refusal must come from the path guard, not from
    // the file being missing, or this test would pass for the wrong reason.
    const p = await write(rel, 'SECRET-MATERIAL');
    const res = await store.attachFile(campaignId, p);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Access denied/i);
  });

  it('still allows ordinary campaign material beside those', async () => {
    const ok = await write('docs/marketing/brand-voice.md', 'Plain, evidenced, no superlatives.');
    expect((await store.attachFile(campaignId, ok)).ok).toBe(true);
  });

  // The gate is lexical; every later step follows symlinks. A link at an
  // innocent NAME pointing into the denied set would otherwise pass on its
  // link name while its target's content became always-on context.
  it('refuses a symlink whose TARGET is denied, not just a denied name', async () => {
    const secret = await write('.env', 'DEPLOYER_PRIVATE_KEY=0xdeadbeef');
    const link = path.join(dir, 'innocent-notes.md');
    await fs.symlink(secret, link);
    const res = await store.attachFile(campaignId, link);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('access-denied');
  });

  it('stores the REAL path, so the read cannot be redirected later', async () => {
    const realFile = await write('docs/brief.md', 'the brief');
    const link = path.join(dir, 'brief-link.md');
    await fs.symlink(realFile, link);
    const res = await store.attachFile(campaignId, link);
    expect(res.ok).toBe(true);
    expect(res.campaign.sharedFiles[0].path).toBe(realFile); // resolved, not the link
  });

  it('carries a structured code, so a route never switches on wording', async () => {
    const p = await write('.env', 'x');
    expect((await store.attachFile(campaignId, p)).code).toBe('access-denied');
    expect((await store.attachFile(campaignId, path.join(dir, 'ghost.md'))).code).toBe('missing');
    expect((await store.attachFile('nope', await write('a.md', 'x'))).code).toBe('no-campaign');
  });
});

describe('the read-time re-check — attached innocent, swapped later', () => {
  it('REFUSES at read time when a tied file becomes a symlink into the denied set', async () => {
    const benign = await write('brief.md', 'the honest brief');
    expect((await store.attachFile(campaignId, benign)).ok).toBe(true);

    // The attacker's move: replace the tied file with a link to a secret.
    const secret = await write('.env', 'DNA_ENCRYPTION_KEY=supersecret');
    await fs.unlink(benign);
    await fs.symlink(secret, benign);

    const [campaign] = await store.load();
    const { section, skipped } = await buildSharedFilesSection(campaign, CAMPAIGN_FILES_SHAPE);
    expect(section).toBeNull();                       // nothing reaches the turn
    expect(skipped[0].reason).toMatch(/refused/);     // and the skip says why
    // The secret's content never appears anywhere in the result.
    expect(JSON.stringify({ section, skipped })).not.toContain('supersecret');
  });
});

describe('an ordinary edit never clobbers the material', () => {
  it('survives a campaign update', async () => {
    const brief = await write('brief.md', 'x');
    await store.attachFile(campaignId, brief);
    const res = await store.update(campaignId, { cadence: '3 posts daily' });
    expect(res.ok).toBe(true);
    expect(res.campaign.sharedFiles).toHaveLength(1);
    expect(res.campaign.cadence).toBe('3 posts daily');
  });
});

describe('the material reaches a turn as context', () => {
  it('renders tied files into a bounded CAMPAIGN FILES section', async () => {
    const brief = await write('brief.md', '# Brief\nMarket depth, not hype.');
    const voice = await write('voice.md', 'Never promise returns.');
    await store.attachFile(campaignId, brief);
    await store.attachFile(campaignId, voice);
    const [campaign] = await store.load();

    const { section, included, skipped } = await buildSharedFilesSection(campaign, CAMPAIGN_FILES_SHAPE);
    expect(skipped).toEqual([]);
    expect(included).toHaveLength(2);
    expect(section.id).toBe('campaignFiles');
    expect(section.label).toBe('CAMPAIGN FILES');
    expect(section.text).toContain('Umbrae Market Depth'); // names the campaign
    expect(section.text).toContain('Market depth, not hype.');
    expect(section.text).toContain('Never promise returns.');
    // The instruction that makes the material load-bearing rather than decorative.
    expect(section.text).toMatch(/work from THESE/i);
  });

  it('is null when a campaign carries nothing — no empty section in the prompt', async () => {
    const [campaign] = await store.load();
    const { section } = await buildSharedFilesSection(campaign, CAMPAIGN_FILES_SHAPE);
    expect(section).toBeNull();
  });

  it('reports a skip instead of silently dropping an unreadable file', async () => {
    const gone = await write('gone.md', 'x');
    await store.attachFile(campaignId, gone);
    await fs.unlink(gone); // tied, then deleted from under us
    const [campaign] = await store.load();
    const { section, skipped } = await buildSharedFilesSection(campaign, CAMPAIGN_FILES_SHAPE);
    expect(section).toBeNull();
    expect(skipped).toEqual([{ path: gone, reason: 'missing' }]);
  });
});
