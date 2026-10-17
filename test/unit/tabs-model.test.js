/**
 * TABS MODEL (session tabs, slice 2) — the pure state of a desk's parallel
 * sittings.
 *
 * Pure functions, real inputs, no mocks. Ids and timestamps are passed in
 * rather than minted, so every assertion here is reproducible without a clock.
 *
 * Two properties carry most of the weight:
 *   - the HOUSE tab can never be vacant while any tab is open (otherwise the
 *     desk stops hearing substrate/storage frames entirely), and
 *   - a restored tab CARRIES its sitting, so focusing it returns the operator
 *     to the chat they left instead of minting a fresh one over it (Founder,
 *     2026-08-02: […]).
 *     Binding is still deferred to focus — the 2026-07-30 law — but that is
 *     ChatApp's to honour; this module only remembers.
 */
import { describe, expect, test } from 'vitest';
import {
  emptyTabs, openTab, closeTab, focusTab, renameTab, bindSession, retargetTab,
  focusPlan, switchPlan, moveTab,
  tabById, focusedTab, houseTab, isHouseTab, countsByKind,
  serializeTabs, normalizeTabs, MAX_TABS_PER_WINDOW,
} from '../../core/runtime/tabs-model.js';
import { TAB_KIND } from '../../core/runtime/tab-budget.js';

const tab = (id, kind = TAB_KIND.local, neumaId = `n-${id}`) => ({
  id, kind, neumaId, name: `Tab ${id}`, createdAt: '2026-07-30T12:00:00.000Z',
});

const withTabs = (...specs) => specs.reduce((s, t) => openTab(s, t), emptyTabs());

