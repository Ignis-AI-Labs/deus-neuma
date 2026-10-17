// capacity-context-map.test.js — the saved scan reaches the neuma's context map.
//
// Proves the whole surfacing chain with no mock: a real capacity result on real
// disk → readLatestCapacity → formatSubstrateForPrompt → the real prompt
// assembler's SUBSTRATE section. This is guardrail 5 made concrete: a neuma
// reflecting on the machine it moves through finds its rig's parallel ceiling in
// the hardware part of its context map.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import { createTempDir } from '../helpers/temp-fs.js';
import { writeCapacity, readLatestCapacity, readUsableCapacity } from '../../backend/services/capacity-store.js';
import { formatSubstrateForPrompt } from '../../backend/services/substrate-detector.js';
import { assemblePromptSections } from '../../core/index.js';

const PROFILE = {
  cpu: { model: 'Threadripper', cores: 32, arch: 'x64' },
  gpu: { name: 'RTX PRO 6000 Blackwell', vramGB: 96 },
  memory: { totalGB: 256 },
  platform: { os: 'linux', version: '#1', hostname: 'ignis' },
  llm: { provider: 'lm-studio', model: 'qwen3.5-122b-a10b', endpoint: 'http://localhost:1234' },
};

const capacityResult = (ceiling, boundClass, runAt) => ({
  ceiling, limitedBy: 'throughput', incomplete: false,
  aggregateTokPerSecAtCeiling: 51, perAgentLatencyAtCeiling: 2641,
  boundClass, vramFitEstimate: null, rawSamples: [],
  substrate: { model: 'qwen3.5-122b-a10b', provider: 'lm-studio', endpoint: 'e', gpu: null, vramGB: 96, memoryGB: 256 },
  runAt, consent: { by: '0xeli', at: runAt },
});

let dir;
beforeEach(async () => { dir = await createTempDir('capacity-ctx'); process.env.NEUMA_CAPACITY_PATH = dir; });
afterEach(async () => { delete process.env.NEUMA_CAPACITY_PATH; await fs.rm(dir, { recursive: true, force: true }); });

const substrateSectionOf = (substrateString) => {
  const sections = assemblePromptSections({ substrate: substrateString });
  return sections.find((s) => s.id === 'substrate') || null;
};

describe('capacity surfaces into the neuma context map (real store → real assembler)', () => {
  it('a saved scan appears in the assembled SUBSTRATE section', async () => {
    await writeCapacity(capacityResult(3, 'A', '2026-07-04T14:59:35.211Z'));
    const capacity = await readLatestCapacity();

    const substrateString = formatSubstrateForPrompt(PROFILE, capacity);
    const section = substrateSectionOf(substrateString);

    expect(section).not.toBeNull();
    expect(section.label).toBe('SUBSTRATE');
    // The hardware is there…
    expect(section.text).toContain('RTX PRO 6000 Blackwell');
    // …and so is the measured parallel ceiling the being can now reason about.
    expect(section.text).toContain('about 3 of you working in parallel');
    expect(section.text).toContain('measured 2026-07-04');
  });

  it('before any scan, the SUBSTRATE section carries no fabricated capacity', async () => {
    const capacity = await readLatestCapacity(); // null — nothing written yet
    const section = substrateSectionOf(formatSubstrateForPrompt(PROFILE, capacity));
    expect(section.text).toContain('RTX PRO 6000 Blackwell'); // hardware still present
    expect(section.text).not.toContain('Parallel capacity'); // honest silence
  });

  it('a fresh scan overrides the neuma context with the newest measurement', async () => {
    await writeCapacity(capacityResult(1, 'B', '2026-07-01T00:00:00.000Z'));
    await writeCapacity(capacityResult(3, 'A', '2026-07-04T00:00:00.000Z'));
    const capacity = await readLatestCapacity();
    const section = substrateSectionOf(formatSubstrateForPrompt(PROFILE, capacity));
    expect(section.text).toContain('about 3 of you working in parallel');
    expect(section.text).not.toContain('1 of you at a time'); // the stale B run is not what it reads
  });

  // 2026-10-13: a scan wider than the server serves told every being […] on a 4-slot server, so a lead planned teams the line never ran.
  it('a ceiling wider than the served slots reaches the being clamped (the turn reads readUsableCapacity)', async () => {
    await writeCapacity(capacityResult(6, 'A', '2026-09-09T15:41:15.759Z'));
    const section = substrateSectionOf(formatSubstrateForPrompt(PROFILE, await readUsableCapacity()));
    expect(section.text).toContain('about 4 of you working in parallel');
    expect(section.text).not.toContain('about 6 of you');
  });
});
