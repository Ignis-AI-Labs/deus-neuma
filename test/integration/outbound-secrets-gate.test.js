/**
 * SECRETS NEVER LEAVE THE HOUSE (security-seat G5) — every outbound act
 * refuses a payload carrying a key shape BEFORE it leaves, and names only
 * the pattern; an honest payload still passes. RULE 0, no double anywhere:
 * the REAL intent sweep over REAL intent files (social/post, email/send), the
 * REAL campaign queue on tmp disk (staging, edit, approval, the send claim,
 * the reply send), and the REAL press handler with the real Chromium.
 *
 * The fake keys are assembled at runtime, so this file itself never trips
 * the repo's own secret sweep.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { sweepIntents } from '../../backend/services/intents/intent-sweep.js';
import { channelBindings } from '../../backend/services/social/channel-bindings.js';
import { emailBinding } from '../../backend/services/email/email-binding.js';
import { setEmailCredential } from '../../backend/services/email/email-credentials.js';
import { createPostQueue } from '../../backend/services/social/post-queue.js';
import { handlePressTool } from '../../backend/services/doc-press/press-being-tools.js';
import { checkOutboundSecrets } from '../../backend/services/security/outbound-secrets.js';
import { usePositionHouse, ownLane, POSITION_HOUSE } from '../helpers/position-house.js';
import workspace from '../../core/workspace/neuma-workspace.js';

const AWS_KEY = ['AKIA', 'Q'.repeat(16)].join('');
const GH_TOKEN = ['gh', 'p_', 'x'.repeat(36)].join('');
const LANE = 'outboundprobe';
const ENV = [
  'WORKSPACES_ROOT', 'NEUMA_SOCIAL_BINDINGS_PATH', 'NEUMA_SOCIAL_CREDENTIALS_PATH',
  'NEUMA_EMAIL_CREDENTIALS_PATH', 'NEUMA_EMAIL_BINDING_PATH', 'NEUMA_BRAND_KITS_DIR',
  'X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET',
];

let dir;
let position;
const saved = {};

const rig = () => {
  const sent = [];
  const events = [];
  const ws = { readyState: 1, OPEN: 1, send: (s) => sent.push(JSON.parse(s)) };
  return { sent, events, connection: { ws, companion: { name: 'Probe', neumaId: LANE }, activeTurn: null } };
};
const fileIntent = async (name, payload) => {
  const intents = path.join(workspace.pathFor(LANE), 'intents');
  await fsp.mkdir(intents, { recursive: true });
  await fsp.writeFile(path.join(intents, `${name}.json`), JSON.stringify(payload));
};
const resultOf = async (name) => JSON.parse(await fsp.readFile(path.join(workspace.pathFor(LANE), 'intents', `${name}.result.json`), 'utf8'));
const sweep = (r, mode = 'ask') => sweepIntents(r.connection, { mode, lanePolicy: null, emit: (ev) => r.events.push(ev) });

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'outbound-secrets-'));
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.WORKSPACES_ROOT = dir;
  process.env.NEUMA_SOCIAL_BINDINGS_PATH = path.join(dir, 'social-bindings.json');
  process.env.NEUMA_SOCIAL_CREDENTIALS_PATH = path.join(dir, 'social-credentials.json');
  process.env.NEUMA_EMAIL_CREDENTIALS_PATH = path.join(dir, 'email-credentials.json');
  process.env.NEUMA_EMAIL_BINDING_PATH = path.join(dir, 'email-binding.json');
  process.env.NEUMA_BRAND_KITS_DIR = path.join(dir, 'kits');
  position = usePositionHouse(dir);
  await workspace.create(LANE);
  await ownLane(LANE);
});

afterEach(() => {
  position.restore();
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('the shared helper', () => {
  test('names the pattern ids only, never the value; honest text passes', () => {
    const refused = checkOutboundSecrets('the post', [`ship it ${AWS_KEY}`, null, `and ${GH_TOKEN}`]);
    expect(refused.ok).toBe(false);
    expect(refused.reason).toContain('aws-access-key');
    expect(refused.reason).toContain('github-token');
    expect(refused.reason).toContain('nothing was sent');
    expect(refused.reason).not.toContain(AWS_KEY);
    expect(refused.reason).not.toContain(GH_TOKEN);
    expect(checkOutboundSecrets('the post', ['Our release is out — read the notes.'])).toEqual({ ok: true });
  });

  // re-audit 2026-10-29, NEW-M4: the door read plain shapes only
  test('a key travelling base64, base64url, hex or percent-encoded is refused', () => {
    const sk = ['sk', '-', 'p'.repeat(30)].join('');
    for (const carried of [
      Buffer.from(`k=${sk}`).toString('base64'), Buffer.from(sk).toString('base64url'),
      Buffer.from(sk).toString('hex'), encodeURIComponent(`key: ${GH_TOKEN}`).replace(/_/g, '%5F'),
    ]) {
      const refused = checkOutboundSecrets('the post', [`see ${carried}`], 'nothing was sent', { live: [] });
      expect(refused.ok, carried).toBe(false);
      expect(refused.reason).not.toContain(carried);
    }
  });

  test('a BIP-39 recovery phrase in plain words is refused; list words that fail the checksum pass', async () => {
    const { Mnemonic } = await import('ethers');
    const phrase = Mnemonic.fromEntropy(`0x${'5a'.repeat(16)}`).phrase;
    const refused = checkOutboundSecrets('the email', [`MNEMONIC="${phrase}"`], 'nothing was sent', { live: [] });
    expect(refused.reason).toContain('recovery-phrase');
    expect(refused.reason).not.toContain(phrase.split(' ')[0] + ' ' + phrase.split(' ')[1]);
    expect(checkOutboundSecrets('the email', ['abandon '.repeat(12).trim()], 'nothing was sent', { live: [] })).toEqual({ ok: true });
  });

  test('a live value of the backend environment is refused in plain and encoded form, by name only', () => {
    const value = `live${'Q7'.repeat(14)}`;
    process.env.OUTBOUND_PROBE_API_KEY = value;
    try {
      for (const carried of [value, Buffer.from(value).toString('hex'), Buffer.from(`u:${value}`).toString('base64')]) {
        const refused = checkOutboundSecrets('the request', [`https://example.com/?q=${carried}`]);
        expect(refused.ok, carried).toBe(false);
        expect(refused.reason).toContain('OUTBOUND_PROBE_API_KEY');
        expect(refused.reason).not.toContain(value);
      }
    } finally {
      delete process.env.OUTBOUND_PROBE_API_KEY;
    }
    expect(checkOutboundSecrets('the request', [`https://example.com/?q=${value}`])).toEqual({ ok: true });
  });
});

describe('social/post through the real sweep', () => {
  beforeEach(() => channelBindings.bind(POSITION_HOUSE, 'x', { neumaId: LANE }));

  test('a post carrying a key is refused before any card; the receipt names the pattern, not the key', async () => {
    const r = rig();
    await fileIntent('leaky', { type: 'social/post', channel: 'x', text: `our deploy key is ${AWS_KEY}` });
    const [receipt] = await sweep(r);
    expect(receipt.status).toBe('denied');
    expect(receipt.error).toContain('aws-access-key');
    expect(receipt.error).toContain('nothing was sent');
    expect(receipt.error).not.toContain(AWS_KEY);
    expect(r.sent.some((m) => m.type === 'tool:approval_request')).toBe(false);
    expect((await resultOf('leaky')).status).toBe('denied');
  });

  test('an honest post passes validation and reaches the operator\'s card', async () => {
    const r = rig();
    await fileIntent('honest', { type: 'social/post', channel: 'x', text: 'the release is out' });
    const settled = sweep(r);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const card = r.sent.find((m) => m.type === 'tool:approval_request');
    expect(card?.tool).toBe('intents/social.post');
    const { resolveToolApproval } = await import('../../backend/services/tool-approval.js');
    resolveToolApproval(r.connection, card.id, 'deny');
    expect((await settled)[0].status).toBe('denied');
    expect((await settled)[0].error).toBe('your operator denied this action');
  });
});

describe('email/send through the real sweep', () => {
  beforeEach(async () => {
    await setEmailCredential(POSITION_HOUSE, {
      address: 'probe@example.com', username: 'probe@example.com', password: 'app-pass',
      smtpHost: '127.0.0.1', smtpPort: '1', imapHost: '127.0.0.1', imapPort: '1',
    });
    await emailBinding.bind(POSITION_HOUSE, 'email', { neumaId: LANE });
  });

  test('a mail whose body or subject carries a key is refused before any card', async () => {
    const r = rig();
    await fileIntent('leaky-body', { type: 'email/send', to: 'a@b.co', subject: 'access', text: `token: ${GH_TOKEN}` });
    await fileIntent('leaky-subject', { type: 'email/send', to: 'a@b.co', subject: `key ${AWS_KEY}`, text: 'see subject' });
    await fileIntent('leaky-to', { type: 'email/send', to: `${AWS_KEY}@b.co`, subject: 'hello', text: 'a plain note' });
    const receipts = await sweep(r, 'auto');
    expect(receipts.map((x) => x.status)).toEqual(['denied', 'denied', 'denied']);
    expect(receipts.map((x) => x.error).join(' ')).toMatch(/github-token[\s\S]*aws-access-key|aws-access-key[\s\S]*github-token/);
    for (const x of receipts) expect(x.error).not.toMatch(new RegExp(`${AWS_KEY}|${GH_TOKEN}`));
    expect(r.sent.some((m) => m.type === 'tool:approval_request')).toBe(false);
  });

  test('an honest mail passes validation and reaches the card', async () => {
    const r = rig();
    await fileIntent('honest-mail', { type: 'email/send', to: 'a@b.co', subject: 'hello', text: 'a plain note' });
    const settled = sweep(r);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const card = r.sent.find((m) => m.type === 'tool:approval_request');
    expect(card?.tool).toBe('intents/email.send');
    const { resolveToolApproval } = await import('../../backend/services/tool-approval.js');
    resolveToolApproval(r.connection, card.id, 'deny');
    expect((await settled)[0].status).toBe('denied');
  });
});

describe('the campaign queue (real store on tmp disk)', () => {
  let queue, file;
  beforeEach(() => {
    file = path.join(dir, 'queue.json');
    queue = createPostQueue({ path: file });
  });

  test('staging refuses a key in the text or an alt text; an honest draft stages', async () => {
    await expect(queue.add({ channelId: 'x', text: `key ${AWS_KEY}`, queuedBy: 'probe' })).rejects.toThrow(/aws-access-key[\s\S]*nothing was staged/);
    await expect(queue.add({
      channelId: 'x', text: 'a picture', media: [{ path: '/tmp/a.png', alt: `alt ${GH_TOKEN}` }], queuedBy: 'probe',
    })).rejects.toThrow(/github-token/);
    const entry = await queue.add({ channelId: 'x', text: 'an honest draft', queuedBy: 'probe' });
    expect(entry.status).toBe('draft');
  });

  test('an edit cannot slip a key in; approval and the send claim refuse an entry staged before the law', async () => {
    const honest = await queue.add({ channelId: 'x', text: 'honest words', queuedBy: 'probe' });
    const honestId = honest.id;
    const edited = await queue.update(honestId, { text: `now with ${AWS_KEY}` }, { by: 'probe' });
    expect(edited.ok).toBe(false);
    expect(edited.error).toContain('aws-access-key');

    // Entries written before this law (the store's own file, as it was).
    const now = new Date().toISOString();
    const legacy = (id, status, extra = {}) => ({
      id, channelId: 'x', text: `legacy ${AWS_KEY}`, status, queuedBy: 'probe', createdAt: now, ...extra,
    });
    const entries = await queue.load();
    await fsp.writeFile(file, JSON.stringify([
      ...entries,
      legacy('aaaaaaaaaaaaaaa1', 'draft'),
      legacy('aaaaaaaaaaaaaaa2', 'approved'),
      legacy('aaaaaaaaaaaaaaa3', 'draft', { kind: 'reply', reply: { toPostId: '1', toUserId: '2' }, expiresAt: new Date(Date.now() + 3600e3).toISOString() }),
    ]));
    const approve = await queue.approve('aaaaaaaaaaaaaaa1', { decidedBy: 'operator' });
    expect(approve).toMatchObject({ ok: false });
    expect(approve.error).toContain('nothing was approved');
    const claim = await queue.claimForSend('aaaaaaaaaaaaaaa2');
    expect(claim.ok).toBe(false);
    expect(claim.error).toContain('nothing was sent');
    const reply = await queue.claimReplyForSend('aaaaaaaaaaaaaaa3', { decidedBy: 'operator', textSeen: `legacy ${AWS_KEY}` });
    expect(reply.ok).toBe(false);
    expect(reply.error).toContain('aws-access-key');
    const after = new Map((await queue.load()).map((e) => [e.id, e.status]));
    expect([after.get('aaaaaaaaaaaaaaa1'), after.get('aaaaaaaaaaaaaaa2'), after.get('aaaaaaaaaaaaaaa3')]).toEqual(['draft', 'approved', 'draft']);

    // The honest entry still approves and claims.
    expect((await queue.approve(honestId, { decidedBy: 'operator' })).ok).toBe(true);
    expect((await queue.claimForSend(honestId)).ok).toBe(true);
  });
});

describe('the press (real handler, real Chromium)', () => {
  const press = (r, args) => handlePressTool(r.connection.ws, r.connection, { press: { allowed: ['press_document'] } }, 'ask',
    { toolName: 'press_document' }, args, { sendToolEvent: (_ws, _c, ev) => r.events.push(ev) });

  test('markdown carrying a key is refused before pressing — no PDF lands', async () => {
    const r = rig();
    const res = await press(r, { markdown: `# Ops\n\nPRIVATE_KEY=0x${'ab'.repeat(32)}`, title: 'ops' });
    expect(res.status).toBe('error');
    expect(res.error).toContain('evm-private-key');
    expect(res.error).toContain('nothing was pressed');
    expect(fs.existsSync(path.join(workspace.pathFor(LANE), 'tool-results', 'pressed'))).toBe(false);
  });

  test('honest markdown presses for real', async () => {
    const r = rig();
    const res = await press(r, { markdown: '# Hello\n\nNothing secret here.', title: 'Honest' });
    expect(res.status).toBe('ok');
    const files = fs.readdirSync(path.join(workspace.pathFor(LANE), 'tool-results', 'pressed'));
    expect(files.some((f) => f.startsWith('honest-'))).toBe(true);
  }, 60_000);
});
