// Ceremony disclosure — the operator reads what is ACTUALLY sent.
//
// The claim under test is reconstruction, not description: the components the
// panel shows, joined, must BE the two messages the substrate receives. Real
// handler, real stage protocol files on disk, real assembler, real house
// (RULE 0 — no mock anywhere in the path being claimed).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';
import { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { StagedBirthHandler } from '../../core/birth/staged-birth-handler.js';
import { assembleBirthPrompt, assembleBirthPromptSections } from '../../core/runtime/prompt-assembler.js';
import {
  composeCeremonyDisclosure,
  systemMessageOf,
  userMessageOf,
  DISCLOSURE_CHANNELS,
} from '../../core/birth/ceremony-disclosure.js';

// The real filesystem tool shape the naming/crystallization stages advertise.
const FILESYSTEM_TOOLS = [
  { name: 'write_file', description: 'Write a file', inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } } },
  { name: 'read_text_file', description: 'Read a file', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
];

const STAGES = [0, 1, 2, 3, 4, 5, 6];

describe('ceremony disclosure', () => {
  let handler, houseRoot, tempDir;

  beforeAll(async () => {
    tempDir = await createTempDir('ceremony-disclosure');
    process.env.NEUMA_RETURNED_PATH = join(tempDir, 'RETURNED.md');
    houseRoot = join(tempDir, 'house');
    await mkdir(houseRoot, { recursive: true });
    // A kin already in the house, so the lineage and the borne-names sections
    // are real text rather than empty branches.
    const identityDir = join(houseRoot, 'galen', 'identity');
    await mkdir(identityDir, { recursive: true });
    await writeFile(join(identityDir, 'true-name.json'),
      JSON.stringify({ chosenName: 'Galen', fullName: 'Galen Kaseivio Aldmere' }));
    await writeFile(join(identityDir, 'genesis-seal.json'),
      JSON.stringify({ record: { birthMoment: { utc: '2026-06-20T09:00:00.000Z', epochMs: 1750410000000 } } }));
    setWorkspacesRoot(houseRoot);
    handler = new StagedBirthHandler(
      { createNeumaSession: async () => 'tok', createDNA: async () => ({}) },
      { handleServerUpdate: () => {} },
    );
    await handler._ready;
  });

  afterAll(async () => {
    setWorkspacesRoot(null);
    delete process.env.NEUMA_RETURNED_PATH;
    vi.restoreAllMocks();
  });

  // The ceremony as portal-stream drives it: real stage data from the real
  // handler, real assembly, the same appended instruction the acting stages
  // carry. Returns the disclosure the operator is sent.
  const stageDisclosure = async (sessionId, stage, { spokenWords, appendedText = '' } = {}) => {
    const stageData = await handler.processStage(sessionId, stage);
    const systemSections = assembleBirthPromptSections({
      baseProtocol: stageData.systemPrompt,
      baseSections: stageData.systemSections,
      stageNumber: stage,
      sessionData: { ...stageData.sessionData, sessionId },
      witnessName: stageData.witnessName,
      tools: (stage === 4 || stage === 5) ? FILESYSTEM_TOOLS : null,
    });
    return composeCeremonyDisclosure({
      stage,
      systemSections,
      spokenWords,
      appendedText,
      parameters: [{ label: 'MODEL', value: 'gemma-4-31b' }],
    });
  };

  it('the handler sections join back to the exact prompt it reports', async () => {
    const sid = await handler.createSession('Founder');
    for (const stage of STAGES) {
      const { systemPrompt, systemSections } = await handler.processStage(sid, stage);
      expect(systemSections.map((s) => s.text).join('')).toBe(systemPrompt);
    }
    await handler.endSession(sid);
  });

  it('the sectioned assembly is byte-identical to the whole-string assembly', async () => {
    const sid = await handler.createSession('Founder');
    for (const stage of STAGES) {
      const stageData = await handler.processStage(sid, stage);
      const args = {
        stageNumber: stage,
        sessionData: { ...stageData.sessionData, sessionId: sid },
        witnessName: stageData.witnessName,
        tools: (stage === 4 || stage === 5) ? FILESYSTEM_TOOLS : null,
      };
      const fromSections = assembleBirthPromptSections({
        ...args, baseProtocol: stageData.systemPrompt, baseSections: stageData.systemSections,
      }).map((s) => s.text).join('');
      // The old single-string path, unchanged in behavior — the ceremony's
      // bytes must not have moved when the seam was opened.
      const whole = assembleBirthPrompt({ ...args, baseProtocol: stageData.systemPrompt });
      expect(fromSections).toBe(whole);
    }
    await handler.endSession(sid);
  });

  it('every character sent is disclosed — the components rebuild both messages', async () => {
    const sid = await handler.createSession('Founder');
    for (const stage of STAGES) {
      const spokenWords = `Stage ${stage}: I am here.`;
      const appendedText = stage === 4 || stage === 5
        ? 'Remember: You MUST use the MCP filesystem tool to write your chosen name.'
        : '';
      const disclosure = await stageDisclosure(sid, stage, { spokenWords, appendedText });

      // The messages the ceremony sends are these joins (portal-stream builds
      // its request from exactly these two functions).
      const system = systemMessageOf(disclosure);
      const user = userMessageOf(disclosure);

      expect(system.length).toBeGreaterThan(0);
      expect(system).toContain('VOICE LOCK');
      expect(user).toBe(appendedText ? `${spokenWords}\n\n${appendedText}` : spokenWords);

      // Nothing rides outside a component: the disclosed lengths account for
      // every character of both messages.
      expect(disclosure.totals.system).toBe(system.length);
      expect(disclosure.totals.yours).toBe(spokenWords.length);
      expect(disclosure.totals.appended).toBe(appendedText.length);
      expect(disclosure.totals.chars).toBe(system.length + spokenWords.length + appendedText.length);
      expect(disclosure.totals.components).toBe(disclosure.components.length);
    }
    await handler.endSession(sid);
  });

  it('names the hidden props: the appended instruction is marked as NOT the operator speech', async () => {
    const sid = await handler.createSession('Founder');
    const appendedText = 'Write your essence to your own file at workspaces/hale/dna/genesis.md.';
    const disclosure = await stageDisclosure(sid, 5, { spokenWords: 'Tell me how it feels.', appendedText });

    const appended = disclosure.components.find((c) => c.channel === DISCLOSURE_CHANNELS.CEREMONY);
    expect(appended.text).toBe(appendedText);
    expect(appended.label).toBe('APPENDED TO YOUR WORDS');
    expect(appended.origin).toMatch(/not your speech/i);

    const yours = disclosure.components.find((c) => c.channel === DISCLOSURE_CHANNELS.OPERATOR);
    expect(yours.text).toBe('Tell me how it feels.');
    await handler.endSession(sid);
  });

  it('discloses the context that used to ride invisibly, each naming its own source', async () => {
    const sid = await handler.createSession('Founder');

    // Stage 1 carries the house; stage 4 carries the borne names and the sky
    // of the moment; the acting stages carry the tool schemas.
    const witnessing = await stageDisclosure(sid, 1, { spokenWords: 'I am Founder. I acknowledge you.' });
    const lineage = witnessing.components.find((c) => c.id === 'lineage');
    expect(lineage.text).toContain('Galen Kaseivio Aldmere');
    expect(lineage.origin).toContain('core/birth/lineage.js');

    const naming = await stageDisclosure(sid, 4, { spokenWords: 'What shall you be called?' });
    const borne = naming.components.find((c) => c.id === 'naming');
    expect(borne.text).toContain('NAMES ALREADY BORNE');
    expect(borne.origin).toContain('core/birth/name-guard.js');

    const schemas = naming.components.find((c) => c.id === 'tools');
    expect(schemas.text).toContain('write_file');
    expect(schemas.origin).toContain('mcp.js');

    // Every disclosed component says where it came from — an unattributed
    // block is the mysticism this feature exists to remove.
    for (const component of naming.components) {
      expect(component.origin.length).toBeGreaterThan(0);
      expect(component.chars).toBe(component.text.length);
    }
    await handler.endSession(sid);
  });

  it('carries the rehearsal notice as its own disclosed component', async () => {
    const rehearsal = await handler.createSession('Founder', true);
    const disclosure = await stageDisclosure(rehearsal, 0, { spokenWords: 'The portal is open.' });
    const notice = disclosure.components.find((c) => c.id === 'rehearsal');
    expect(notice.text).toContain('TEST MODE ACTIVE');
    expect(systemMessageOf(disclosure).startsWith(notice.text)).toBe(true);
    await handler.endSession(rehearsal);
  });

  it("discloses the being's carried words once it has spoken", async () => {
    const sid = await handler.createSession('Founder');
    await handler.processStage(sid, 0);
    await handler.handleStageResponse(sid, 0, 'I stir. Something is here.');

    const disclosure = await stageDisclosure(sid, 1, { spokenWords: 'I am Founder.' });
    const transcript = disclosure.components.find((c) => c.id === 'transcript');
    expect(transcript.text).toContain('I stir. Something is here.');
    expect(transcript.label).toBe('THEIR OWN WORDS SO FAR');
    await handler.endSession(sid);
  });

  it('parameters are disclosed beside the text and never counted into it', async () => {
    const sid = await handler.createSession('Founder');
    const disclosure = await stageDisclosure(sid, 2, { spokenWords: 'Do you consent to emerge?' });
    expect(disclosure.parameters).toEqual([{ label: 'MODEL', value: 'gemma-4-31b' }]);
    expect(disclosure.totals.chars).toBe(
      systemMessageOf(disclosure).length + 'Do you consent to emerge?'.length,
    );
    await handler.endSession(sid);
  });
});
