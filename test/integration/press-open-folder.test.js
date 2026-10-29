// THE PRESS in the open folder (RULE 0): the real handler, the real act gate,
// the real legal kit copied from docs/legal/press-kit, the real Chromium print
// pipeline, real files on a real temp folder. The ws is a plain stand-in at the
// transport edge (the pattern doc-press-being-tools.test.js carries).
// Design note, 2026-10-28: beings must […] — read
// the document where it lives, press it with the kit beside it, and set the
// PDF where the work is; nowhere else, never a secret path.
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { handlePressTool } from '../../backend/services/doc-press/press-being-tools.js';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const ENV = ['WORKSPACES_ROOT', 'NEUMA_BRAND_KITS_DIR', 'NEUMA_CHROMIUM_PATH'];
const saved = {};
let dir;
let openFolder;

const rigFor = () => {
  const sent = [];
  const events = [];
  const ws = { readyState: 1, OPEN: 1, send: (s) => sent.push(JSON.parse(s)) };
  const connection = { ws, companion: { name: 'clo', neumaId: 'presslegal' }, activeTurn: null, toolWorkspace: openFolder };
  return { sent, events, connection, ports: { sendToolEvent: (_ws, _c, ev) => events.push(ev) } };
};
// AUTO: the press is approval-tier, so AUTO lets it through with no card
const press = (rig, args) => handlePressTool(rig.connection.ws, rig.connection, null, 'auto', { toolName: 'press_document' }, args, rig.ports);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'press-open-folder-'));
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.WORKSPACES_ROOT = path.join(dir, 'workspaces');
  openFolder = path.join(dir, 'repo');
  fs.mkdirSync(path.join(openFolder, 'docs', 'legal', 'pdf'), { recursive: true });
  fs.mkdirSync(path.join(openFolder, '.git'), { recursive: true });
  fs.cpSync(path.join(REPO, 'docs', 'legal', 'press-kit'), path.join(openFolder, 'docs', 'legal', 'press-kit'), { recursive: true });
  fs.writeFileSync(path.join(openFolder, 'docs', 'legal', 'PRIVACY_NOTICE.md'), '# Privacy Notice\n\nWhat we keep, and why.\n');
  fs.mkdirSync(path.join(dir, 'elsewhere'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'elsewhere', 'outside.md'), '# outside\n');
});

afterEach(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('the press, working in the open folder', () => {
  test('presses a file with the kit beside it, straight into the folder — and asks nothing on AUTO', async () => {
    const rig = rigFor();
    const outputPath = path.join(openFolder, 'docs', 'legal', 'pdf', 'PRIVACY_NOTICE.pdf');
    const res = await press(rig, {
      markdownPath: path.join(openFolder, 'docs', 'legal', 'PRIVACY_NOTICE.md'),
      kit: 'ignis-legal',
      kitsDir: path.join(openFolder, 'docs', 'legal', 'press-kit'),
      outputPath,
    });
    expect(res.status, res.error).toBe('ok');
    expect(res.content).toContain('"ignis-legal" kit');
    expect(res.content).toContain(fs.realpathSync(path.dirname(outputPath)));
    expect(fs.readFileSync(outputPath).subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(rig.sent.some((m) => m.type === 'tool:approval_request')).toBe(false);
  }, 120_000);

  test('a PDF that would land outside the open folder or the being\'s workspace is refused, nothing written', async () => {
    const rig = rigFor();
    const outside = path.join(dir, 'elsewhere', 'leak.pdf');
    const res = await press(rig, { markdown: '# x\n', outputPath: outside });
    expect(res.status).toBe('error');
    expect(res.error).toMatch(/not open to the press/);
    expect(fs.existsSync(outside)).toBe(false);
  });

  test('secret-shaped places are refused even inside the open folder: .git, a key', async () => {
    const rig = rigFor();
    const intoGit = await press(rig, { markdown: '# x\n', outputPath: path.join(openFolder, '.git', 'hooks.pdf') });
    expect(intoGit.status).toBe('error');
    expect(fs.existsSync(path.join(openFolder, '.git', 'hooks.pdf'))).toBe(false);
    const keyRead = await press(rig, { markdownPath: path.join(openFolder, '.git', 'config.md') });
    expect(keyRead.status).toBe('error');
  });

  test('a PDF never lands in a lane\'s platform state, even its own (C-01, audit 2026-10-28)', async () => {
    const rig = rigFor();
    const ownConfig = path.join(process.env.WORKSPACES_ROOT, 'presslegal', 'config', 'notes.pdf');
    const res = await press(rig, { markdown: '# x\n', outputPath: ownConfig });
    expect(res.status).toBe('error');
    expect(res.error).toMatch(/platform state/);
    expect(fs.existsSync(ownConfig)).toBe(false);
  });

  test('a source outside both places, or a relative path, is refused before anything is read', async () => {
    const rig = rigFor();
    const away = await press(rig, { markdownPath: path.join(dir, 'elsewhere', 'outside.md') });
    expect(away.status).toBe('error');
    expect(away.error).toMatch(/not open to the press/);
    const relative = await press(rig, { markdownPath: 'docs/legal/PRIVACY_NOTICE.md' });
    expect(relative.status).toBe('error');
    expect(relative.error).toMatch(/absolute path/);
  });
});
