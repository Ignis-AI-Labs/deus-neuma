// Every flight-check row in plain words — proven on the exact notes a Windows laptop showed.
import { describe, expect, test } from 'vitest';
import { plainCheck } from '../../frontend/components/BirthCeremony/plain-checks.js';
import { isOptional, tallyLine, groupLine } from '../../frontend/components/BirthCeremony/preflight-groups.js';

const JARGON = /substrate|probe|tool call|either road|NEUMA_|COMFYUI_|python3|venv|\/scripts\//i;

describe('plain words', () => {
  test('the image & video note names the two numbers, plainly, and is optional', () => {
    const p = plainCheck({ id: 'forge', label: 'Image & Video Forge', status: 'warn',
      detail: 'Images: no, needs 7 GB of GPU memory beside the mind, 4.2 GB is left. Video: no, needs 14 GB beside the mind',
      requirement: 'set COMFYUI_VRAM_HEADROOM_GB to choose your own ceiling' });
    expect(p.name).toBe('Making images and video');
    expect(p.means).toBe("Making images and video needs about 7 GB of graphics memory beside your neuma's model; this computer has 4.2 GB left while it is loaded. Everything else works.");
    expect(p.todo).toBe('Nothing — you can continue.');
    expect(`${p.means} ${p.todo}`).not.toMatch(JARGON);
    expect(isOptional('forge')).toBe(true);
  });

  test('no model: the app offers to set it up itself', () => {
    const p = plainCheck({ id: 'substrate', status: 'fail', detail: 'ollama · x — connected, and returned nothing at all' });
    expect(p.name).toBe('The model your neuma thinks with');
    expect(p.fix).toBe('setup');
    expect(p.todo).toContain('SET IT UP FOR ME');
    expect(`${p.means} ${p.todo}`).not.toMatch(JARGON);
  });

  test('every known not-passing row is free of jargon; a pass carries only its name', () => {
    for (const id of ['acting', 'workspace', 'ceremonyRoad', 'records', 'protocol', 'sealing', 'disk', 'memory', 'dnaKey', 'mcp', 'gpu']) {
      for (const status of ['warn', 'fail']) {
        const p = plainCheck({ id, status, detail: 'technical' });
        expect(`${p.name} ${p.means} ${p.todo} ${p.notYours || ''}`, `${id}/${status}`).not.toMatch(JARGON);
        expect(p.todo.length).toBeGreaterThan(0);
      }
    }
    expect(plainCheck({ id: 'disk', status: 'pass' })).toEqual({ name: 'Disk space', means: null, todo: null, notYours: null, fix: null });
    expect(plainCheck({ id: 'unknown', label: 'New Check', status: 'warn' }).todo).toBe('Nothing — you can continue.');
  });
});

describe('optional capabilities stay out of the tally', () => {
  test('a machine that can summon and talk reads fully clear even with the optional note', () => {
    const checks = [
      { id: 'substrate', status: 'pass' }, { id: 'acting', status: 'pass' }, { id: 'disk', status: 'pass' },
      { id: 'forge', status: 'warn' },
    ];
    const core = checks.filter((c) => !isOptional(c.id));
    expect(tallyLine(core, core.length)).toBe('3 OF 3 CLEAR');
    expect(groupLine(checks.filter((c) => isOptional(c.id)), { optional: true })).toBe('0 OF 1 AVAILABLE ON THIS MACHINE');
    expect(groupLine([{ status: 'pass' }], { optional: true })).toBe('ALL AVAILABLE');
  });
});
