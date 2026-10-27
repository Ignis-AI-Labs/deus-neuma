/**
 * A threat's text is kept WHOLE (Design note, 2026-10-26: […]). The advisory scan's finding carries OSV's details whole, the REAL ledger
 * on tmp disk keeps them whole, a re-scan fills an entry an older ledger cut, and an issue filed from one still fits
 * GitHub's body limit with the door to the whole text. Nothing mocked (RULE 0).
 */
import { describe, test, expect } from 'vitest';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { createThreatLedger } from '../../backend/services/security/threat-ledger.js';
import { SUMMARY_MAX } from '../../backend/services/security/threat-lifecycle.js';
import { findingFor } from '../../backend/services/security/advisory-scan.js';
import { escalationBody, ISSUE_TEXT_ROOM } from '../../backend/services/security/escalation.js';

// an advisory as long as the long ones GitHub serves: a summary, pages of details, a fenced PoC
const DETAILS = ['### Summary', 'A decompression bomb exhausts the disk.', '', '### Details',
  ...Array.from({ length: 300 }, (_, i) => `Step ${i}: the extractor writes another chunk without a total-bytes bound.`),
  '', '### PoC', '```javascript', "const tar = require('tar');", '```'].join('\n');
const GROUP = { id: 'GHSA-23hp-3jrh-7fpw', modified: null, affected: [{ package: 'tar', version: '6.2.1', shipped: false }] };
const VULN = { id: GROUP.id, summary: 'node-tar: Decompression/parse DoS via unlimited input', details: DETAILS };

describe('a full advisory, kept whole', () => {
  test('the scan\'s finding and the ledger keep every character of the advisory', async () => {
    expect(DETAILS.length).toBeGreaterThan(20_000);
    const finding = findingFor('neuma', GROUP, { vuln: VULN });
    expect(finding.summary).toBe(DETAILS);
    const ledger = createThreatLedger({ path: path.join(await createTempDir('threat-text-whole'), 'threats.json') });
    await ledger.ingest([finding], { scanned: [{ source: 'osv', repo: 'neuma' }] });
    const [entry] = await ledger.load();
    expect(entry.summary).toBe(DETAILS);
    expect(entry.summary.endsWith("const tar = require('tar');\n```")).toBe(true);
  });

  test('an entry an older ledger cut at 2,000 characters is filled whole by the next scan', async () => {
    const ledger = createThreatLedger({ path: path.join(await createTempDir('threat-text-refill'), 'threats.json') });
    const finding = findingFor('neuma', GROUP, { vuln: VULN });
    await ledger.ingest([{ ...finding, summary: DETAILS.slice(0, 2000) }], { scanned: [{ source: 'osv', repo: 'neuma' }] });
    expect((await ledger.load())[0].summary).toHaveLength(2000);
    await ledger.ingest([finding], { scanned: [{ source: 'osv', repo: 'neuma' }] });
    expect((await ledger.load())[0].summary).toBe(DETAILS);
  });

  test('the ceiling only stops a broken feed — far above any advisory', async () => {
    expect(SUMMARY_MAX).toBeGreaterThanOrEqual(DETAILS.length * 2);
    const ledger = createThreatLedger({ path: path.join(await createTempDir('threat-text-ceiling'), 'threats.json') });
    await ledger.ingest([findingFor('neuma', GROUP, { vuln: { ...VULN, details: 'x'.repeat(SUMMARY_MAX * 3) } })], { scanned: [] });
    expect((await ledger.load())[0].summary).toHaveLength(SUMMARY_MAX);
  });
});

describe('an issue filed from a whole advisory', () => {
  const THREAT = { id: 'th_whole0001', source: 'osv', externalId: GROUP.id, severity: 'critical', layer: 'software', repo: 'neuma', title: VULN.summary, affected: GROUP.affected };

  test('an advisory that fits rides the issue whole', () => {
    expect(escalationBody({ ...THREAT, summary: DETAILS })).toContain(DETAILS);
  });

  test('one too long for GitHub carries its head and the door to the whole, under GitHub\'s 65,536', () => {
    const long = 'y'.repeat(SUMMARY_MAX);
    const body = escalationBody({ ...THREAT, summary: long, assessment: 'z'.repeat(4000) });
    expect(body.length).toBeLessThan(65_536);
    expect(body).toContain('y'.repeat(ISSUE_TEXT_ROOM));
    expect(body).toContain('the whole text: https://osv.dev/vulnerability/GHSA-23hp-3jrh-7fpw');
    expect(escalationBody({ ...THREAT, source: 'manual', summary: long })).toContain('the whole text: the security ledger, entry th_whole0001');
  });
});
