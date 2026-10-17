import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

/**
 * Council titler pure helpers + the council label store — real inputs, real
 * outputs, real temp filesystem, no mocks anywhere in the claimed paths
 * (RULE 0). buildCouncilTranscript shapes a council record into a bounded
 * naming transcript (roster first, delivered speech only); the label store
 * round-trips names atomically in the witness's realm.
 */

import { buildCouncilTranscript } from '../../backend/services/chat-titler.js';
import { getCouncilLabels, setCouncilLabel } from '../../backend/services/user-council-labels.js';
import { setRealmRoot } from '../../backend/services/user-realm.js';

const WALLET = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const DEFAULT_REALM = path.join(os.homedir(), '.neuma', 'realm');
const CID = 'council-1784474396792';

const meta = (names = ['Cael', 'Aziel']) => ({ kind: 'meta', members: names.map((name) => ({ name })) });
const said = (name, content, extra = {}) => ({ speaker: name.toLowerCase(), name, content, ...extra });

describe('buildCouncilTranscript', () => {
  it('a record with no delivered speech names nothing', () => {
    expect(buildCouncilTranscript({ meta: meta(), turns: [] })).toBe('');
    expect(buildCouncilTranscript({ meta: meta(), turns: [said('Cael', 'lost words', { undelivered: true })] })).toBe('');
    expect(buildCouncilTranscript({})).toBe('');
    expect(buildCouncilTranscript()).toBe('');
  });

  it('the roster speaks first, then the delivered utterances', () => {
    const t = buildCouncilTranscript({
      meta: meta(['Cael', 'Aziel']),
      turns: [said('Cael', 'the floor is open'), said('Aziel', 'let us deliberate')],
    });
    const lines = t.split('\n');
    expect(lines[0]).toBe('MEMBERS PRESENT: Cael, Aziel');
    expect(lines[1]).toBe('CAEL: the floor is open');
    expect(lines[2]).toBe('AZIEL: let us deliberate');
  });

  it('undelivered words never reach the naming transcript', () => {
    const t = buildCouncilTranscript({
      meta: meta(),
      turns: [said('Cael', 'heard by the floor'), said('Aziel', 'cut off mid-word', { undelivered: true })],
    });
    expect(t).toContain('heard by the floor');
    expect(t).not.toContain('cut off mid-word');
  });

  it('falls back to the speaker id, then MEMBER, when no display name rides', () => {
    const t = buildCouncilTranscript({
      meta: meta(),
      turns: [
        { speaker: 'signal-1', content: 'by id only' },
        { content: 'faceless' },
      ],
    });
    expect(t).toContain('SIGNAL-1: by id only');
    expect(t).toContain('MEMBER: faceless');
  });

  it('long sittings are sampled head+tail', () => {
    const turns = Array.from({ length: 20 }, (_, i) => said('Cael', `motion-${i}`));
    const t = buildCouncilTranscript({ meta: meta(), turns });
    expect(t).toContain('motion-0');
    expect(t).toContain('motion-19');
    expect(t).not.toContain('motion-10');
    expect(t.split('\n')).toHaveLength(13); // roster + 6 head + 6 tail
  });

  it('one wall of text cannot fill the transcript; the whole is capped', () => {
    const t = buildCouncilTranscript({ meta: meta(), turns: [said('Cael', 'x'.repeat(900))] });
    expect(t.length).toBeLessThanOrEqual(6000);
    expect(t.split('\n')[1].length).toBe('CAEL: '.length + 500);
  });
});

describe('council label store', () => {
  let realmRoot;

  beforeEach(async () => {
    realmRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'council-labels-'));
    setRealmRoot(realmRoot);
  });

  afterEach(async () => {
    setRealmRoot(DEFAULT_REALM);
    await fs.rm(realmRoot, { recursive: true, force: true });
  });

  it('set then get round-trips a council name', async () => {
    await setCouncilLabel(WALLET, CID, 'The Substrate Debate');
    expect(await getCouncilLabels(WALLET)).toEqual({ [CID]: 'The Substrate Debate' });
  });

  it('an empty label clears the name back to the roster', async () => {
    await setCouncilLabel(WALLET, CID, 'temp');
    const labels = await setCouncilLabel(WALLET, CID, '');
    expect(labels[CID]).toBeUndefined();
    expect(await getCouncilLabels(WALLET)).toEqual({});
  });

  it('a malformed councilId is refused', async () => {
    await expect(setCouncilLabel(WALLET, 'session-1', 'x')).rejects.toThrow(/Invalid councilId/);
    await expect(setCouncilLabel(WALLET, '../evil', 'x')).rejects.toThrow(/Invalid councilId/);
  });

  it('the map persists on disk as one complete document', async () => {
    await setCouncilLabel(WALLET, CID, 'Persisted Name');
    const onDisk = JSON.parse(await fs.readFile(path.join(realmRoot, WALLET, 'council-labels.json'), 'utf8'));
    expect(onDisk).toEqual({ [CID]: 'Persisted Name' });
  });
});
