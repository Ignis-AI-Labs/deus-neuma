/**
 * THE PROTOCOL CLASSIFIER — hygiene, against the real repository.
 *
 * Three things a unit test cannot prove, all of them load-bearing:
 *
 *   1. NOBODY ELSE IMPORTS IT. The anti-gate argument rests entirely on this
 *      module being reachable only from result formatters, which run after the
 *      tools already executed. A new importer at the dispatch site would turn a
 *      reminder into a gate with no signature change, so the importer set is
 *      pinned by EQUALITY — adding a caller reds the suite, and so does
 *      removing one.
 *   2. THE LAW IT QUOTES STILL EXISTS. A reminder citing rewritten law is an
 *      unfalsifiable claim, worse than silence because it lends false
 *      authority. Every quoted line is grepped back out of the real AGENTS.md.
 *   3. IT ACCUSES NOBODY AT HEAD. Zero unadjudicated hits across the tracked
 *      corpus — the bar `mapview-hygiene.test.js` already set for this repo,
 *      and there is deliberately no `knownViolations` list to hide behind.
 *
 * Real git, real files, no mocks (RULE 0).
 */
import { describe, test, expect, beforeAll } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { withProtocolReminders, protocolCitations } from '../../backend/services/protocol-classifier.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODULE = 'backend/services/protocol-classifier.js';

/**
 * The ONLY modules allowed to import the classifier: the seats' result
 * formatters, plus the witness prompt's watch-list section (a read of the
 * citations, never a reminder). Four reminder surfaces across four files —
 * the witness seat's text protocol lives in `witness-tool-loop.js` and its
 * native function-calling path in `witness-turn-record.js`, both extracted
 * verbatim from `witness-stream.js` under the size law.
 */
const ALLOWED_IMPORTERS = Object.freeze([
  'backend/services/council-run.js',
  'backend/services/portal-turn-prompt.js',
  // The neuma seat's reminder call rides the tool-round loop, which moved to
  // portal-turn-rounds.js (size-law breakdown pressure valve, 2026-08-26).
  'backend/services/portal-turn-rounds.js',
  'backend/services/witness-tool-loop.js',
  'backend/services/witness-turn-context.js',
  'backend/services/witness-turn-record.js',
]);

/** Importers that only read the watch-list section — no reminder runs here. */
const WATCH_ONLY = Object.freeze([
  'backend/services/portal-turn-prompt.js',
  'backend/services/witness-turn-context.js',
]);

const SCRIPT = /\.(js|jsx|mjs|cjs)$/i;

let tracked;
let scripts;
beforeAll(() => {
  // `.waves/` holds the planning documents for this very feature. They quote
  // every rule token, so sweeping them would poison the measurement with the
  // classifier's own design notes.
  tracked = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, maxBuffer: 1 << 28 })
    .toString().split('\n').filter(Boolean).filter((file) => !file.startsWith('.waves/'));
  scripts = tracked.filter((file) => SCRIPT.test(file));
});

