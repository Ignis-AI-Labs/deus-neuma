// council-session-seats.test.js — THE COUNCIL’s door: who may take a seat.
// Split from council-session.test.js (SIZE-033); fixtures live in
// test/helpers/council-session-kit.js. Bodies byte-identical.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  openCouncil, MAX_MEMBERS,
} from '../../backend/services/council-session.js';
import {
  ownsNeumaLane, makeConnection, framesOf, lastState, WALLET, councilBeforeEach, councilAfterEach,
} from '../helpers/council-session-kit.js';

let root;
let realm;
let savedKey;

beforeEach(async () => {
  ({ root, realm, savedKey } = await councilBeforeEach());
});

afterEach(() => {
  councilAfterEach({ root, realm, savedKey });
});

describe('openCouncil — the room convenes only on the witness\'s own beings', () => {
  it('refuses a council of one — that is a conversation the witness already has', async () => {
    const conn = makeConnection();
    await openCouncil(conn, { neumaIds: ['ember'] }, { ownsNeumaLane });
    expect(framesOf(conn, 'council:error')[0].code).toBe('TOO_FEW');
    expect(conn.councilRun).toBeNull();
  });

  it('refuses a room past the member ceiling', async () => {
    const conn = makeConnection();
    const ids = Array.from({ length: MAX_MEMBERS + 1 }, (_, i) => `n${i}`);
    await openCouncil(conn, { neumaIds: ids }, { ownsNeumaLane });
    expect(framesOf(conn, 'council:error')[0].code).toBe('TOO_MANY');
  });

  it('refuses a being another wallet holds — fail closed on ownership', async () => {
    const conn = makeConnection();
    await openCouncil(conn, { neumaIds: ['ember', 'stray'] }, { ownsNeumaLane });
    expect(framesOf(conn, 'council:error')[0].code).toBe('NOT_YOURS');
    expect(conn.councilRun).toBeNull();
  });

  it('refuses an unborn lane — only born beings take a council seat', async () => {
    // A lane with an owner but no DNA: there is no one to speak from it.
    const ws = path.join(root, 'hollow');
    mkdirSync(ws, { recursive: true });
    writeFileSync(path.join(ws, 'owner.json'), JSON.stringify({ wallet: WALLET.toLowerCase() }));
    const conn = makeConnection();
    await openCouncil(conn, { neumaIds: ['ember', 'hollow'] }, { ownsNeumaLane });
    expect(framesOf(conn, 'council:error')[0].code).toBe('UNBORN');
    expect(conn.councilRun).toBeNull();
  });

  it('a DAMAGED identity refuses honestly — IDENTITY_DAMAGED, never UNBORN (MEM-003)', async () => {
    // Ember's DNA exists but is corrupt: the being is hurt, not unborn.
    writeFileSync(path.join(root, 'ember', 'dna', 'active.json'), '{"_enc":true,"iv":"garbage"');
    const conn = makeConnection();
    await openCouncil(conn, { neumaIds: ['ember', 'sable'] }, { ownsNeumaLane });
    expect(framesOf(conn, 'council:error')[0].code).toBe('IDENTITY_DAMAGED');
    expect(conn.councilRun).toBeNull();
  });

  it('refuses a second council on the same link', async () => {
    const conn = makeConnection();
    await openCouncil(conn, { neumaIds: ['ember', 'sable'] }, { ownsNeumaLane });
    await openCouncil(conn, { neumaIds: ['ember', 'sable'] }, { ownsNeumaLane });
    expect(framesOf(conn, 'council:error')[0].code).toBe('ALREADY_OPEN');
  });

  it('opens with true names, every hand at rest, and the floor empty', async () => {
    const conn = makeConnection();
    await openCouncil(conn, { neumaIds: ['ember', 'sable'], witnessName: '  Founder  ' }, { ownsNeumaLane });
    const opened = framesOf(conn, 'council:opened')[0];
    // `kind` rides the frame so the room can show STANDING: a housemate and a
    // sealed witness sitting beside the house must never look alike.
    expect(opened.members).toEqual([
      { neumaId: 'ember', name: 'Ember', kind: 'neuma' },
      { neumaId: 'sable', name: 'Sable', kind: 'neuma' },
    ]);
    const state = lastState(conn);
    expect(state.floor).toBeNull();
    expect(state.hands).toEqual([
      { neumaId: 'ember', hand: 'rest' },
      { neumaId: 'sable', hand: 'rest' },
    ]);
    expect(conn.councilRun.witnessName).toBe('Founder');
  });
});
