/** PR600 P6-56/P6-131 — real lanes, real symlinks, real report and worksheet files. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { reportFileName, saveResearchReport } from '../../backend/services/research-mode.js';
import { scaffoldCloWorkspace } from '../../backend/services/legal/clo-scaffold.js';
import { journalOpinion, opinionNameFor } from '../../backend/services/legal/opinion-journal.js';
import { writeLegalOpinion } from '../../backend/services/intents/legal-opinion-act.js';
import { saveWorksheet, mirrorPath } from '../../backend/services/company-line/worksheet-store.js';
import { companyPath } from '../../backend/services/company-line/company-store.js';
import { useTempRealm } from '../helpers/temp-realm.js';

useTempRealm();

const REPORT = '# Coffee report\n\nPrices rose.';
const WALLET = `0x${'a'.repeat(40)}`;
const COMPANY = 'c-content1-abc123';
const researchConnection = () => ({ _research: { phase: 'written', sources: ['https://example.com/source'], searches: new Set(['coffee']) } });
const entryFor = (laneId) => ({
  id: 'lm_content123', externalId: 'build:content', title: 'Content matter', area: 'product', severity: 'low',
  assessedAt: '2026-11-17T12:00:00.000Z', assessedBy: laneId,
});
const verdictFor = (laneId) => ({ assessedBy: laneId, status: 'no_issue', assessment: 'No issue found in this fixture.' });

let root;
let ground;
let previousRoot;

beforeEach(async () => {
  previousRoot = getWorkspacesRoot();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-content-walls-'));
  ground = path.join(root, 'ground');
  await fs.mkdir(ground);
  setWorkspacesRoot(path.join(root, 'workspaces'));
});

afterEach(async () => {
  setWorkspacesRoot(previousRoot);
  await fs.rm(root, { recursive: true, force: true });
});

describe('research report containment', () => {
  test('a valid report lands in the lane with its sources', async () => {
    const laneId = 'researcher';
    await workspace.create(laneId);
    const saved = await saveResearchReport(researchConnection(), REPORT, workspace.pathFor(laneId));
    const text = await fs.readFile(path.join(workspace.pathFor(laneId), saved.file), 'utf8');
    expect(text).toContain(REPORT);
    expect(text).toContain('1. https://example.com/source');
  });

  test('a research-directory symlink is refused and nothing lands outside', async () => {
    const laneId = 'research-link';
    await workspace.create(laneId);
    const outside = path.join(root, 'outside');
    await fs.mkdir(outside);
    await fs.symlink(outside, path.join(workspace.pathFor(laneId), 'research'));
    await expect(saveResearchReport(researchConnection(), REPORT, workspace.pathFor(laneId))).rejects.toThrow(/escapes|symbolic link/);
    expect(await fs.readdir(outside)).toEqual([]);
  });

  test('a report-leaf symlink is refused without changing its outside target', async () => {
    const laneId = 'research-leaf-link';
    await workspace.create(laneId);
    const directory = path.join(workspace.pathFor(laneId), 'research');
    await fs.mkdir(directory);
    const outside = path.join(root, 'outside-report.md');
    await fs.writeFile(outside, 'keep me');
    await fs.symlink(outside, path.join(directory, reportFileName(REPORT)));
    await expect(saveResearchReport(researchConnection(), REPORT, workspace.pathFor(laneId))).rejects.toThrow(/regular file|symbolic link/);
    expect(await fs.readFile(outside, 'utf8')).toBe('keep me');
  });
});

describe('legal report containment', () => {
  test('the CLO scaffold is idempotent and two real journal verdicts append in the drawer', async () => {
    const laneId = 'praetor-content';
    const first = await scaffoldCloWorkspace(laneId);
    expect(first.seeded).toEqual(['charter.md', 'register.md']);
    expect((await scaffoldCloWorkspace(laneId)).seeded).toEqual([]);
    const entry = entryFor(laneId);
    const file = await journalOpinion({ entry, verdict: verdictFor(laneId) });
    expect(await journalOpinion({ entry, verdict: verdictFor(laneId) })).toBe(file);
    const text = await fs.readFile(file, 'utf8');
    expect(text.match(/# Opinion — build:content/g)).toHaveLength(1);
    expect(text.match(/No issue found in this fixture/g)).toHaveLength(2);
    expect(path.basename(file)).toBe(opinionNameFor(entry, entry.assessedAt));
  });

  test('legal parent symlinks fail closed; the fail-soft journal still writes nothing outside', async () => {
    const scaffoldOutside = path.join(root, 'scaffold-outside');
    await fs.mkdir(scaffoldOutside);
    await workspace.create('bad-scaffold');
    await fs.symlink(scaffoldOutside, path.join(workspace.pathFor('bad-scaffold'), 'legal'));
    await expect(scaffoldCloWorkspace('bad-scaffold')).rejects.toThrow(/escapes|symbolic link/);
    expect(await fs.readdir(scaffoldOutside)).toEqual([]);

    const journalOutside = path.join(root, 'journal-outside');
    await fs.mkdir(journalOutside);
    await workspace.create('bad-journal');
    await fs.mkdir(path.join(workspace.pathFor('bad-journal'), 'legal'));
    await fs.symlink(journalOutside, path.join(workspace.pathFor('bad-journal'), 'legal', 'opinions'));
    expect(await journalOpinion({ entry: entryFor('bad-journal'), verdict: verdictFor('bad-journal') })).toBeNull();
    expect(await fs.readdir(journalOutside)).toEqual([]);
  });

  test('the actual legal-opinion writer creates exclusively and refuses a planted opinions link', async () => {
    await workspace.create('opinion-writer');
    await writeLegalOpinion({ laneId: 'opinion-writer', name: 'opinion.md', text: '# Opinion\n' });
    expect(await fs.readFile(path.join(workspace.pathFor('opinion-writer'), 'legal', 'opinions', 'opinion.md'), 'utf8')).toBe('# Opinion\n');
    await expect(writeLegalOpinion({ laneId: 'opinion-writer', name: 'opinion.md', text: 'replacement' })).rejects.toMatchObject({ code: 'EEXIST' });

    const outside = path.join(root, 'opinion-outside');
    await fs.mkdir(outside);
    await workspace.create('bad-opinion');
    await fs.mkdir(path.join(workspace.pathFor('bad-opinion'), 'legal'));
    await fs.symlink(outside, path.join(workspace.pathFor('bad-opinion'), 'legal', 'opinions'));
    await expect(writeLegalOpinion({ laneId: 'bad-opinion', name: 'opinion.md', text: 'escape' })).rejects.toThrow(/escapes|symbolic link/);
    expect(await fs.readdir(outside)).toEqual([]);
  });
});

describe('worksheet mirror containment', () => {
  const worksheet = { candidates: [{ name: 'Real gap' }] };

  test('a valid hand-on writes the true copy and the ground mirror', async () => {
    await saveWorksheet({ wallet: WALLET, companyId: COMPANY, stage: 'survey', round: 1, worksheet, groundRoot: ground });
    const trueCopy = JSON.parse(await fs.readFile(companyPath(WALLET, COMPANY, path.join('worksheets', 'survey-r1.json')), 'utf8'));
    const mirror = JSON.parse(await fs.readFile(path.join(ground, mirrorPath(COMPANY, 'survey', 1)), 'utf8'));
    expect(trueCopy).toEqual(worksheet);
    expect(mirror).toEqual(worksheet);
  });

  test('a company-directory symlink cannot carry the mirror outside the ground', async () => {
    const outside = path.join(root, 'worksheet-outside');
    await fs.mkdir(outside);
    await fs.mkdir(path.join(ground, 'repos'));
    await fs.symlink(outside, path.join(ground, 'repos', COMPANY));
    await expect(saveWorksheet({ wallet: WALLET, companyId: COMPANY, stage: 'survey', round: 1, worksheet, groundRoot: ground }))
      .rejects.toThrow(/escapes|symbolic link/);
    expect(await fs.readdir(outside)).toEqual([]);
  });

  test('a worksheet-leaf symlink is refused without replacing its outside target', async () => {
    const directory = path.join(ground, 'repos', COMPANY, 'line');
    await fs.mkdir(directory, { recursive: true });
    const outside = path.join(root, 'outside-worksheet.json');
    await fs.writeFile(outside, '{"keep":true}');
    await fs.symlink(outside, path.join(directory, 'survey-r1.json'));
    await expect(saveWorksheet({ wallet: WALLET, companyId: COMPANY, stage: 'survey', round: 1, worksheet, groundRoot: ground }))
      .rejects.toThrow(/regular file|symbolic link/);
    expect(await fs.readFile(outside, 'utf8')).toBe('{"keep":true}');
  });
});
