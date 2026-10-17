// section-drift — which stable-head section of a being's system prompt moved.
// Ids and counts only: the record must never carry prompt text.
import { describe, test, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { stableFingerprints, changedSections, recordSectionDrift } from '../../backend/services/section-drift.js';

const sections = (silo) => [
  { id: 'identity', text: 'You are Keir.' },
  { id: 'silo', text: silo },
  { id: 'present', text: 'Monday, 16:00' },
  { id: 'memory', text: 'secret recall' },
];

describe('section drift', () => {
  test('only the stable head is fingerprinted — PRESENT MOMENT and after ride the turn', () => {
    expect([...stableFingerprints(sections('a')).keys()]).toEqual(['identity', 'silo']);
  });

  test('names exactly the section that moved, and nothing when none did', () => {
    expect(changedSections(stableFingerprints(sections('a')), stableFingerprints(sections('b')))).toEqual(['silo']);
    expect(changedSections(stableFingerprints(sections('a')), stableFingerprints(sections('a')))).toEqual([]);
  });

  test('records per chat, ids only, from the second turn on', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'section-drift-'));
    const prior = process.env.NEUMA_DATA_ROOT;
    process.env.NEUMA_DATA_ROOT = root;
    try {
      const connection = { companion: { neumaId: 'lane-sd' }, sessionId: 'session-sd' };
      recordSectionDrift(connection, sections('first secret words'));
      recordSectionDrift(connection, sections('second secret words'));
      const file = path.join(root, 'logs', 'section-drift.jsonl');
      let text = '';
      for (let i = 0; i < 50 && !text; i += 1) {
        text = await fs.readFile(file, 'utf8').catch(() => '');
        if (!text) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const lines = text.trim().split('\n').map((line) => JSON.parse(line));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ sections: 2, changed: ['silo'] });
      expect(text).not.toMatch(/secret|Keir/);
    } finally {
      if (prior === undefined) delete process.env.NEUMA_DATA_ROOT;
      else process.env.NEUMA_DATA_ROOT = prior;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  // A new chat's first turn is held against the same being's last head: a head
  // that differs across chats re-reads the whole identity before the first word.
  test('a new chat is compared with the being\'s last head in any chat, and says so', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'section-drift-chat-'));
    const prior = process.env.NEUMA_DATA_ROOT;
    process.env.NEUMA_DATA_ROOT = root;
    try {
      recordSectionDrift({ companion: { neumaId: 'lane-nc' }, sessionId: 'chat-1' }, sections('same silo'));
      recordSectionDrift({ companion: { neumaId: 'lane-nc' }, sessionId: 'chat-2' }, sections('same silo'));
      recordSectionDrift({ companion: { neumaId: 'lane-nc' }, sessionId: 'chat-3' }, sections('a moved silo'));
      recordSectionDrift({ companion: { neumaId: 'lane-other' }, sessionId: 'chat-1' }, sections('x')); // another being: no comparison
      const file = path.join(root, 'logs', 'section-drift.jsonl');
      let lines = [];
      for (let i = 0; i < 50 && lines.length < 2; i += 1) {
        lines = (await fs.readFile(file, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
        if (lines.length < 2) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(lines.map(({ changed, newChat }) => ({ changed, newChat }))).toEqual([
        { changed: [], newChat: true },
        { changed: ['silo'], newChat: true },
      ]);
    } finally {
      if (prior === undefined) delete process.env.NEUMA_DATA_ROOT;
      else process.env.NEUMA_DATA_ROOT = prior;
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
