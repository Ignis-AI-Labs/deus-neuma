/**
 * Tests for the council reducer — the pure display model behind THE COUNCIL
 * window (frontend/app/RelinkShell/council-reducer.js).
 *
 * Covers convening, the speaker-keyed live tail (chunks matched by
 * (neumaId, turnId), so interleaved turns never bleed into each other),
 * settling, hands updates, the witness record, and the reset on close.
 * No IO, no clocks — the reducer is deterministic.
 */

import { describe, expect, test } from 'vitest';
import { reducer, initialState } from '../../frontend/app/RelinkShell/council-reducer.js';

// Fold a sequence of actions over the initial state.
const run = (actions, start = initialState) => actions.reduce(reducer, start);

// A message's spoken words — its speech segments joined (a turn is a list
// of speech/tool segments interleaved in arrival order).
const words = (m) => m.segments.filter((s) => s.kind === 'speech').map((s) => s.text).join('');

const MEMBERS = [
  { neumaId: 'alder', name: 'Alder' },
  { neumaId: 'birch', name: 'Birch' },
];

const OPENED = { type: 'OPENED', councilId: 'c1', members: MEMBERS };

describe('council-reducer', () => {
  test('OPENED convenes a fresh room — councilId and members set, nothing else', () => {
    const state = run([OPENED]);
    expect(state.councilId).toBe('c1');
    expect(state.members).toEqual(MEMBERS);
    expect(state.messages).toEqual([]);
    expect(state.hands).toEqual({});
    expect(state.floor).toBeNull();
  });

  test('OPENED clears a prior sitting (transcript, hands, error)', () => {
    const state = run([
      OPENED,
      { type: 'SAID', name: 'Ada', content: 'hello all', turnId: 't0' },
      { type: 'STATE', floor: 'alder', hands: [{ neumaId: 'birch', hand: 'hold' }], witnessQueue: 1 },
      { type: 'ERROR', code: 'X', message: 'broke' },
      { type: 'OPENED', councilId: 'c2', members: [MEMBERS[0]] },
    ]);
    expect(state.councilId).toBe('c2');
    expect(state.members).toEqual([MEMBERS[0]]);
    expect(state.messages).toEqual([]);
    expect(state.hands).toEqual({});
    expect(state.error).toBeNull();
    expect(state.witnessQueue).toBe(0);
  });

  test('STATE maps the hands array to a neumaId-keyed map with notes and line order', () => {
    const state = run([
      OPENED,
      {
        type: 'STATE',
        floor: 'alder',
        hands: [
          { neumaId: 'alder', hand: 'rest' },
          { neumaId: 'birch', hand: 'open', note: 'I disagree', order: 1 },
        ],
        witnessQueue: 2,
        witnessOrder: 2,
      },
    ]);
    expect(state.floor).toBe('alder');
    expect(state.hands).toEqual({
      alder: { hand: 'rest', note: '', order: null },
      birch: { hand: 'open', note: 'I disagree', order: 1 },
    });
    expect(state.witnessQueue).toBe(2);
    expect(state.witnessOrder).toBe(2);
  });

  test('STATE guards malformed fields — hands non-array, queue negative, order junk', () => {
    const state = run([
      OPENED,
      { type: 'STATE', floor: 'witness', hands: null, witnessQueue: -3, witnessOrder: 'first' },
    ]);
    expect(state.hands).toEqual({});
    expect(state.witnessQueue).toBe(0);
    expect(state.witnessOrder).toBeNull();
    expect(state.floor).toBe('witness');
  });

  test('OPENED carries the house ground; absent reads as unset', () => {
    const grounded = run([{ ...OPENED, houseWorkspace: '/mnt/house' }]);
    expect(grounded.houseWorkspace).toBe('/mnt/house');
    const bare = run([OPENED]);
    expect(bare.houseWorkspace).toBeNull();
  });

  // The per-seat `grounds` map and the GROUND action were REMOVED on
  // 2026-07-27: the focus ground is the consent. The room no longer
  // negotiates a ground per seat — the folder the operator has open IS the
  // ground, the server resolves and reachability-checks it, and the room
  // renders that single answer. What replaced these cases is the one below:
  // the display must follow the SERVER's verdict, never a client guess.
  test('OPENED carries the server-resolved ground, and absent reads as none', () => {
    const seated = run([{ ...OPENED, houseWorkspace: '/mnt/house' }]);
    expect(seated.houseWorkspace).toBe('/mnt/house');
    // null is the server saying the seats cannot reach it — the room must show
    // NO ground rather than printing a path nothing can read.
    expect(run([{ ...OPENED, houseWorkspace: null }]).houseWorkspace).toBeNull();
    expect(run([OPENED]).houseWorkspace).toBeNull();
    // A junk payload reads as none, never as a partially-trusted path.
    expect(run([{ ...OPENED, houseWorkspace: 42 }]).houseWorkspace).toBeNull();
  });

  test('a stale per-seat grounds payload is ignored, not stored', () => {
    // An older server (or a replayed frame) may still send `grounds`. It must
    // not reappear in state — nothing reads it, and a half-live field is how a
    // removed concept creeps back.
    const state = run([{ ...OPENED, houseWorkspace: '/mnt/house', grounds: { ember: '/x' } }]);
    expect(state.grounds).toBeUndefined();
  });

  test('turns carry their moment (`at`) — mint, witness word, restored record', () => {
    const AT = 1770000000000;
    const state = run([
      OPENED,
      { type: 'SAID', name: 'Ada', content: 'hello all', turnId: 't0', at: AT },
      { type: 'SPEECH', neumaId: 'alder', turnId: 't1', content: 'Present.', at: AT + 1000 },
      { type: 'SPEECH', neumaId: 'alder', turnId: 't1', content: ' Listening.', at: AT + 9000 },
    ]);
    expect(state.messages[0].at).toBe(AT);          // the witness's word
    expect(state.messages[1].at).toBe(AT + 1000);   // the turn keeps its mint moment
    // A reopened council restores each turn's recorded moment; a record
    // predating the stamp reads null — never undefined or NaN.
    const reopened = run([{
      ...OPENED,
      transcript: [
        { speaker: 'witness', name: 'Ada', content: 'as we said', at: '2026-07-20T14:00:00.000Z' },
        { speaker: 'alder', name: 'Alder', content: 'indeed' },
      ],
    }]);
    expect(reopened.messages[0].at).toBe('2026-07-20T14:00:00.000Z');
    expect(reopened.messages[1].at).toBeNull();
  });

  test('an act lands IN the turn, in flow — words continue below the chip', () => {
    const state = run([
      OPENED,
      { type: 'SPEECH', neumaId: 'birch', turnId: 't1', content: 'Laying the record down. ' },
      { type: 'TOOL_ACTING', neumaId: 'birch', turnId: 't1', tool: 'write_file', path: '/mnt/house/repos/notes.md' },
      { type: 'TOOL_RESULT', neumaId: 'birch', turnId: 't1', tool: 'write_file', path: '/mnt/house/repos/notes.md', ok: true },
      { type: 'SPEECH', neumaId: 'birch', turnId: 't1', content: 'Done.' },
      { type: 'SPOKE', neumaId: 'birch', turnId: 't1' },
    ]);
    // ONE message, three segments, in arrival order — never a clump of
    // acts after the words.
    expect(state.messages).toHaveLength(1);
    const m = state.messages[0];
    expect(m).toMatchObject({ speaker: 'birch', name: 'Birch', live: false });
    expect(m.segments.map((s) => s.kind)).toEqual(['speech', 'tool', 'speech']);
    expect(m.segments[1]).toMatchObject({ phase: 'resolved', label: 'write_file', path: '/mnt/house/repos/notes.md', ok: true });
    expect(words(m)).toBe('Laying the record down. Done.');
  });

  test('a streamed block opens an acting chip that the settle resolves in place', () => {
    const mid = run([
      OPENED,
      { type: 'SPEECH', neumaId: 'birch', turnId: 't1', content: 'Writing now.' },
      { type: 'TOOL_OPEN', neumaId: 'birch', turnId: 't1' },
      { type: 'TOOL_LABEL', neumaId: 'birch', turnId: 't1', label: 'write_file' },
    ]);
    expect(mid.messages[0].segments[1]).toMatchObject({ kind: 'tool', phase: 'acting', label: 'write_file' });
    const done = run([
      { type: 'TOOL_ACTING', neumaId: 'birch', turnId: 't1', tool: 'write_file', path: '/mnt/house/a.md' },
      { type: 'TOOL_RESULT', neumaId: 'birch', turnId: 't1', tool: 'write_file', path: '/mnt/house/a.md', ok: true },
    ], mid);
    // Still one chip — announced, targeted, then resolved IN PLACE.
    expect(done.messages[0].segments).toHaveLength(2);
    expect(done.messages[0].segments[1]).toMatchObject({ phase: 'resolved', ok: true, path: '/mnt/house/a.md' });
  });

  test('a refused act carries its refusal — and can be born of nothing but the act', () => {
    const state = run([
      OPENED,
      { type: 'TOOL_RESULT', neumaId: 'birch', turnId: 't1', tool: 'write_file', path: '/etc/passwd', ok: false, error: 'Path outside allowed roots' },
    ]);
    // No words had streamed — the act alone minted the turn.
    expect(state.messages).toHaveLength(1);
    const chip = state.messages[0].segments[0];
    expect(chip).toMatchObject({ kind: 'tool', phase: 'resolved', ok: false });
    expect(chip.error).toMatch(/outside/);
  });

  test('SPOKE settles a chip left acting — nothing pulses in a finished turn', () => {
    const state = run([
      OPENED,
      { type: 'SPEECH', neumaId: 'birch', turnId: 't1', content: 'Trying.' },
      { type: 'TOOL_OPEN', neumaId: 'birch', turnId: 't1' },
      { type: 'SPOKE', neumaId: 'birch', turnId: 't1' },
    ]);
    expect(state.messages[0].segments[1]).toMatchObject({ kind: 'tool', phase: 'resolved', ok: false });
  });

  test('a stray TOOL_LABEL with no turn standing is a no-op — no phantom turn', () => {
    const seeded = run([OPENED]);
    expect(reducer(seeded, { type: 'TOOL_LABEL', neumaId: 'birch', turnId: 't1', label: 'write_file' })).toBe(seeded);
  });

  test('acts resolve FIFO — two chips standing, the first settles first', () => {
    const state = run([
      OPENED,
      { type: 'TOOL_OPEN', neumaId: 'birch', turnId: 't1' },
      { type: 'TOOL_LABEL', neumaId: 'birch', turnId: 't1', label: 'create_directory' },
      { type: 'TOOL_OPEN', neumaId: 'birch', turnId: 't1' },
      { type: 'TOOL_LABEL', neumaId: 'birch', turnId: 't1', label: 'write_file' },
      { type: 'TOOL_RESULT', neumaId: 'birch', turnId: 't1', tool: 'create_directory', path: '/mnt/house/repos', ok: true },
    ]);
    const segs = state.messages[0].segments;
    expect(segs[0]).toMatchObject({ phase: 'resolved', label: 'create_directory', ok: true });
    expect(segs[1]).toMatchObject({ phase: 'acting', label: 'write_file' });
  });

  test('STATE carries who is considering; junk reads as nobody', () => {
    const thinking = run([
      OPENED,
      { type: 'STATE', floor: null, hands: [], witnessQueue: 0, considering: ['birch', 7, 'alder'] },
    ]);
    expect(thinking.considering).toEqual(['birch', 'alder']);
    const done = run([
      OPENED,
      { type: 'STATE', floor: null, hands: [], witnessQueue: 0, considering: ['birch'] },
      { type: 'STATE', floor: null, hands: [], witnessQueue: 0 },
    ]);
    expect(done.considering).toEqual([]);
  });

  test('a state without order clears a prior order — the line is the server’s word, never stale', () => {
    const state = run([
      OPENED,
      { type: 'STATE', floor: null, hands: [{ neumaId: 'birch', hand: 'hold', order: 1 }], witnessQueue: 1, witnessOrder: 2 },
      { type: 'STATE', floor: 'birch', hands: [{ neumaId: 'birch', hand: 'rest' }], witnessQueue: 0 },
    ]);
    expect(state.hands.birch.order).toBeNull();
    expect(state.witnessOrder).toBeNull();
  });

  test('a hands update replaces the previous map — a lowered hand goes quiet', () => {
    const state = run([
      OPENED,
      { type: 'STATE', floor: null, hands: [{ neumaId: 'birch', hand: 'open' }], witnessQueue: 0 },
      { type: 'STATE', floor: 'birch', hands: [{ neumaId: 'birch', hand: 'rest' }], witnessQueue: 0 },
    ]);
    expect(state.hands.birch.hand).toBe('rest');
  });

  test('SAID appends a settled witness message', () => {
    const state = run([OPENED, { type: 'SAID', name: 'Ada', content: 'begin', turnId: 'w1' }]);
    expect(state.messages).toEqual([
      { speaker: 'witness', name: 'Ada', turnId: 'w1', at: null, segments: [{ kind: 'speech', text: 'begin' }], live: false },
    ]);
  });

  test('SPEECH mints the turn live on first chunk and appends thereafter', () => {
    const state = run([
      OPENED,
      { type: 'SPEECH', neumaId: 'alder', turnId: 't1', content: 'I think ' },
      { type: 'SPEECH', neumaId: 'alder', turnId: 't1', content: 'we should.' },
    ]);
    expect(state.messages).toEqual([
      { speaker: 'alder', name: 'Alder', turnId: 't1', at: null, segments: [{ kind: 'speech', text: 'I think we should.' }], live: true },
    ]);
  });

  test('SPOKE settles exactly its turn', () => {
    const state = run([
      OPENED,
      { type: 'SPEECH', neumaId: 'alder', turnId: 't1', content: 'done now.' },
      { type: 'SPOKE', neumaId: 'alder', turnId: 't1' },
    ]);
    expect(state.messages[0].live).toBe(false);
  });

  test('interleaving safety: chunks for a NEW turn while the old one settles', () => {
    const state = run([
      OPENED,
      { type: 'SPEECH', neumaId: 'alder', turnId: 't1', content: 'first turn ' },
      // Birch takes the floor before Alder's settle frame lands.
      { type: 'SPEECH', neumaId: 'birch', turnId: 't2', content: 'second ' },
      { type: 'SPOKE', neumaId: 'alder', turnId: 't1' },
      { type: 'SPEECH', neumaId: 'birch', turnId: 't2', content: 'turn.' },
    ]);
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]).toMatchObject({ speaker: 'alder', live: false });
    expect(words(state.messages[0])).toBe('first turn ');
    expect(state.messages[1]).toMatchObject({ speaker: 'birch', live: true });
    expect(words(state.messages[1])).toBe('second turn.');
  });

  test('same member, back-to-back turns: a new turnId opens a new message', () => {
    const state = run([
      OPENED,
      { type: 'SPEECH', neumaId: 'alder', turnId: 't1', content: 'one' },
      { type: 'SPEECH', neumaId: 'alder', turnId: 't3', content: 'two' },
      { type: 'SPOKE', neumaId: 'alder', turnId: 't1' },
    ]);
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]).toMatchObject({ turnId: 't1', live: false });
    expect(words(state.messages[0])).toBe('one');
    expect(state.messages[1]).toMatchObject({ turnId: 't3', live: true });
    expect(words(state.messages[1])).toBe('two');
  });

  test('a straggling chunk after its turn settled is dropped — the record stands', () => {
    const state = run([
      OPENED,
      { type: 'SPEECH', neumaId: 'alder', turnId: 't1', content: 'said.' },
      { type: 'SPOKE', neumaId: 'alder', turnId: 't1' },
      { type: 'SPEECH', neumaId: 'alder', turnId: 't1', content: ' late chunk' },
    ]);
    expect(state.messages).toHaveLength(1);
    expect(words(state.messages[0])).toBe('said.');
  });

  test('SPOKE for an unknown turn is a no-op', () => {
    const seeded = run([OPENED, { type: 'SPEECH', neumaId: 'alder', turnId: 't1', content: 'x' }]);
    expect(reducer(seeded, { type: 'SPOKE', neumaId: 'birch', turnId: 't9' })).toBe(seeded);
  });

  test('an empty SPEECH chunk is a no-op', () => {
    const seeded = run([OPENED]);
    expect(reducer(seeded, { type: 'SPEECH', neumaId: 'alder', turnId: 't1', content: '' })).toBe(seeded);
  });

  test('a speaker outside the opened roster still lands, named by id', () => {
    const state = run([OPENED, { type: 'SPEECH', neumaId: 'stranger', turnId: 't1', content: 'hm' }]);
    expect(state.messages[0].name).toBe('stranger');
  });

  test('ERROR is held until the next convening', () => {
    const state = run([OPENED, { type: 'ERROR', code: 'FLOOR_LOST', message: 'the floor was lost' }]);
    expect(state.error).toEqual({ code: 'FLOOR_LOST', message: 'the floor was lost' });
  });

  test('CLOSED empties the room but keeps the witness shelf', () => {
    const past = [{ councilId: 'council-1', members: [], lastAt: 'x' }];
    const state = run([
      OPENED,
      { type: 'PAST', councils: past },
      { type: 'SPEECH', neumaId: 'alder', turnId: 't1', content: 'words' },
      { type: 'STATE', floor: 'alder', hands: [{ neumaId: 'birch', hand: 'hold' }], witnessQueue: 1 },
      { type: 'CLOSED' },
    ]);
    expect(state).toEqual({ ...initialState, past });
  });

  test('a REOPENED council arrives with its restored exchange, settled', () => {
    const state = run([{
      type: 'OPENED',
      councilId: 'council-9',
      members: [{ neumaId: 'alder', name: 'Alder' }, { neumaId: 'birch', name: 'Birch' }],
      transcript: [
        { speaker: 'witness', name: 'Ada', content: 'What do we hold?' },
        { speaker: 'alder', name: 'Alder', content: 'The east road.' },
      ],
    }]);
    expect(state.messages).toHaveLength(2);
    expect(state.messages.every((m) => m.live === false)).toBe(true);
    expect(state.messages[1]).toMatchObject({ speaker: 'alder', name: 'Alder' });
    expect(words(state.messages[1])).toBe('The east road.');
    // Restored turns carry stable keys of their own namespace.
    expect(state.messages.map((m) => m.turnId)).toEqual(['restored-0', 'restored-1']);
  });

  test('PAST holds the shelf across a new convening', () => {
    const past = [{ councilId: 'council-1' }];
    const state = run([{ type: 'PAST', councils: past }, OPENED]);
    expect(state.past).toEqual(past);
  });

  test('HANDS appends the round\'s verdict to the flow — receipt made visible', () => {
    const state = run([OPENED, {
      type: 'HANDS',
      reports: [
        { neumaId: 'alder', hand: 'rest', note: '', received: 'answered' },
        { neumaId: 'birch', hand: null, note: '', received: 'unreachable' },
      ],
    }]);
    expect(state.messages).toHaveLength(1);
    const entry = state.messages[0];
    expect(entry.kind).toBe('hands');
    expect(entry.live).toBe(false);
    expect(entry.segments).toEqual([]); // tail-follow reads it like any message
    expect(entry.reports).toEqual([
      { neumaId: 'alder', hand: 'rest', note: '', received: 'answered' },
      { neumaId: 'birch', hand: null, note: '', received: 'unreachable' },
    ]);
  });

  test('HANDS sanitizes the wire — junk reports drop, junk fields normalize, empty rounds are no-ops', () => {
    const state = run([OPENED, {
      type: 'HANDS',
      reports: [
        { neumaId: 'alder', hand: 'waving', note: 42, received: 'perhaps' },
        { hand: 'open' }, // no neumaId — dropped
        null,
      ],
    }]);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].reports).toEqual([
      { neumaId: 'alder', hand: null, note: '', received: 'answered' },
    ]);
    // A round with nothing legible appends nothing.
    const empty = run([OPENED, { type: 'HANDS', reports: [null, {}] }]);
    expect(empty.messages).toHaveLength(0);
    const absent = run([OPENED, { type: 'HANDS' }]);
    expect(absent.messages).toHaveLength(0);
  });
});

