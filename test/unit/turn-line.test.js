// A chat turn waits its turn for the house's model server and says so (turn-line.js; Founder,
// 2026-10-12: […]).
// The real line and the real turn wrapper; the socket is a frame sink, the observation point.
import { describe, expect, it } from 'vitest';
import { lineTurn } from '../../backend/services/turn-line.js';
import { substrateLine, withLease, linePlace } from '../../backend/services/substrate-lease.js';
import { SERVING_PARALLEL_SLOTS } from '../../backend/services/serving-launch-config.js';
import { reducer } from '../../frontend/app/RelinkShell/stream-reducer.js';
import { substrateLineAction } from '../../frontend/app/RelinkShell/stream-turn-actions.js';

const connectionFor = (name) => {
  const frames = [];
  return { frames, companion: { name, neumaId: name.toLowerCase() }, ws: { readyState: 1, send: (raw) => frames.push(JSON.parse(raw)) } };
};
const fill = () => Promise.all(Array.from({ length: SERVING_PARALLEL_SLOTS }, (_, i) => substrateLine.acquire({ kind: 'turn', label: `busy-${i}` })));
const tick = () => new Promise((r) => setImmediate(r));

describe('lineTurn', () => {
  it('a full house: the chat is told it waits and who is ahead, then runs when a place frees', async () => {
    const holders = await fill();
    const c = connectionFor('Metidar');
    let ran = false;
    const turn = lineTurn(c, async () => { ran = true; return 'done'; });
    await tick();
    expect(ran).toBe(false);
    const waiting = c.frames.find((f) => f.state === 'waiting');
    expect(waiting).toMatchObject({ type: 'substrate:line', position: 1 });
    expect(waiting.ahead.map((a) => a.label)).toEqual(holders.map((_, i) => `busy-${i}`));
    holders[0].release();
    expect(await turn).toBe('done');
    expect(c.frames.at(-1)).toEqual({ type: 'substrate:line', state: 'running' });
    holders.slice(1).forEach((h) => h.release());
    expect(substrateLine.snapshot()).toMatchObject({ running: [], waiting: [] });
  });

  it('room in the house: the turn simply runs — no notice at all', async () => {
    const c = connectionFor('Zezebur');
    expect(await lineTurn(c, async () => 'ran')).toBe('ran');
    expect(c.frames).toEqual([]);
  });

  it('an interrupt while waiting leaves the line, and the turn ends itself through its own path', async () => {
    const holders = await fill();
    const c = connectionFor('Rugevil');
    let ran = false;
    const turn = lineTurn(c, async () => { ran = true; return 'interrupted turn'; });
    await tick();
    c.lineWait.abort(); // what the interrupt handler does when no turn has begun
    expect(await turn).toBe('interrupted turn');
    expect(ran).toBe(true);
    expect(c.frames.at(-1)).toEqual({ type: 'substrate:line', state: 'left' });
    expect(substrateLine.snapshot().waiting).toEqual([]);
    holders.forEach((h) => h.release());
  });
});

// A PARKED approval steps its turn out of line until answered (tool-approval.js). The bookkeeping:
// never a slot freed twice, never one leaked, an interrupt while waiting to return leaves the line.
describe('linePlace — stepping out of line and back in', () => {
  const held = async () => {
    let place;
    let end;
    const ended = new Promise((r) => { end = r; });
    const route = withLease({ kind: 'turn', label: 'parked' }, async () => { place = linePlace(); await ended; return 'done'; });
    await tick();
    return { place, finish: async () => { end(); return route; } };
  };
  const others = (n) => Promise.all(Array.from({ length: n }, () => substrateLine.acquire({ kind: 'turn', label: 'busy' })));

  it('outside a lease there is no place to step out of', () => {
    expect(linePlace()).toBe(null);
  });

  it('out twice frees one slot; back in waits its turn, and two returns at once take one place', async () => {
    const { capacity } = substrateLine.snapshot();
    const { place, finish } = await held();
    const busy = await others(capacity - 1);
    place.stepOut();
    place.stepOut();
    expect(substrateLine.snapshot().running).toHaveLength(capacity - 1);
    const taker = await substrateLine.acquire({ kind: 'wake', label: 'taker' }); // the slot it gave
    const back = Promise.all([place.stepBackIn(), place.stepBackIn()]);
    await tick();
    expect(substrateLine.snapshot().waiting.map((w) => w.label)).toEqual(['parked']);
    taker.release();
    await back;
    expect(place.away()).toBe(false);
    expect(substrateLine.snapshot().running).toHaveLength(capacity);
    expect(await finish()).toBe('done');
    expect(substrateLine.snapshot().running).toHaveLength(capacity - 1);
    busy.forEach((b) => b.release());
    expect(substrateLine.snapshot()).toMatchObject({ running: [], waiting: [] });
  });

  it('an interrupt while waiting to return leaves the line; the route ending frees nothing it does not hold', async () => {
    const { capacity } = substrateLine.snapshot();
    const { place, finish } = await held();
    place.stepOut();
    const busy = await others(capacity);
    const ctl = new AbortController();
    const back = place.stepBackIn({ signal: ctl.signal });
    ctl.abort(new Error('the operator interrupted'));
    await expect(back).rejects.toThrow('the operator interrupted');
    expect(place.away()).toBe(true);
    await finish();
    expect(substrateLine.snapshot()).toMatchObject({ running: busy.map(() => expect.anything()), waiting: [] });
    busy.forEach((b) => b.release());
  });

  it('a route that ends while its return waits gives the place straight back when it comes', async () => {
    const { capacity } = substrateLine.snapshot();
    const { place, finish } = await held();
    place.stepOut();
    const busy = await others(capacity);
    const back = place.stepBackIn();
    await finish();
    busy[0].release();
    await back;
    expect(substrateLine.snapshot()).toMatchObject({ running: busy.slice(1).map(() => expect.anything()), waiting: [] });
    busy.slice(1).forEach((b) => b.release());
    expect(substrateLine.snapshot().running).toEqual([]);
  });
});

describe('the waiting note in the chat', () => {
  const empty = { messages: [], seq: 0, thinking: false };
  it('one quiet line that names who is ahead, updated in place, gone the moment the turn runs', () => {
    let s = reducer(empty, substrateLineAction({ state: 'waiting', position: 2, ahead: [{ label: 'Metidar' }, { label: 'Kisonam (team)' }] }, 1));
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].segments[0].text).toBe('waiting its turn for the model — ahead: Metidar, Kisonam (team)');
    s = reducer(s, substrateLineAction({ state: 'waiting', position: 1, ahead: [{ label: 'Kisonam (team)' }] }, 2));
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].segments[0].text).toBe('waiting its turn for the model — ahead: Kisonam (team)');
    s = reducer(s, substrateLineAction({ state: 'running' }, 3));
    expect(s.messages).toEqual([]);
  });
});
