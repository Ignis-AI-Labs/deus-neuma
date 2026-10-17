/**
 * THE SERVER LOG GENERATIONS (#506) — proven on a real filesystem (RULE 0):
 * real temp dirs, real renames, real pruning. Five overnight SIGABRTs kept
 * only the final crash's log; the rotation now preserves every generation.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rotateServerLog, SERVER_LOG_GENERATIONS } from '../../backend/services/server-log-rotation.js';

let dir, logFile;
beforeEach(async () => {
  dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'server-log-rotation-'));
  logFile = path.join(dir, 'llama-server.log');
});
afterEach(async () => {
  await fs.promises.rm(dir, { recursive: true, force: true });
});

const generationFiles = () => fs.readdirSync(dir)
  .filter((name) => name.startsWith('llama-server.log.') && name !== 'llama-server.log.prev')
  .sort();
const stamp = (iso) => () => new Date(iso);

describe('rotateServerLog', () => {
  it('a first boot with no log and no history rotates nothing and never throws', () => {
    expect(() => rotateServerLog(logFile)).not.toThrow();
    expect(fs.existsSync(logFile)).toBe(false);
    expect(fs.existsSync(`${logFile}.prev`)).toBe(false);
    expect(generationFiles()).toEqual([]);
  });

  it('the live log becomes .prev — every existing "last words" pointer stays true', () => {
    fs.writeFileSync(logFile, 'first boot words');
    rotateServerLog(logFile, { at: stamp('2026-09-13T01:00:00.000Z') });
    expect(fs.readFileSync(`${logFile}.prev`, 'utf8')).toBe('first boot words');
    expect(fs.existsSync(logFile)).toBe(false);
    expect(generationFiles()).toEqual([]);
  });

  it('a second rotation preserves the crash BEFORE it as a timestamped generation', () => {
    fs.writeFileSync(logFile, 'crash one');
    rotateServerLog(logFile, { at: stamp('2026-09-13T01:00:00.000Z') });
    fs.writeFileSync(logFile, 'crash two');
    rotateServerLog(logFile, { at: stamp('2026-09-13T02:00:00.000Z') });
    expect(fs.readFileSync(`${logFile}.prev`, 'utf8')).toBe('crash two');
    const generations = generationFiles();
    // A generation is stamped when it LEAVES .prev — the second rotation's time.
    expect(generations).toEqual(['llama-server.log.2026-09-13T02-00-00-000Z']);
    expect(fs.readFileSync(path.join(dir, generations[0]), 'utf8')).toBe('crash one');
  });

  it('five crashes keep five generations — the overnight failure shape, answered', () => {
    for (let i = 1; i <= 5; i += 1) {
      fs.writeFileSync(logFile, `crash ${i}`);
      rotateServerLog(logFile, { at: stamp(`2026-09-13T0${i}:00:00.000Z`) });
    }
    expect(fs.readFileSync(`${logFile}.prev`, 'utf8')).toBe('crash 5');
    const kept = generationFiles().map((name) => fs.readFileSync(path.join(dir, name), 'utf8'));
    expect(kept).toEqual(['crash 1', 'crash 2', 'crash 3', 'crash 4']);
  });

  it('the ring is bounded — the oldest generations prune past the keep count', () => {
    for (let i = 1; i <= 12; i += 1) {
      fs.writeFileSync(logFile, `boot ${i}`);
      rotateServerLog(logFile, { at: stamp(`2026-09-13T${String(i).padStart(2, '0')}:30:00.000Z`) });
    }
    const generations = generationFiles();
    expect(generations).toHaveLength(SERVER_LOG_GENERATIONS);
    // Eleven generations stood (boots 1–11, stamped at the NEXT rotation);
    // the oldest three pruned, so boot 4 through boot 11 survive.
    const kept = generations.map((name) => fs.readFileSync(path.join(dir, name), 'utf8'));
    expect(kept).toEqual(['boot 4', 'boot 5', 'boot 6', 'boot 7', 'boot 8', 'boot 9', 'boot 10', 'boot 11']);
    expect(fs.readFileSync(`${logFile}.prev`, 'utf8')).toBe('boot 12');
  });

  it('an explicit small keep is honored', () => {
    for (let i = 1; i <= 5; i += 1) {
      fs.writeFileSync(logFile, `gen ${i}`);
      rotateServerLog(logFile, { keep: 2, at: stamp(`2026-09-14T0${i}:00:00.000Z`) });
    }
    const kept = generationFiles().map((name) => fs.readFileSync(path.join(dir, name), 'utf8'));
    expect(kept).toEqual(['gen 3', 'gen 4']);
  });
});