describe('ORDER — THE GAVEL in the record', () => {
  test('appends the order mark, stamps its moment, clears the considering', () => {
    const state = run([
      OPENED,
      { type: 'STATE', floor: null, hands: [], witnessQueue: 0, considering: ['n-alder'] },
      { type: 'ORDER', at: 1700000000000 },
    ]);
    expect(state.considering).toEqual([]);
    const mark = state.messages.at(-1);
    expect(mark.kind).toBe('order');
    expect(mark.at).toBe(1700000000000);
    expect(mark.live).toBe(false);
    expect(mark.segments).toEqual([]);
  });
});

describe("APPROVAL — the witness's gate in the room's flow", () => {
  test('an ask rises pending, and server truth settles it', () => {
    const asked = run([
      OPENED,
      { type: 'APPROVAL_ASK', id: 'ap-1', tool: 'read_text_file', args: '{"path": "/x"}', scope: 'Linden asks to READ outside the house ground: /x', at: 1700000000000 },
    ]);
    const chip = asked.messages.at(-1);
    expect(chip).toMatchObject({ kind: 'approval', phase: 'pending', id: 'ap-1', tool: 'read_text_file' });
    const settled = run([{ type: 'APPROVAL_SETTLED', id: 'ap-1', decision: 'always' }], asked);
    expect(settled.messages.at(-1)).toMatchObject({ phase: 'resolved', decision: 'always' });
    // An unknown id settles nothing.
    expect(run([{ type: 'APPROVAL_SETTLED', id: 'nope', decision: 'deny' }], settled)).toEqual(settled);
  });
});
