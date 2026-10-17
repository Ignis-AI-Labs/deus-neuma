import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  isPressTool, handlePressTool, pressToolsFor, PRESS_TOOLS,
} from '../../backend/services/doc-press/press-being-tools.js';
import { resolveToolApproval } from '../../backend/services/tool-approval.js';

// The handler runs for real: a real temp workspace root, a real temp brand-kit
// store, the real approval broker, and the real Chromium print pipeline
// (RULE 0). The ws is a plain stand-in at the transport edge — the same
// pattern the email tools carry.

const ENV = ['WORKSPACES_ROOT', 'NEUMA_BRAND_KITS_DIR', 'NEUMA_CHROMIUM_PATH'];
const savedEnv = {};
let dir;

const TINY_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>';

const makeRig = ({ neumaId = 'unitprobe' } = {}) => {
  const sent = [];
  const events = [];
  const ws = { readyState: 1, OPEN: 1, send: (s) => sent.push(JSON.parse(s)) };
  const connection = { ws, companion: { name: 'probe', neumaId }, activeTurn: null };
  const ports = {
    sendToolEvent: (_ws, _c, ev) => events.push(ev),
  };
  return { sent, events, connection, ports };
};

const callPress = (rig, args, { policy = null, mode = 'ask' } = {}) =>
  handlePressTool(rig.connection.ws, rig.connection, policy, mode, { toolName: 'press_document' }, args, rig.ports);

const ALLOW_POLICY = { press: { allowed: ['press_document'] } };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'press-tools-'));
  for (const k of ENV) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  process.env.WORKSPACES_ROOT = dir;
  process.env.NEUMA_BRAND_KITS_DIR = path.join(dir, 'kits');
  fs.mkdirSync(path.join(dir, 'kits', 'acme'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'kits', 'acme', 'kit.json'),
    JSON.stringify({ companyName: 'Acme Corp', logos: { primary: 'logo.svg' } }),
  );
  fs.writeFileSync(path.join(dir, 'kits', 'acme', 'logo.svg'), TINY_SVG);
});

afterEach(() => {
  for (const k of ENV) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('isPressTool (pure)', () => {
  test('accepts every dialect and rejects strangers', () => {
    expect(isPressTool({ toolName: 'press_document' })).toBe(true);
    expect(isPressTool({ toolName: 'press__press_document' })).toBe(true);
    expect(isPressTool({ tool: 'press/press_document' })).toBe(true);
    expect(isPressTool({ toolName: 'send_email' })).toBe(false);
    expect(isPressTool({})).toBe(false);
  });
});

describe('pressToolsFor (catalog)', () => {
  test('no workspace advertises nothing; a being gets the press when Chromium exists', () => {
    expect(pressToolsFor(null)).toEqual([]);
    expect(pressToolsFor('unitprobe')).toEqual([...PRESS_TOOLS]); // this box has Chromium
  });
  test('a machine without Chromium advertises nothing (fail closed)', () => {
    process.env.NEUMA_CHROMIUM_PATH = path.join(dir, 'no-such-chromium');
    expect(pressToolsFor('unitprobe')).toEqual([]);
  });
});

describe('handlePressTool (real press, real workspace)', () => {
  test('observe mode holds the press without an approval chip', async () => {
    const rig = makeRig();
    const res = await callPress(rig, { markdown: '# Held' }, { mode: 'observe' });
    expect(res.status).toBe('denied');
    expect(res.error).toMatch(/observe/);
    expect(rig.sent.some((m) => m.type === 'tool:approval_request')).toBe(false);
  });

  test('allowed policy presses for REAL: PDF lands inside the being\'s own workspace', async () => {
    const rig = makeRig();
    const res = await callPress(
      rig,
      { markdown: '# Hello\n\nPressed from the stream.', title: 'Stream Doc', kit: 'acme' },
      { policy: ALLOW_POLICY },
    );
    expect(res.status).toBe('ok');
    expect(res.content).toMatch(/acme/);
    const pressedDir = path.join(dir, 'unitprobe', 'tool-results', 'pressed');
    const files = fs.readdirSync(pressedDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^stream-doc-\d+\.pdf$/);
    const pdf = fs.readFileSync(path.join(pressedDir, files[0]));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(res.content).toContain(path.join(pressedDir, files[0]));
    expect(rig.events.map((e) => e.status)).toEqual(['executing', 'ok']);
  }, 60_000);

  test('ask mode parks a REAL approval; deny refuses without pressing', async () => {
    const rig = makeRig();
    const pending = callPress(rig, { markdown: '# Ask first' });
    await vi.waitFor(() => {
      expect(rig.sent.some((m) => m.type === 'tool:approval_request')).toBe(true);
    });
    const req = rig.sent.find((m) => m.type === 'tool:approval_request');
    expect(resolveToolApproval(rig.connection, req.id, 'deny')).toBe(true);
    const res = await pending;
    expect(res.status).toBe('denied');
    expect(fs.existsSync(path.join(dir, 'unitprobe', 'tool-results'))).toBe(false);
  });

  test('approval allow resumes into a real press', async () => {
    const rig = makeRig();
    const pending = callPress(rig, { markdown: '# Blessed', title: 'Blessed' });
    await vi.waitFor(() => {
      expect(rig.sent.some((m) => m.type === 'tool:approval_request')).toBe(true);
    });
    const req = rig.sent.find((m) => m.type === 'tool:approval_request');
    expect(resolveToolApproval(rig.connection, req.id, 'allow')).toBe(true);
    const res = await pending;
    expect(res.status).toBe('ok');
    const files = fs.readdirSync(path.join(dir, 'unitprobe', 'tool-results', 'pressed'));
    expect(files.some((f) => f.startsWith('blessed-'))).toBe(true);
  }, 60_000);

  test('missing markdown is refused with honest words, after the gate', async () => {
    const rig = makeRig();
    const res = await callPress(rig, {}, { policy: ALLOW_POLICY });
    expect(res.status).toBe('error');
    expect(res.error).toMatch(/needs \{markdown\}/);
  });

  test('an unknown kit fails with the real kit choices in the answer', async () => {
    const rig = makeRig();
    const res = await callPress(rig, { markdown: '# X', kit: 'nope' }, { policy: ALLOW_POLICY });
    expect(res.status).toBe('error');
    expect(res.error).toMatch(/Available kits: acme/);
  });

  test('no workspace on the connection → unavailable', async () => {
    const rig = makeRig({ neumaId: null });
    const res = await callPress(rig, { markdown: '# X' }, { policy: ALLOW_POLICY });
    expect(res.status).toBe('unavailable');
  });
});
