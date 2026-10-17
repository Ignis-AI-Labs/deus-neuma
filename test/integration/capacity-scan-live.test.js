/**
 * Capacity scan — LIVE (RULE 0 gnosis for the real fire path).
 *
 * fireCapacityProbes sends GENUINE concurrent completions through
 * createStreamRequest to the real local substrate; the scan-owned drain loop
 * reads the real wire, counts real tokens, and the ceiling comes out of real
 * wall-clock measurements. Nothing on the claimed path is mocked.
 *
 * The ladder here is deliberately tiny ([1, 2] × 2 repeats): the claim under
 * proof is that the REAL path measures — the full ratified ladder is what an
 * operator's consented scan runs, and proving the wire does not require
 * minutes of deliberate load on a rig a living neuma may be using (NFR-3).
 *
 * Skips honestly when LM Studio is not running or nothing is loaded.
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import { createTempDir } from '../helpers/temp-fs.js';
import { setConfig, testConnection } from '../../backend/services/llm-provider.js';
import { runCapacityScan, fireCapacityProbes } from '../../backend/services/capacity-scan.js';
import { writeCapacity, readLatestCapacity } from '../../backend/services/capacity-store.js';
import { probeLiveSubstrate } from '../helpers/live-substrate.js';

// Endpoint-up is not enough — a substrate with nothing LOADED answers 400 on
// every turn. The skip must be as honest as the test; the probe speaks both
// serving shapes (llama-server under the serving law, or LM Studio).
const live = await probeLiveSubstrate();

describe.skipIf(!live)('capacity scan — live substrate', () => {
  it('measures a real ceiling from real concurrent inference and persists it (AC-1/2/9)', async () => {
    // llama-server takes the 'local-model' sentinel: the machine provider is what
    // the serving law keys on, and the server streams whatever it loaded — the
    // real model identity rides the route/record, not this config field.
    setConfig({ provider: live.provider, endpoint: live.endpoint, model: live.provider === 'llama-server' ? 'local-model' : live.model });
    const dir = await createTempDir('capacity-live');
    process.env.NEUMA_CAPACITY_PATH = dir;

    try {
      const runAt = new Date().toISOString();
      const result = await runCapacityScan({
        ladder: [1, 2],
        repeats: 2,
        substrate: { model: live.model, provider: live.provider, endpoint: live.endpoint, gpu: null, vramGB: null, memoryGB: null },
        runAt,
        consent: { by: '0xlive-test', at: runAt },
      });

      // AC-1: a real ceiling with real provenance.
      expect(result.ceiling).toBeGreaterThanOrEqual(1);
      expect(result.rawSamples.length).toBeGreaterThanOrEqual(1);
      for (const sample of result.rawSamples) {
        expect(sample.aggregateTokPerSec).toBeGreaterThan(0); // real tokens really flowed
        expect(sample.perAgentLatencyMs).toBeGreaterThan(0);
        expect(sample.tokenSource).toBe('whitespace-proxy');
      }
      expect(['A', 'B', 'C']).toContain(result.boundClass);
      expect(result.runAt).toBe(runAt);

      // AC-2: the record round-trips through the real store, provenance intact.
      const id = await writeCapacity(result);
      expect(id).toBeTruthy();
      const back = await readLatestCapacity();
      expect(back.ceiling).toBe(result.ceiling);
      expect(back.rawSamples.length).toBe(result.rawSamples.length);

      // AC-9: the substrate answers normally after the scan — no leaked load.
      expect(await testConnection()).toBe(true);
      const wave = await fireCapacityProbes(1, { prompt: 'Say the word ready.', maxTokens: 8, temperature: 0 });
      expect(wave.ok).toBe(true);
    } finally {
      delete process.env.NEUMA_CAPACITY_PATH;
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 180_000);
});
