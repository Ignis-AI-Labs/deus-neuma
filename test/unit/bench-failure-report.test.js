// bench-failure-report.test.js — the matched set's copyable FAILURE REPORT:
// the pure builder over the shape a real failed chain carries (the neuma arm
// refused by the harness's test-process gate, 2026-09-25), the tail law, the
// panel's show-the-button law, and the panel rendered for real.

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildFailureReport, tailText } from '../../backend/services/bench/bench-failure-report.js';
import { chainNeedsReport } from '../../frontend/app/RelinkShell/bench-launch-view.js';
import { BenchRunPanel } from '../../frontend/app/RelinkShell/BenchRunPanel.jsx';

const LOG = '/data/benchmarks/launch/2026-09-25T15-05-15-858Z-run-benchmark-neuma.log';
const REFUSAL = '  ✗ Error: test process is already running; benchmark refused:';

const settledChain = (overrides = {}) => ({
  chainId: 'chain-2026-09-25T14-55-47-abcd1234',
  state: 'done',
  cell: 'smoke',
  arms: ['bare', 'platform', 'silo', 'neuma'],
  comparisonId: 'desk-2026-09-25t14-55-47',
  startedAt: '2026-09-25T14:55:47.000Z',
  finishedAt: '2026-09-25T15:06:53.000Z',
  outcomes: [
    { arm: 'bare', ok: true, exitCode: 0, signal: null, durationMs: 142000, logFile: '/x/bare.log' },
    { arm: 'platform', ok: true, exitCode: 0, signal: null, durationMs: 203000, logFile: '/x/platform.log' },
    { arm: 'silo', ok: true, exitCode: 0, signal: null, durationMs: 222000, logFile: '/x/silo.log' },
    { arm: 'neuma', ok: false, exitCode: 1, signal: null, durationMs: 37000, logFile: LOG },
  ],
  ...overrides,
});

describe('buildFailureReport', () => {
  it('names the set, every arm verdict, and carries the failed arm’s log tail verbatim', () => {
    const text = buildFailureReport(settledChain(), { [LOG]: `${REFUSAL}\n    at assertTestProcessesClear` });
    expect(text).toContain('## BENCH FAILURE REPORT — smoke · 1/4 arms failed');
    expect(text).toContain('- comparison: desk-2026-09-25t14-55-47');
    expect(text).toContain('- ✓ BARE MODEL (bare) — clean · 2:22');
    expect(text).toContain('- ✗ FULL BEING (neuma) — exit 1 · 0:37');
    expect(text).toContain(`### ✗ FULL BEING (neuma) — exit 1\nlog: ${LOG}`);
    expect(text).toContain(`\`\`\`text\n${REFUSAL}\n    at assertTestProcessesClear\n\`\`\``);
    // Clean arms never paste their logs — the report is about what broke.
    expect(text).not.toContain('/x/bare.log');
  });

  it('says so plainly when a log could not be read, and carries a chain-level error', () => {
    const text = buildFailureReport(settledChain({ state: 'failed', error: 'EACCES on the log dir' }), {});
    expect(text).toContain('- chain error: EACCES on the log dir');
    expect(text).toContain('(the log could not be read)');
  });

  it('reads a stopped arm by its signal and the rest as skipped', () => {
    const chain = settledChain({
      state: 'stopped',
      outcomes: [
        { arm: 'bare', ok: false, exitCode: null, signal: 'SIGTERM', durationMs: 5000, logFile: LOG },
        { arm: 'platform', skipped: true },
        { arm: 'silo', skipped: true },
        { arm: 'neuma', skipped: true },
      ],
    });
    const text = buildFailureReport(chain, { [LOG]: 'partial' });
    expect(text).toContain('- ✗ BARE MODEL (bare) — stopped by SIGTERM · 0:05');
    expect(text).toContain('- — PLATFORM WIRE (platform) — skipped — never ran');
  });
});

describe('tailText', () => {
  it('strips terminal color and keeps only the last 80 lines', () => {
    const lines = Array.from({ length: 120 }, (_, i) => `line ${i}`);
    lines[119] = '\x1b[31m✗ failed\x1b[0m';
    const tail = tailText(lines.join('\n'));
    expect(tail.split('\n')).toHaveLength(80);
    expect(tail.startsWith('line 40')).toBe(true);
    expect(tail.endsWith('✗ failed')).toBe(true);
  });
});

