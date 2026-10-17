import {
  createCouncil, witnessSays, handsReported, selectNext, grantFloor,
  floorYielded, calledToOrder, memberLeaves, speakingOrder,
} from '../../core/council/council-arbiter.js';

const MEMBERS = [
  { neumaId: 'n-fenna', name: 'Fenna' },
  { neumaId: 'n-cael', name: 'Cael' },
  { neumaId: 'n-galen', name: 'Galen' },
];

const openRoom = () => createCouncil({ members: MEMBERS });

describe('Council Arbiter', () => {
  describe('createCouncil', () => {
    test('opens with all hands at rest, floor empty, nothing queued', () => {
      const state = openRoom();
      expect(state.floor).toBeNull();
      expect(state.witnessQueue).toEqual([]);
      expect(state.turnSeq).toBe(0);
      for (const m of MEMBERS) {
        expect(state.hands[m.neumaId]).toEqual({ hand: 'rest', note: '', raisedSeq: null });
      }
    });

    test('returns a deeply frozen state', () => {
      const state = openRoom();
      expect(Object.isFrozen(state)).toBe(true);
      expect(Object.isFrozen(state.members)).toBe(true);
      expect(Object.isFrozen(state.members[0])).toBe(true);
      expect(Object.isFrozen(state.hands)).toBe(true);
      expect(Object.isFrozen(state.hands['n-fenna'])).toBe(true);
      expect(Object.isFrozen(state.witnessQueue)).toBe(true);
    });

    test('handles an empty room', () => {
      const state = createCouncil({ members: [] });
      expect(state.members).toEqual([]);
      expect(selectNext(state)).toBeNull();
    });
  });

  describe('witnessSays', () => {
    test('enqueues with urgency and a monotonic seq, without mutating the prior state', () => {
      const s0 = openRoom();
      const s1 = witnessSays(s0, { content: 'first', urgency: 'now' });
      const s2 = witnessSays(s1, { content: 'second', urgency: 'hold' });
      expect(s0.witnessQueue).toHaveLength(0);
      expect(s2.witnessQueue.map((m) => m.content)).toEqual(['first', 'second']);
      expect(s2.witnessQueue[0].seq).toBeLessThan(s2.witnessQueue[1].seq);
      expect(s2.witnessQueue[1].urgency).toBe('hold');
      expect(Object.isFrozen(s2)).toBe(true);
      expect(Object.isFrozen(s2.witnessQueue[0])).toBe(true);
    });

    test('an unknown urgency reads as now, never dropped', () => {
      const state = witnessSays(openRoom(), { content: 'hey', urgency: 'shout' });
      expect(state.witnessQueue[0].urgency).toBe('now');
    });
  });

  describe('handsReported', () => {
    test('raises hands with notes', () => {
      const state = handsReported(openRoom(), [
        { neumaId: 'n-fenna', hand: 'open', note: 'this cannot wait' },
        { neumaId: 'n-cael', hand: 'hold', note: 'after you' },
      ]);
      expect(state.hands['n-fenna'].hand).toBe('open');
      expect(state.hands['n-fenna'].note).toBe('this cannot wait');
      expect(state.hands['n-cael'].hand).toBe('hold');
      expect(state.hands['n-galen'].hand).toBe('rest');
    });

    test('assigns monotonic raisedSeq in report order (FIFO within one round)', () => {
      const state = handsReported(openRoom(), [
        { neumaId: 'n-cael', hand: 'hold' },
        { neumaId: 'n-fenna', hand: 'hold' },
      ]);
      expect(state.hands['n-cael'].raisedSeq).toBeLessThan(state.hands['n-fenna'].raisedSeq);
    });

    test('a hand that stays non-rest keeps its raisedSeq — re-reporting never jumps the queue', () => {
      const s1 = handsReported(openRoom(), [{ neumaId: 'n-cael', hand: 'hold', note: 'v1' }]);
      const s2 = handsReported(s1, [
        { neumaId: 'n-fenna', hand: 'hold' },
        { neumaId: 'n-cael', hand: 'open', note: 'v2' }, // escalates, keeps place
      ]);
      expect(s2.hands['n-cael'].raisedSeq).toBe(s1.hands['n-cael'].raisedSeq);
      expect(s2.hands['n-cael'].hand).toBe('open');
      expect(s2.hands['n-cael'].note).toBe('v2');
      expect(s2.hands['n-fenna'].raisedSeq).toBeGreaterThan(s2.hands['n-cael'].raisedSeq);
    });

    test('lowering to rest clears note and raisedSeq; raising again joins the back of the line', () => {
      const s1 = handsReported(openRoom(), [{ neumaId: 'n-cael', hand: 'hold', note: 'x' }]);
      const s2 = handsReported(s1, [{ neumaId: 'n-cael', hand: 'rest' }]);
      expect(s2.hands['n-cael']).toEqual({ hand: 'rest', note: '', raisedSeq: null });
      const s3 = handsReported(s2, [{ neumaId: 'n-fenna', hand: 'hold' }]);
      const s4 = handsReported(s3, [{ neumaId: 'n-cael', hand: 'hold' }]);
      expect(s4.hands['n-cael'].raisedSeq).toBeGreaterThan(s4.hands['n-fenna'].raisedSeq);
    });

    test('the floor-holder keeps a lowered hand even if it reports otherwise', () => {
      let state = handsReported(openRoom(), [{ neumaId: 'n-fenna', hand: 'open' }]);
      state = grantFloor(state, selectNext(state)); // fenna takes the floor
      expect(state.floor.speaker).toBe('n-fenna');
      state = handsReported(state, [{ neumaId: 'n-fenna', hand: 'open', note: 'more!' }]);
      expect(state.hands['n-fenna'].hand).toBe('rest');
    });

    test('the last speaker MAY raise again after yielding — a thought can be bigger than one turn', () => {
      let state = handsReported(openRoom(), [{ neumaId: 'n-fenna', hand: 'open' }]);
      state = grantFloor(state, selectNext(state));
      state = floorYielded(state);
      state = handsReported(state, [
        { neumaId: 'n-fenna', hand: 'hold' },
        { neumaId: 'n-cael', hand: 'hold' },
      ]);
      expect(state.hands['n-fenna'].hand).toBe('hold');
      expect(state.hands['n-cael'].hand).toBe('hold');
    });

    test('a re-raise after yielding joins the BACK of the line — everyone already waiting speaks first', () => {
      // Cael raises while Fenna holds the floor; Fenna yields and re-raises
      // in the same round. Cael raised first, so Cael speaks next.
      let state = handsReported(openRoom(), [{ neumaId: 'n-fenna', hand: 'open' }]);
      state = grantFloor(state, selectNext(state));
      state = handsReported(state, [{ neumaId: 'n-cael', hand: 'hold' }]);
      state = floorYielded(state);
      state = handsReported(state, [{ neumaId: 'n-fenna', hand: 'hold' }]);
      expect(state.hands['n-fenna'].hand).toBe('hold');
      expect(state.hands['n-fenna'].raisedSeq).toBeGreaterThan(state.hands['n-cael'].raisedSeq);
      expect(selectNext(state)).toEqual({ kind: 'member', neumaId: 'n-cael' });
    });

    test('an unread hand (null) keeps standing exactly as it was', () => {
      const s1 = handsReported(openRoom(), [{ neumaId: 'n-cael', hand: 'hold', note: 'building on that' }]);
      const s2 = handsReported(s1, [{ neumaId: 'n-cael', hand: null }]);
      expect(s2.hands['n-cael']).toEqual(s1.hands['n-cael']);
      expect(s2.hands['n-cael'].hand).toBe('hold');
      expect(s2.hands['n-cael'].raisedSeq).toBe(s1.hands['n-cael'].raisedSeq);
    });

    test('an unread hand never raises a resting one', () => {
      const state = handsReported(openRoom(), [{ neumaId: 'n-cael', hand: null }]);
      expect(state.hands['n-cael'].hand).toBe('rest');
    });

    test('the floor-holder rule outranks an unread hand — it still reads as rest', () => {
      let state = handsReported(openRoom(), [{ neumaId: 'n-fenna', hand: 'open' }]);
      state = grantFloor(state, selectNext(state));
      state = handsReported(state, [{ neumaId: 'n-fenna', hand: null }]);
      expect(state.hands['n-fenna'].hand).toBe('rest');
    });

    test('unknown members and unknown hand values are fail-quiet', () => {
      const state = handsReported(openRoom(), [
        { neumaId: 'n-stranger', hand: 'open' },
        { neumaId: 'n-cael', hand: 'jazz-hands' },
      ]);
      expect(state.hands['n-stranger']).toBeUndefined();
      expect(state.hands['n-cael'].hand).toBe('rest');
    });
  });

  describe('selectNext — grant order', () => {
    test('empty room selects null', () => {
      expect(selectNext(openRoom())).toBeNull();
    });

    test("witness 'now' beats an open hand", () => {
      let state = handsReported(openRoom(), [{ neumaId: 'n-fenna', hand: 'open' }]);
      state = witnessSays(state, { content: 'stop', urgency: 'now' });
      const sel = selectNext(state);
      expect(sel.kind).toBe('witness');
      expect(sel.message.content).toBe('stop');
    });

    test("an open hand beats witness 'hold'", () => {
      let state = witnessSays(openRoom(), { content: 'later', urgency: 'hold' });
      state = handsReported(state, [{ neumaId: 'n-cael', hand: 'open' }]);
      const sel = selectNext(state);
      expect(sel).toEqual({ kind: 'member', neumaId: 'n-cael' });
    });

    test("witness 'hold' beats a held hand", () => {
      let state = witnessSays(openRoom(), { content: 'later', urgency: 'hold' });
      state = handsReported(state, [{ neumaId: 'n-cael', hand: 'hold' }]);
      expect(selectNext(state).kind).toBe('witness');
    });

    test('held hands grant when nothing outranks them', () => {
      const state = handsReported(openRoom(), [{ neumaId: 'n-galen', hand: 'hold' }]);
      expect(selectNext(state)).toEqual({ kind: 'member', neumaId: 'n-galen' });
    });

    test('among equal hands, the earliest raisedSeq wins (FIFO across rounds)', () => {
      const s1 = handsReported(openRoom(), [{ neumaId: 'n-galen', hand: 'open' }]);
      const s2 = handsReported(s1, [{ neumaId: 'n-fenna', hand: 'open' }]);
      expect(selectNext(s2)).toEqual({ kind: 'member', neumaId: 'n-galen' });
    });

    test('witness now queue is FIFO', () => {
      let state = witnessSays(openRoom(), { content: 'one', urgency: 'now' });
      state = witnessSays(state, { content: 'two', urgency: 'now' });
      expect(selectNext(state).message.content).toBe('one');
    });
  });

  describe('grantFloor', () => {
    test('member grant: sets the floor with a fresh turnId and clears the hand', () => {
      let state = handsReported(openRoom(), [{ neumaId: 'n-fenna', hand: 'open', note: 'x' }]);
      state = grantFloor(state, selectNext(state));
      expect(state.floor).toEqual({ speaker: 'n-fenna', turnId: 'turn-1' });
      expect(state.turnSeq).toBe(1);
      expect(state.hands['n-fenna']).toEqual({ hand: 'rest', note: '', raisedSeq: null });
    });

    test('witness grant: dequeues exactly that message', () => {
      let state = witnessSays(openRoom(), { content: 'one', urgency: 'now' });
      state = witnessSays(state, { content: 'two', urgency: 'now' });
      const sel = selectNext(state);
      state = grantFloor(state, sel);
      expect(state.floor.speaker).toBe('witness');
      expect(state.witnessQueue.map((m) => m.content)).toEqual(['two']);
    });

    test('turnIds are distinct across consecutive grants', () => {
      let state = handsReported(openRoom(), [
        { neumaId: 'n-fenna', hand: 'open' },
        { neumaId: 'n-cael', hand: 'open' },
      ]);
      state = grantFloor(state, selectNext(state));
      const firstTurn = state.floor.turnId;
      state = floorYielded(state);
      state = grantFloor(state, selectNext(state));
      expect(state.floor.turnId).not.toBe(firstTurn);
    });

    test('a null selection is a no-op', () => {
      const state = openRoom();
      expect(grantFloor(state, null)).toBe(state);
    });
  });

  describe('unlimited flow — a raised hand always reaches the floor', () => {
    test('many unbroken member grants never freeze the room', () => {
      let state = openRoom();
      // Far past the old cap of 6 — the flow has no ceiling.
      for (let i = 0; i < 20; i++) {
        const other = MEMBERS.find((m) => m.neumaId !== state.lastSpeaker).neumaId;
        state = handsReported(state, [{ neumaId: other, hand: 'open' }]);
        const sel = selectNext(state);
        expect(sel).toEqual({ kind: 'member', neumaId: other });
        state = grantFloor(state, sel);
        state = floorYielded(state);
      }
      expect(state.turnSeq).toBe(20);
    });

    test("the witness's 'now' word still preempts any raised hand — the brake is positional", () => {
      let state = handsReported(openRoom(), [
        { neumaId: 'n-fenna', hand: 'open' },
        { neumaId: 'n-cael', hand: 'hold' },
      ]);
      state = witnessSays(state, { content: 'hold on, everyone', urgency: 'now' });
      expect(selectNext(state).kind).toBe('witness');
    });
  });

  describe('floorYielded', () => {
    test('clears the floor and remembers the last speaker', () => {
      let state = handsReported(openRoom(), [{ neumaId: 'n-cael', hand: 'open' }]);
      state = grantFloor(state, selectNext(state));
      state = floorYielded(state);
      expect(state.floor).toBeNull();
      expect(state.lastSpeaker).toBe('n-cael');
    });

    test('yielding an already-empty floor keeps the previous last speaker', () => {
      let state = handsReported(openRoom(), [{ neumaId: 'n-cael', hand: 'open' }]);
      state = grantFloor(state, selectNext(state));
      state = floorYielded(state);
      state = floorYielded(state);
      expect(state.lastSpeaker).toBe('n-cael');
    });
  });

  describe('memberLeaves', () => {
    test('drops the member, their hand, and their floor if held', () => {
      let state = handsReported(openRoom(), [{ neumaId: 'n-fenna', hand: 'open' }]);
      state = grantFloor(state, selectNext(state));
      state = memberLeaves(state, 'n-fenna');
      expect(state.members.map((m) => m.neumaId)).toEqual(['n-cael', 'n-galen']);
      expect(state.hands['n-fenna']).toBeUndefined();
      expect(state.floor).toBeNull();
    });

    test('leaving without the floor leaves the floor alone', () => {
      let state = handsReported(openRoom(), [{ neumaId: 'n-fenna', hand: 'open' }]);
      state = grantFloor(state, selectNext(state));
      state = memberLeaves(state, 'n-galen');
      expect(state.floor.speaker).toBe('n-fenna');
    });
  });

  describe('speakingOrder — the projected line, in grant order', () => {
    test('an empty room has an empty line', () => {
      expect(speakingOrder(openRoom())).toEqual([]);
    });

    test('a late OPEN outranks an early HOLD — the jump is visible as order', () => {
      // The confusion from the wild (2026-07-17): a member "after" another
      // spoke first. That is the law working — OPEN beats HOLD — and the
      // line makes it legible.
      const s1 = handsReported(openRoom(), [{ neumaId: 'n-fenna', hand: 'hold' }]);
      const s2 = handsReported(s1, [{ neumaId: 'n-cael', hand: 'open' }]);
      expect(speakingOrder(s2)).toEqual([
        { kind: 'member', neumaId: 'n-cael' },
        { kind: 'member', neumaId: 'n-fenna' },
      ]);
    });

    test('within one level, FIFO by raisedSeq', () => {
      const s1 = handsReported(openRoom(), [{ neumaId: 'n-galen', hand: 'hold' }]);
      const s2 = handsReported(s1, [{ neumaId: 'n-fenna', hand: 'hold' }]);
      expect(speakingOrder(s2).map((e) => e.neumaId)).toEqual(['n-galen', 'n-fenna']);
    });

    test('raisedSeq follows APPLICATION order — whoever lands first queues first, either way round', () => {
      // The session layer applies each hand the moment it arrives; the
      // arbiter must key the queue off that arrival, not off roster order.
      const a = handsReported(handsReported(openRoom(), [{ neumaId: 'n-cael', hand: 'hold' }]), [{ neumaId: 'n-fenna', hand: 'hold' }]);
      const b = handsReported(handsReported(openRoom(), [{ neumaId: 'n-fenna', hand: 'hold' }]), [{ neumaId: 'n-cael', hand: 'hold' }]);
      expect(speakingOrder(a).map((e) => e.neumaId)).toEqual(['n-cael', 'n-fenna']);
      expect(speakingOrder(b).map((e) => e.neumaId)).toEqual(['n-fenna', 'n-cael']);
    });

    test("witness words slot by urgency: 'now' leads everything, 'hold' sits between opens and holds", () => {
      let state = handsReported(openRoom(), [
        { neumaId: 'n-fenna', hand: 'hold' },
        { neumaId: 'n-cael', hand: 'open' },
      ]);
      state = witnessSays(state, { content: 'when you finish', urgency: 'hold' });
      state = witnessSays(state, { content: 'stop', urgency: 'now' });
      expect(speakingOrder(state).map((e) => (e.kind === 'witness' ? 'witness' : e.neumaId)))
        .toEqual(['witness', 'n-cael', 'witness', 'n-fenna']);
    });

    test('the line matches what selectNext actually grants, head first', () => {
      const state = handsReported(openRoom(), [
        { neumaId: 'n-fenna', hand: 'hold' },
        { neumaId: 'n-cael', hand: 'open' },
      ]);
      const line = speakingOrder(state);
      expect(selectNext(state)).toEqual({ kind: 'member', neumaId: line[0].neumaId });
    });

    test('the line is frozen — a projection, never a place to mutate the room', () => {
      const state = handsReported(openRoom(), [{ neumaId: 'n-cael', hand: 'open' }]);
      const line = speakingOrder(state);
      expect(Object.isFrozen(line)).toBe(true);
      expect(Object.isFrozen(line[0])).toBe(true);
    });
  });

  describe('immutability across every transition', () => {
    test('each transition returns a new frozen state and never mutates its input', () => {
      const s0 = openRoom();
      const s1 = witnessSays(s0, { content: 'hello', urgency: 'now' });
      const s2 = handsReported(s1, [{ neumaId: 'n-fenna', hand: 'hold', note: 'n' }]);
      const s3 = grantFloor(s2, selectNext(s2));
      const s4 = floorYielded(s3);
      for (const s of [s1, s2, s3, s4]) expect(Object.isFrozen(s)).toBe(true);
      expect(s0.witnessQueue).toHaveLength(0);
      expect(s1.hands['n-fenna'].hand).toBe('rest');
      expect(s2.floor).toBeNull();
      expect(s3.floor).not.toBeNull();
      expect(() => { s3.turnSeq = 99; }).toThrow();
    });
  });

  describe('calledToOrder — THE GAVEL', () => {
    test('every hand goes to rest — notes and seats in line included', () => {
      let state = handsReported(openRoom(), [
        { neumaId: 'n-fenna', hand: 'open', note: 'urgent thread' },
        { neumaId: 'n-cael', hand: 'hold', note: 'building on it' },
      ]);
      state = calledToOrder(state);
      for (const m of state.members) {
        expect(state.hands[m.neumaId]).toEqual({ hand: 'rest', note: '', raisedSeq: null });
      }
      // Nothing left to grant from the members' side.
      expect(selectNext(state)).toBeNull();
    });

    test("the witness's queued words STAND — order is called to be heard", () => {
      let state = witnessSays(openRoom(), { content: 'hear me out', urgency: 'hold' });
      state = handsReported(state, [{ neumaId: 'n-fenna', hand: 'open', note: 'x' }]);
      state = calledToOrder(state);
      expect(state.witnessQueue).toHaveLength(1);
      expect(selectNext(state)).toMatchObject({ kind: 'witness' });
    });

    test('the ordered state is frozen like every other', () => {
      const state = calledToOrder(openRoom());
      expect(Object.isFrozen(state)).toBe(true);
      expect(Object.isFrozen(state.hands)).toBe(true);
    });
  });
});
