/**
 * RAM OFFLOAD, on the real engine (docs/work/ram-offload.md): the spilled launch rests on one
 * property of llama.cpp's own placement — told to leave `--fit-target` MiB free on the card, the
 * layers it keeps there hold no more than the card's free memory less that margin, and the rest
 * goes to system RAM. Proven with llama-fit-params (no allocation: the card is only measured), the
 * house build, a real T4 build and a simulated 12 GB card. Live: it needs the engine and the model
 * on this machine's disk (LLAMA_FIT_PARAMS, RAM_SPILL_MODEL).
 */
import { describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import process from 'node:process';

const BIN = process.env.LLAMA_FIT_PARAMS || '/opt/llama.cpp-pr31669/build-cuda/bin/llama-fit-params';
const MODEL = process.env.RAM_SPILL_MODEL || '/mnt/data/neuma/wsp/ladder/Qwen3.8-27B-Neuma-T4-IQ4_XS.gguf';
const CARD_MIB = 12 * 1024;
const CTX = 32_768;

const run = (args) => execFileSync(BIN, ['-m', MODEL, '-c', String(CTX), '--parallel', '6', ...args], { encoding: 'utf8', timeout: 300_000, stdio: ['ignore', 'pipe', 'ignore'] });
const freeMiB = () => Number(execFileSync('nvidia-smi', ['--query-gpu=memory.free', '--format=csv,noheader,nounits'], { encoding: 'utf8' }).split('\n')[0].trim());
const rows = (stdout) => Object.fromEntries(stdout.trim().split('\n').map((l) => l.trim().split(/\s+/))
  .filter((c) => c.length === 4 && c.slice(1).every((v) => Number.isFinite(Number(v))))
  .map(([dev, ...mib]) => [dev, mib.reduce((a, v) => a + Number(v), 0)]));

describe('llama.cpp places a spilled model inside the margin it is given', () => {
  test('a simulated 12 GB card: the fitted layers keep the card part under it, the rest is in RAM', () => {
    const target = freeMiB() - CARD_MIB;
    const fitted = run(['--fit', 'on', '--fit-target', String(target), '--fit-ctx', String(CTX)]);
    const ngl = Number(/-ngl (\d+)/.exec(fitted)?.[1]);
    expect(Number.isInteger(ngl) && ngl > 0).toBe(true);

    const whole = rows(run(['-ngl', '999', '--fit', 'off', '--fit-print', 'on']));
    const placed = rows(run(['-ngl', String(ngl), '--fit', 'off', '--fit-print', 'on']));
    expect(whole.CUDA0).toBeGreaterThan(CARD_MIB); // it does not fit whole: the case spilling exists for
    expect(placed.CUDA0).toBeLessThanOrEqual(CARD_MIB); // the card part keeps to the margin
    expect(placed.Host).toBeGreaterThan(1_024); // the rest lives in system RAM
    expect(placed.CUDA0 + placed.Host).toBeGreaterThanOrEqual(whole.CUDA0 * 0.95); // nothing went missing
  }, 600_000);
});