describe('chainNeedsReport', () => {
  it('owes a report only once settled with an arm not clean, or when the chain failed', () => {
    expect(chainNeedsReport(null)).toBe(false);
    expect(chainNeedsReport(settledChain({ state: 'running' }))).toBe(false);
    expect(chainNeedsReport(settledChain())).toBe(true);
    expect(chainNeedsReport(settledChain({ outcomes: settledChain().outcomes.slice(0, 3) }))).toBe(false);
    expect(chainNeedsReport({ state: 'failed', outcomes: [] })).toBe(true);
  });
});

describe('BenchRunPanel — the COPY FAILURE REPORT act', () => {
  const render = (chainState, reportNote = null) => renderToStaticMarkup(createElement(BenchRunPanel, {
    serving: null, models: [], cell: null, arms: [], ready: false, busy: false,
    chainState, nowMs: Date.parse('2026-09-25T15:10:00Z'), reportNote,
    onPreflight: () => {}, onRun: () => {}, onStop: () => {}, onCopyReport: () => {},
  }));

  it('stands on a settled set with a failed arm, and says what the copy did', () => {
    expect(render(settledChain())).toContain('COPY FAILURE REPORT');
    const noted = render(settledChain(), { ok: true, line: 'REPORT COPIED — PASTE IT WHERE THE REPAIR HAPPENS' });
    expect(noted).toContain('REPORT COPIED');
  });

  it('never stands on a clean set', () => {
    expect(render(settledChain({ outcomes: settledChain().outcomes.slice(0, 3), arms: ['bare', 'platform', 'silo'] })))
      .not.toContain('COPY FAILURE REPORT');
  });
});

describe('parseTestProcesses — the clear-machine probe’s reading', () => {
  it('reads pgrep -af lines into pid + command, capping a long wrapper line', async () => {
    const { parseTestProcesses, TEST_PROCESS_PATTERN } = await import('../../backend/services/bench/bench-machine.js');
    const rows = parseTestProcesses(`197609 timeout 400 npx playwright test x.spec.js\n197636 ${'y'.repeat(300)}\n`);
    expect(rows[0]).toEqual({ pid: 197609, command: 'timeout 400 npx playwright test x.spec.js' });
    expect(rows[1].command).toHaveLength(160);
    expect(rows[1].command.endsWith('…')).toBe(true);
    expect(parseTestProcesses('')).toEqual([]);
    // The harness's pattern, verbatim — the two verdicts must never disagree.
    expect(TEST_PROCESS_PATTERN).toBe('(^|[ /])(vitest|playwright)([ /.]|$)');
  });
});

describe('THIS RUN — the clear-machine notice', () => {
  const render = (machine) => renderToStaticMarkup(createElement(BenchRunPanel, {
    serving: null, machine, models: [], cell: null, arms: [], ready: false, busy: false,
    chainState: null, nowMs: 0, onPreflight: () => {}, onRun: () => {}, onStop: () => {},
  }));

  it('names the test processes standing on the box', async () => {
    const { machineNotice } = await import('../../frontend/app/RelinkShell/bench-launch-view.js');
    const machine = { clear: false, processes: [{ pid: 197609, command: 'npx playwright test test/e2e/bench-launch.spec.js' }] };
    expect(machineNotice(machine).line).toContain('THE MACHINE IS NOT CLEAR — 1 TEST PROCESS RUNNING');
    const html = render(machine);
    expect(html).toContain('THE MACHINE IS NOT CLEAR');
    expect(html).toContain('197609 · npx playwright test test/e2e/bench-launch.spec.js');
  });

  it('stays silent on a proven clear machine, and warns when clear cannot be proven', async () => {
    const { machineNotice } = await import('../../frontend/app/RelinkShell/bench-launch-view.js');
    expect(machineNotice({ clear: true, processes: [] })).toBeNull();
    expect(render({ clear: true, processes: [] })).not.toContain('MACHINE');
    expect(machineNotice(null).line).toContain('CANNOT PROVE THE MACHINE IS CLEAR');
    expect(machineNotice({ clear: null, processes: [], error: 'pgrep missing' }).line).toContain('CANNOT PROVE');
  });
});
