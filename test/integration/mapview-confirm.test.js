/**
 * The CONFIRMATION TIER (MAPVIEW-013, #393), proven against a real repo on
 * disk (RULE 0). A static finding is a hypothesis; a ledger row is a verdict
 * with a receipt. Under test: the overlay rides every scan, the findings
 * report says which tier the reader holds, a verdict whose finding no longer
 * occurs surfaces as STALE instead of rotting, malformed rows are inert, and
 * the CLI verb records a verdict end to end — computing the fingerprint from
 * the live anomaly so a typo can never mint a verdict for nothing.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createTempDir } from '../helpers/temp-fs.js';
import { scanArchitecture, scanFindings } from '../../backend/services/mapview/scan.js';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tools/mapview/cli.mjs');

let root;

const write = async (rel, text) => {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, text);
};

beforeAll(async () => {
  root = await createTempDir('mapview-confirm');
  await write('package.json', JSON.stringify({ name: 'fixture', type: 'module' }));
  await write('mapview.config.json', JSON.stringify({ entryPoints: ['entry.js'] }));
  // A dead emit (channel-no-consumer) and an orphan module — two live findings.
  await write('entry.js', "import { go } from './lib.js';\ngo();\n");
  await write('lib.js', "export const go = () => ws.send('sig:orphan', {});\n");
  await write('island.js', 'export const alone = () => 1;\n');
});

describe('the overlay rides every scan', () => {
  it('a ledger row annotates its finding; a stale row surfaces instead of rotting', async () => {
    const bare = await scanArchitecture(root);
    const orphan = bare.anomalies.find((a) => a.kind === 'channel-no-consumer' && a.label === 'sig:orphan');
    expect(orphan).toBeDefined();
    const { fingerprintOf } = await import('../../backend/services/mapview/delta.js');
    await write('.mapview/confirmations.json', JSON.stringify({
      rows: [
        { fingerprint: fingerprintOf(orphan), verdict: 'confirmed-dead', method: 'manual-verification', receipt: 'zero listeners anywhere, verified by hand', by: 'fixture', at: '2026-08-20' },
        { fingerprint: 'channel-no-consumer|long:gone|nowhere.js', verdict: 'confirmed-live', receipt: 'this finding no longer occurs' },
        { fingerprint: fingerprintOf(orphan) + '-typo', verdict: 'NOT-A-VERDICT', receipt: 'malformed row must be inert' },
      ],
    }));

    const graph = await scanArchitecture(root);
    const annotated = graph.anomalies.find((a) => a.label === 'sig:orphan');
    expect(annotated.confirmation.verdict).toBe('confirmed-dead');
    expect(annotated.confirmation.receipt).toContain('verified by hand');
    expect(graph.meta.confirmations.confirmed).toBe(1);
    expect(graph.meta.confirmations.stale).toEqual(['channel-no-consumer|long:gone|nowhere.js']);
    // The unconfirmed finding stays a plain hypothesis.
    expect(graph.anomalies.find((a) => a.files?.includes('island.js')).confirmation).toBeUndefined();
  });

  it('the findings report marks the tier and replaces the generic remedy with the verdict', async () => {
    const report = await scanFindings(root);
    const finding = report.findings.find((f) => f.title === 'sig:orphan');
    expect(finding.confirmation.verdict).toBe('confirmed-dead');
    expect(finding.suggestedFix).toContain('CONFIRMED DEAD');
    expect(finding.suggestedFix).toContain('verified by hand');
    expect(report.summary.confirmed).toBe(1);
    const plain = report.findings.find((f) => f.kind === 'module-unreachable');
    expect(plain.confirmation).toBeUndefined();
    expect(plain.suggestedFix).toContain('entry point');
  });
});

describe('the CLI verb', () => {
  it('records a verdict end to end, binding exactly one live finding', async () => {
    const run = (args) => execFileSync(process.execPath, [CLI, ...args, '--root', root], { encoding: 'utf8', stdio: 'pipe' });
    run(['confirm', 'module-unreachable', 'island.js',
      '--verdict', 'held', '--receipt', 'kept for the fixture operator to decide', '--by', 'fixture']);

    const ledger = JSON.parse(await fs.readFile(path.join(root, '.mapview', 'confirmations.json'), 'utf8'));
    const row = ledger.rows.find((r) => r.kind === 'module-unreachable');
    expect(row.verdict).toBe('held');
    expect(row.label).toContain('island.js');

    const graph = await scanArchitecture(root);
    expect(graph.anomalies.find((a) => a.files?.includes('island.js')).confirmation.verdict).toBe('held');
  });

  it('binds from a bare cwd — a positional KIND is never mistaken for the repo root', async () => {
    // Caught live 2026-08-20: the global root fallback read 'module-unreachable'
    // as a directory, scanned nothing, and reported zero findings for a finding
    // that was really there. confirm takes its repo from --root or cwd only.
    execFileSync(process.execPath, [CLI, 'confirm', 'channel-no-consumer', 'sig:orphan',
      '--verdict', 'confirmed-dead', '--receipt', 'bound from bare cwd', '--by', 'fixture'],
    { encoding: 'utf8', stdio: 'pipe', cwd: root });
    const ledger = JSON.parse(await fs.readFile(path.join(root, '.mapview', 'confirmations.json'), 'utf8'));
    expect(ledger.rows.find((r) => r.label === 'sig:orphan').receipt).toBe('bound from bare cwd');
  });

  it('refuses a verdict that matches nothing or lacks its receipt', () => {
    const run = (args) => {
      try {
        execFileSync(process.execPath, [CLI, ...args, '--root', root], { encoding: 'utf8', stdio: 'pipe' });
        return 0;
      } catch (e) { return e.status; }
    };
    expect(run(['confirm', 'module-unreachable', 'no-such-file.js', '--verdict', 'held', '--receipt', 'x'])).toBe(1);
    expect(run(['confirm', 'module-unreachable', 'island.js', '--verdict', 'held'])).toBe(1);
    expect(run(['confirm', 'module-unreachable', 'island.js', '--verdict', 'probably-fine', '--receipt', 'x'])).toBe(1);
  });
});