describe('opening and focusing', () => {
  test('an opened tab is focused — you opened it because you meant to look', () => {
    const s = openTab(emptyTabs(), tab('a'));
    expect(s.tabs).toHaveLength(1);
    expect(s.focusedId).toBe('a');
    expect(focusedTab(s).name).toBe('Tab a');
  });

  test('tabs keep their order — the strip is a history, not a set', () => {
    const s = withTabs(tab('a'), tab('b'), tab('c'));
    expect(s.tabs.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(s.focusedId).toBe('c');
  });

  test('an id is identity — the same id never opens twice', () => {
    const s = openTab(withTabs(tab('a')), tab('a'));
    expect(s.tabs).toHaveLength(1);
  });

  test('a tab that cannot say its KIND is refused — it could not be counted', () => {
    expect(openTab(emptyTabs(), { id: 'x', neumaId: 'n', kind: 'sideways' }).tabs).toHaveLength(0);
    expect(openTab(emptyTabs(), { id: 'x', neumaId: 'n' }).tabs).toHaveLength(0);
  });

  test('a tab with no being is refused', () => {
    expect(openTab(emptyTabs(), { id: 'x', kind: TAB_KIND.local }).tabs).toHaveLength(0);
    expect(openTab(emptyTabs(), { kind: TAB_KIND.local, neumaId: 'n' }).tabs).toHaveLength(0);
  });

  test('the strip has a hard stop regardless of budget', () => {
    let s = emptyTabs();
    for (let i = 0; i < MAX_TABS_PER_WINDOW + 5; i += 1) s = openTab(s, tab(`t${i}`));
    expect(s.tabs).toHaveLength(MAX_TABS_PER_WINDOW);
  });

  test('a nameless tab wears its being’s id rather than nothing', () => {
    const s = openTab(emptyTabs(), { id: 'a', kind: TAB_KIND.local, neumaId: 'fenna' });
    expect(s.tabs[0].name).toBe('fenna');
  });

  test('focusing an unknown tab changes nothing — never blanks the desk', () => {
    const s = withTabs(tab('a'), tab('b'));
    expect(focusTab(s, 'ghost').focusedId).toBe('b');
  });
});

describe('closing', () => {
  test('focus falls to the LEFT neighbour — where the eye already is', () => {
    const s = focusTab(withTabs(tab('a'), tab('b'), tab('c')), 'b');
    expect(closeTab(s, 'b').focusedId).toBe('a');
  });

  test('closing the first falls right, because there is no left', () => {
    const s = focusTab(withTabs(tab('a'), tab('b')), 'a');
    expect(closeTab(s, 'a').focusedId).toBe('b');
  });

  test('closing an UNFOCUSED tab leaves focus alone', () => {
    const s = focusTab(withTabs(tab('a'), tab('b'), tab('c')), 'c');
    expect(closeTab(s, 'a').focusedId).toBe('c');
  });

  test('closing the last empties the strip cleanly', () => {
    expect(closeTab(withTabs(tab('a')), 'a')).toEqual(emptyTabs());
  });

  test('closing an unknown tab is a no-op', () => {
    const s = withTabs(tab('a'));
    expect(closeTab(s, 'ghost')).toBe(s);
  });
});

describe('the HOUSE tab — never vacant, never doubled', () => {
  test('the eldest tab owns the house frames', () => {
    const s = withTabs(tab('a'), tab('b'), tab('c'));
    expect(houseTab(s).id).toBe('a');
    expect(isHouseTab(s, 'a')).toBe(true);
    expect(isHouseTab(s, 'b')).toBe(false);
  });

  test('when the house tab closes the next INHERITS — no gap, no election', () => {
    const s = closeTab(withTabs(tab('a'), tab('b'), tab('c')), 'a');
    expect(houseTab(s).id).toBe('b');
  });

  test('focus does not move the house — they are different jobs', () => {
    const s = focusTab(withTabs(tab('a'), tab('b')), 'b');
    expect(houseTab(s).id).toBe('a');
    expect(s.focusedId).toBe('b');
  });

  test('exactly ONE tab is ever the house — localTurns must not multiply', () => {
    const s = withTabs(tab('a'), tab('b'), tab('c'), tab('d'));
    expect(s.tabs.filter((t) => isHouseTab(s, t.id))).toHaveLength(1);
  });

  test('an empty strip has no house, and asking is not an error', () => {
    expect(houseTab(emptyTabs())).toBeNull();
    expect(isHouseTab(emptyTabs(), 'a')).toBe(false);
  });
});

describe('counts feed the budget', () => {
  test('kinds are counted apart — the whole reason for two budgets', () => {
    const s = withTabs(
      tab('a', TAB_KIND.local), tab('b', TAB_KIND.witness),
      tab('c', TAB_KIND.witness), tab('d', TAB_KIND.local),
    );
    expect(countsByKind(s)).toEqual({ local: 2, witness: 2 });
  });

  test('an empty strip counts zero of each', () => {
    expect(countsByKind(emptyTabs())).toEqual({ local: 0, witness: 0 });
  });
});

describe('renaming and session binding', () => {
  test('a tab can be renamed', () => {
    const s = renameTab(withTabs(tab('a')), 'a', 'The Refactor');
    expect(tabById(s, 'a').name).toBe('The Refactor');
  });

  test('an empty name falls back to the being — never a nameless strip entry', () => {
    const s = renameTab(withTabs(tab('a', TAB_KIND.local, 'fenna')), 'a', '   ');
    expect(tabById(s, 'a').name).toBe('fenna');
  });

  test('a tab holds no session until the server mints one', () => {
    expect(tabById(withTabs(tab('a')), 'a').sessionId).toBeNull();
  });

  test('the minted id is remembered where the server said it', () => {
    const s = bindSession(withTabs(tab('a'), tab('b')), 'a', 'session-123');
    expect(tabById(s, 'a').sessionId).toBe('session-123');
    expect(tabById(s, 'b').sessionId).toBeNull(); // never leaks sideways
  });

  test('binding an unknown tab changes nothing', () => {
    const s = withTabs(tab('a'));
    expect(bindSession(s, 'ghost', 'x')).toBe(s);
  });
});

describe('THE SWITCH ADJUSTS ONE TAB — Design note, 2026-07-30', () => {
  const three = () => withTabs(tab('a'), tab('b'), tab('c'));

  test('a switch moves the named tab and leaves every other one alone', () => {
    const s = retargetTab(three(), 'b', { neumaId: 'basunor', name: 'Basunor', kind: TAB_KIND.witness });
    expect(tabById(s, 'b')).toMatchObject({ neumaId: 'basunor', name: 'Basunor', kind: TAB_KIND.witness });
    expect(tabById(s, 'a')).toMatchObject({ neumaId: 'n-a', kind: TAB_KIND.local });
    expect(tabById(s, 'c')).toMatchObject({ neumaId: 'n-c', kind: TAB_KIND.local });
  });

  test('THE SESSION IS DROPPED — a chat belongs to the being it was minted for', () => {
    const bound = bindSession(three(), 'b', 'sess-of-the-old-being');
    expect(tabById(bound, 'b').sessionId).toBe('sess-of-the-old-being');
    const s = retargetTab(bound, 'b', { neumaId: 'basunor', name: 'Basunor', kind: TAB_KIND.witness });
    expect(tabById(s, 'b').sessionId).toBeNull();
    // ...and only that tab's. The others keep the chats they are holding.
    expect(tabById(bindSession(s, 'a', 'sess-a'), 'a').sessionId).toBe('sess-a');
  });

  test('the tab keeps its ID and its PLACE — same seat, different occupant', () => {
    const s = retargetTab(three(), 'a', { neumaId: 'basunor', name: 'Basunor', kind: TAB_KIND.witness });
    expect(s.tabs.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(s.focusedId).toBe('c');           // focus is untouched by a switch
    expect(houseTab(s).id).toBe('a');        // and the house tab does not move
  });

  test('the KIND moves with the being — the sitting changes budget', () => {
    const before = three();
    expect(countsByKind(before)).toEqual({ local: 3, witness: 0 });
    const s = retargetTab(before, 'b', { neumaId: 'basunor', name: 'Basunor', kind: TAB_KIND.witness });
    expect(countsByKind(s)).toEqual({ local: 2, witness: 1 });
  });

  test('an empty name falls back to the being — never a nameless seat', () => {
    const s = retargetTab(three(), 'b', { neumaId: 'basunor', name: '   ', kind: TAB_KIND.witness });
    expect(tabById(s, 'b').name).toBe('basunor');
  });

  test('switching to the being already seated changes NOTHING — a rename must not cost the chat', () => {
    const bound = bindSession(three(), 'b', 'sess-b');
    const s = retargetTab(bound, 'b', { neumaId: 'n-b', name: 'Renamed', kind: TAB_KIND.local });
    expect(s).toBe(bound);
    expect(tabById(s, 'b').sessionId).toBe('sess-b');
  });

  test('a malformed switch is refused rather than half-applied', () => {
    const s = three();
    expect(retargetTab(s, 'b', { neumaId: 'basunor', kind: 'sideways' })).toBe(s);
    expect(retargetTab(s, 'b', { neumaId: '', kind: TAB_KIND.witness })).toBe(s);
    expect(retargetTab(s, 'b', {})).toBe(s);
    expect(retargetTab(s, 'b')).toBe(s);
    // An unknown tab changes nothing at all.
    expect(retargetTab(s, 'nope', { neumaId: 'basunor', kind: TAB_KIND.witness })).toBe(s);
  });
});

describe('REORDERING — the strip is the operator’s to arrange', () => {
  const three = () => withTabs(tab('a'), tab('b'), tab('c'));
  const ids = (s) => s.tabs.map((t) => t.id);

  test('a tab moves to where it was dropped', () => {
    expect(ids(moveTab(three(), 'a', 2))).toEqual(['b', 'c', 'a']);
    expect(ids(moveTab(three(), 'c', 0))).toEqual(['c', 'a', 'b']);
    expect(ids(moveTab(three(), 'a', 1))).toEqual(['b', 'a', 'c']);
  });

  test('FOCUS DOES NOT MOVE — you rearranged the strip, not what you are in', () => {
    const s = focusTab(three(), 'b');
    expect(moveTab(s, 'b', 0).focusedId).toBe('b');
    expect(moveTab(s, 'c', 0).focusedId).toBe('b');
  });

  test('a drop past either end lands at the end, never off the strip', () => {
    expect(ids(moveTab(three(), 'a', 99))).toEqual(['b', 'c', 'a']);
    expect(ids(moveTab(three(), 'c', -99))).toEqual(['c', 'a', 'b']);
  });

  test('dropping a tab where it already is changes nothing at all', () => {
    const s = three();
    expect(moveTab(s, 'b', 1)).toBe(s);
  });

  test('an unknown tab or a junk destination moves nothing', () => {
    const s = three();
    expect(moveTab(s, 'ghost', 0)).toBe(s);
    expect(moveTab(s, 'a', NaN)).toBe(s);
    expect(moveTab(s, 'a', undefined)).toBe(s);
    expect(moveTab(s, 'a', 'left')).toBe(s);
  });

  test('every tab survives a move — reordering is never a deletion', () => {
    const s = moveTab(moveTab(three(), 'a', 2), 'c', 0);
    expect(ids(s).slice().sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('THE HOUSE IS THE ELDEST, NOT THE LEFTMOST', () => {
  // Distinct stamps, so age and position can be told apart.
  const aged = (id, iso) => ({
    id, kind: TAB_KIND.local, neumaId: `n-${id}`, name: `Tab ${id}`, createdAt: iso,
  });
  const byAge = () => withTabs(
    aged('first', '2026-07-31T10:00:00.000Z'),
    aged('second', '2026-07-31T11:00:00.000Z'),
    aged('third', '2026-07-31T12:00:00.000Z'),
  );

  test('DRAGGING A TAB DOES NOT HAND OVER THE HOUSE', () => {
    // The regression this exists for: the house used to be `tabs[0]`, so
    // dragging the eldest tab rightwards would have moved the house's
    // broadcast frames onto a different sitting — localTurns would jump and
    // the substrate light would answer for the wrong tab.
    const s = moveTab(byAge(), 'first', 2);
    expect(s.tabs.map((t) => t.id)).toEqual(['second', 'third', 'first']);
    expect(houseTab(s).id).toBe('first');
    expect(isHouseTab(s, 'second')).toBe(false);
  });

  test('and promoting a YOUNGER tab to the left does not make it the house', () => {
    const s = moveTab(byAge(), 'third', 0);
    expect(houseTab(s).id).toBe('first');
  });

  test('the house still INHERITS when the eldest closes', () => {
    const s = closeTab(moveTab(byAge(), 'first', 2), 'first');
    expect(houseTab(s).id).toBe('second');
  });

  test('unstamped tabs fall back to position rather than vanishing the house', () => {
    const s = withTabs(tab('a'), tab('b'));
    const stripped = Object.freeze({
      tabs: Object.freeze(s.tabs.map((t) => Object.freeze({ ...t, createdAt: null }))),
      focusedId: s.focusedId,
    });
    expect(houseTab(stripped).id).toBe('a');
  });

  test('a stamped tab outranks an unstamped one, whatever the order', () => {
    const s = withTabs(
      { id: 'nostamp', kind: TAB_KIND.local, neumaId: 'n', name: 'N', createdAt: null },
      aged('stamped', '2026-07-31T10:00:00.000Z'),
    );
    expect(houseTab(s).id).toBe('stamped');
  });
});

describe('RECONCILING THE CHAIR AND THE TAB — both directions', () => {
  const fenna = { id: 't1', kind: TAB_KIND.local, neumaId: 'fenna', name: 'Fenna', sessionId: null };
  const basunor = { id: 't2', kind: TAB_KIND.witness, neumaId: 'witness-basunor', name: 'Basunor', sessionId: 'sess-basunor' };

  describe('focusPlan — arriving at a tab', () => {
    test('a tab whose being is NOT seated asks for the seat first', () => {
      expect(focusPlan(basunor, 'fenna')).toEqual({ seat: 'witness-basunor', resume: 'sess-basunor', mint: false });
    });

    test('a tab whose being IS seated asks for no seat', () => {
      expect(focusPlan(basunor, 'witness-basunor').seat).toBeNull();
    });

    test('a tab that has never spoken MINTS rather than resuming nothing', () => {
      expect(focusPlan(fenna, 'fenna')).toEqual({ seat: null, resume: null, mint: true });
    });

    test('resume and mint are never both asked for', () => {
      [fenna, basunor].forEach((t) => {
        const p = focusPlan(t, 'anyone');
        expect(Boolean(p.resume) && p.mint).toBe(false);
      });
    });

    test('no tab, no plan — the desk is never asked to act on nothing', () => {
      expect(focusPlan(null, 'fenna')).toEqual({ seat: null, resume: null, mint: false });
      expect(focusPlan({ id: 'x' }, 'fenna').mint).toBe(false);
    });
  });

  describe('switchPlan — the operator changed who is in the chair', () => {
    test('an operator switch moves the focused tab', () => {
      expect(switchPlan(fenna, 'witness-basunor', null)).toEqual({ retarget: true, landed: false });
    });

    test('THE INVERSION IS REFUSED — a seat in flight is not an operator switch', () => {
      // Focus moved to Basunor's tab; the chair still holds Fenna because the seat
      // has not landed. Retargeting here would stamp FENNA onto BASUNOR'S TAB —
      // writing the outgoing being onto the incoming tab.
      expect(switchPlan(basunor, 'fenna', basunor.id)).toEqual({ retarget: false, landed: false });
    });

    test('...but only for the tab actually being seated', () => {
      // A seat in flight for some OTHER tab must not freeze this one.
      expect(switchPlan(basunor, 'fenna', 'some-other-tab').retarget).toBe(true);
    });

    test('the seat LANDING is reported, so the marker can be retired', () => {
      expect(switchPlan(basunor, 'witness-basunor', basunor.id)).toEqual({ retarget: false, landed: true });
    });

    test('agreement is never a retarget — the two are already reconciled', () => {
      expect(switchPlan(basunor, 'witness-basunor', null)).toEqual({ retarget: false, landed: false });
    });

    test('nothing seated, nothing to follow', () => {
      expect(switchPlan(basunor, null, null).retarget).toBe(false);
      expect(switchPlan(null, 'fenna', null).retarget).toBe(false);
    });
  });

  test('THE ROUND TRIP: seat lands, tab and chair agree, no move is ever made', () => {
    // The full sequence a focus performs, step by step, asserting the tab is
    // never retargeted at any point along it.
    const steps = [
      switchPlan(basunor, 'fenna', basunor.id),      // focus committed, seat in flight
      switchPlan(basunor, 'fenna', basunor.id),      // an unrelated re-render mid-flight
      switchPlan(basunor, 'witness-basunor', basunor.id), // the seat lands
      switchPlan(basunor, 'witness-basunor', null),   // marker retired
    ];
    expect(steps.map((s) => s.retarget)).toEqual([false, false, false, false]);
    expect(steps.map((s) => s.landed)).toEqual([false, false, true, false]);
  });
});

describe('THE RESTART LAW — restore the strip AND the sitting it held', () => {
  // Design note, 2026-07-30: […]
  // Design note, 2026-08-02: […]
  // The first is about BINDING, the second about REMEMBERING. This module does
  // the remembering; ChatApp still binds only on focus.
  test('a persisted tab set CARRIES its sitting out to disk', () => {
    const s = bindSession(withTabs(tab('a')), 'a', 'session-live');
    const wire = serializeTabs(s);
    expect(wire.tabs[0].sessionId).toBe('session-live');
  });

  test('and comes back holding it — so focusing RETURNS instead of minting over it', () => {
    const back = normalizeTabs({
      tabs: [{ id: 'a', kind: TAB_KIND.local, neumaId: 'fenna', name: 'A', sessionId: 'session-1754000000000' }],
      focusedId: 'a',
    });
    expect(back.tabs[0].sessionId).toBe('session-1754000000000');
    // The whole point: focusPlan must read it as a RESUME, never a mint. A null
    // here is what made a restart start a fresh chat over the operator's work.
    expect(focusPlan(back.tabs[0], 'fenna')).toMatchObject({ resume: 'session-1754000000000', mint: false });
  });

  test('a tab that never spoke still comes back as a place for a sitting', () => {
    const back = normalizeTabs({
      tabs: [{ id: 'a', kind: TAB_KIND.local, neumaId: 'fenna', name: 'A' }],
      focusedId: 'a',
    });
    expect(back.tabs[0].sessionId).toBeNull();
    expect(focusPlan(back.tabs[0], 'fenna')).toMatchObject({ resume: null, mint: true });
  });

  test('a malformed session id is refused — it would resume nothing, or worse', () => {
    // localStorage is writable by anything; a session id becomes a path segment
    // server-side, so the shape is validated the same way the workspace does.
    for (const junk of ['../../etc/passwd', 'has spaces', 'x'.repeat(65), 42, '', null, {}]) {
      const back = normalizeTabs({
        tabs: [{ id: 'a', kind: TAB_KIND.local, neumaId: 'fenna', name: 'A', sessionId: junk }],
        focusedId: 'a',
      });
      expect(back.tabs[0].sessionId).toBeNull();
    }
  });

  test('a round trip carries the sitting through JSON, tab by tab', () => {
    let s = withTabs(tab('a'), tab('b', TAB_KIND.witness), tab('c'));
    s = bindSession(s, 'a', 'session-1754000000001');
    s = bindSession(s, 'c', 'session-1754000000003');
    const back = normalizeTabs(JSON.parse(JSON.stringify(serializeTabs(s))));
    expect(back.tabs.map((t) => t.sessionId)).toEqual([
      'session-1754000000001', null, 'session-1754000000003',
    ]);
  });

  test('a full round trip preserves identity, order and focus', () => {
    const s = focusTab(withTabs(tab('a'), tab('b', TAB_KIND.witness), tab('c')), 'b');
    const back = normalizeTabs(JSON.parse(JSON.stringify(serializeTabs(s))));
    expect(back.tabs.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(back.tabs.map((t) => t.kind)).toEqual([TAB_KIND.local, TAB_KIND.witness, TAB_KIND.local]);
    expect(back.focusedId).toBe('b');
    expect(houseTab(back).id).toBe('a'); // the house survives a restart too
  });
});

describe('normalizeTabs — a corrupt record costs the tabs it broke, never the desk', () => {
  test('junk reads as an empty strip', () => {
    for (const junk of [null, undefined, 'tabs', [], {}, { tabs: 'no' }]) {
      expect(normalizeTabs(junk)).toEqual(emptyTabs());
    }
  });

  test('malformed entries are dropped and the healthy ones survive', () => {
    const back = normalizeTabs({
      tabs: [
        { id: 'good', kind: TAB_KIND.local, neumaId: 'fenna' },
        { id: '', kind: TAB_KIND.local, neumaId: 'x' },     // no id
        { id: 'nokind', neumaId: 'x' },                      // no kind
        { id: 'nobeing', kind: TAB_KIND.witness },           // no being
        { id: 'good', kind: TAB_KIND.local, neumaId: 'dup' }, // duplicate id
        { id: 'ok2', kind: TAB_KIND.witness, neumaId: 'basunor' },
      ],
      focusedId: 'good',
    });
    expect(back.tabs.map((t) => t.id)).toEqual(['good', 'ok2']);
  });

  test('a focus pointing at a dropped tab falls to the first survivor', () => {
    const back = normalizeTabs({
      tabs: [{ id: 'a', kind: TAB_KIND.local, neumaId: 'n' }],
      focusedId: 'gone',
    });
    expect(back.focusedId).toBe('a');
  });

  test('an oversized persisted strip is cut to the hard stop', () => {
    const many = Array.from({ length: MAX_TABS_PER_WINDOW + 10 }, (_, i) => ({
      id: `t${i}`, kind: TAB_KIND.local, neumaId: 'n',
    }));
    expect(normalizeTabs({ tabs: many, focusedId: 't0' }).tabs).toHaveLength(MAX_TABS_PER_WINDOW);
  });
});