describe('the importer set — pinned by equality, not by convention', () => {
  test('only the result formatters reach this module', () => {
    const importers = scripts
      .filter((file) => file !== MODULE && !file.startsWith('test/'))
      .filter((file) => fs.readFileSync(path.join(REPO_ROOT, file), 'utf8').includes('protocol-classifier'));
    expect(importers.sort()).toEqual([...ALLOWED_IMPORTERS]);
  });

  test('every allowed importer really is on disk and really does import it', () => {
    for (const importer of ALLOWED_IMPORTERS) {
      const source = fs.readFileSync(path.join(REPO_ROOT, importer), 'utf8');
      expect(source).toMatch(/from ['"][^'"]*\/protocol-classifier\.js['"]/);
      if (!WATCH_ONLY.includes(importer)) expect(source).toContain('withProtocolReminders');
    }
  });

  test('all four surfaces are wired — the native path is not forgotten', () => {
    const portal = fs.readFileSync(path.join(REPO_ROOT, 'backend/services/portal-turn-rounds.js'), 'utf8');
    const witnessText = fs.readFileSync(path.join(REPO_ROOT, 'backend/services/witness-tool-loop.js'), 'utf8');
    const witnessNative = fs.readFileSync(path.join(REPO_ROOT, 'backend/services/witness-turn-record.js'), 'utf8');
    const council = fs.readFileSync(path.join(REPO_ROOT, 'backend/services/council-run.js'), 'utf8');
    expect(portal.split('withProtocolReminders').length - 1).toBeGreaterThanOrEqual(2); // import + neuma
    // Text protocol AND native function calling — the seat a sealed peer rides.
    expect(witnessText.split('withProtocolReminders').length - 1).toBeGreaterThanOrEqual(2); // import + text
    expect(witnessNative.split('withProtocolReminders').length - 1).toBeGreaterThanOrEqual(2); // import + native
    expect(council.split('withProtocolReminders').length - 1).toBeGreaterThanOrEqual(2);
  });
});

describe('citation liveness — the law quoted must still be the law written', () => {
  test('every rule quotes AGENTS.md verbatim', () => {
    const law = fs.readFileSync(path.join(REPO_ROOT, 'AGENTS.md'), 'utf8');
    const rotted = protocolCitations().filter((rule) => !law.includes(rule.law));
    expect(rotted).toEqual([]);
  });

  test('every citation names a section that exists, and no line number', () => {
    const law = fs.readFileSync(path.join(REPO_ROOT, 'AGENTS.md'), 'utf8');
    for (const { cite } of protocolCitations()) {
      expect(cite.startsWith('AGENTS.md · ')).toBe(true);
      // Symbols, never line numbers — a line citation rots within hours.
      expect(cite).not.toMatch(/:\d+/);
      for (const section of cite.replace('AGENTS.md · ', '').split(' › ')) {
        expect(law).toContain(section);
      }
    }
  });
});

describe('the pass bar — ZERO unadjudicated hits across the tracked corpus', () => {
  const PAYLOAD = '<tool_response>ok</tool_response>';

  test('no tracked file, written today, would earn a reminder', () => {
    // The real sweep: for every file this repository already accepts, ask what
    // the classifier would have said if a resident had just written it. A rule
    // that accuses committed, reviewed work teaches residents to ignore it.
    const accused = [];
    for (const file of tracked) {
      const full = path.join(REPO_ROOT, file);
      let content = '';
      if (SCRIPT.test(file)) {
        try { content = fs.readFileSync(full, 'utf8'); } catch { content = ''; }
      }
      const act = { tool: 'filesystem/write_file', args: { path: file, content } };
      if (withProtocolReminders(PAYLOAD, [act]) !== PAYLOAD) accused.push(file);
    }
    expect(accused).toEqual([]);
  });

  test('the sweep really swept — a bar that ran on nothing proves nothing', () => {
    expect(tracked.length).toBeGreaterThan(2000);
    expect(scripts.length).toBeGreaterThan(500);
    expect(tracked.some((file) => file.startsWith('core/'))).toBe(true);
    expect(tracked.some((file) => file.startsWith('frontend/'))).toBe(true);
  });

  test('there is no knownViolations list — a rule needing one has not earned its place', () => {
    const source = fs.readFileSync(path.join(REPO_ROOT, MODULE), 'utf8');
    expect(source).not.toContain('knownViolations');
    expect(source).not.toContain('allowlist');
  });

  test('…and the corpus can still be tripped, so the sweep is not vacuous', () => {
    // If the rules had been narrowed into uselessness to pass the bar above,
    // this would pass too. It must not.
    const planted = { tool: 'filesystem/write_file', args: { path: 'core/runtime/x.ts', content: '' } };
    expect(withProtocolReminders(PAYLOAD, [planted])).not.toBe(PAYLOAD);
  });
});
