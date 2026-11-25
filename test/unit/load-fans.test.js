// THE FANS FOLLOW THE LOAD (scripts/system/load-fans). Design note, 2026-11-20: […] The service's own curve, run
// as the service runs it (its --plan door: readings in, the fan percent out, one second a line) — no card is touched.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/system/load-fans');
// Each reading: [utilisation %, power W, power limit W, temperature C].
const plan = (readings) => {
  const ran = spawnSync('python3', ['-I', SCRIPT, '--plan'], { input: readings.map((r) => r.join(' ')).join('\n'), encoding: 'utf8' });
  expect(ran.status, ran.stderr).toBe(0);
  return ran.stdout.trim().split('\n').map(Number);
};
const idle = [3, 60, 600, 45];
const times = (n, r) => Array.from({ length: n }, () => r);

describe('the fans follow the load', () => {
  it('idle and cool: the floor. The second a being starts talking the fans are at the load; at full load, at full', () => {
    expect(plan([idle, [78, 395, 600, 50], [100, 590, 600, 55]])).toEqual([30, 78, 100]);
  });

  it('the load is the higher of utilisation and power against the limit', () => {
    expect(plan([[20, 540, 600, 50]])).toEqual([90]); // drawing 90% of its power at low utilisation is 90% load
    expect(plan([[65, 100, 600, 50]])).toEqual([65]);
    expect(plan([[65, 100, 0, 50]])).toEqual([65]); // a card that will not say its power limit: utilisation alone
  });

  it('a hot card is never left with slow fans, whatever the load: full at 85 C', () => {
    expect(plan([[0, 50, 600, 85], [0, 50, 600, 90]])).toEqual([100, 100]);
    const [warm] = plan([[0, 50, 600, 72.5]]);
    expect(warm).toBe(65); // half way from 60 C to 85 C is half way from the floor to full
  });

  it('up at once, down patiently: the fans hold through the gaps between a reply\'s bursts, then ease down', () => {
    const out = plan([[90, 500, 600, 50], ...times(14, idle), [90, 500, 600, 50], ...times(15, idle), ...times(4, idle)]);
    expect(out.slice(0, 16)).toEqual(times(16, 90)); // 14 quiet seconds, then the next burst: never came down
    expect(out.slice(16, 30)).toEqual(times(14, 90)); // quiet again: held for the 15 seconds
    expect(out.slice(30)).toEqual([86, 82, 78, 74, 70]); // then down, four percent a second
  });

  it('on the way down it never passes under what the readings ask for', () => {
    const out = plan([[100, 590, 600, 50], ...times(40, [50, 200, 600, 50])]);
    expect(out.at(-1)).toBe(50);
    expect(Math.min(...out)).toBe(50);
  });
});
