/**
 * team-run — the shared coordinated-run harness. Pure decisions around a
 * scripted ask seam (the accepted engine-test pattern: the coordination
 * contract is the unit under test; the real askNeuma path is proven at the
 * lanes that inject it).
 */
import { describe, test, expect } from 'vitest';
import { runCoordinatedTeam, composeRunReport, RUN_RESULT_PART_MAX_CHARS } from '../../backend/services/team-run.js';
import { SIGNOFF_ASK } from '../../backend/services/team-board.js';

const PLAN = [
  { id: 'research', neumaId: 'aethon', role: 'HELM', task: 'find the themes', needs: [] },
  { id: 'draft', neumaId: 'boreas', task: 'write the posts', needs: ['research'] },
];

describe('runCoordinatedTeam', () => {
  test('coordinated: statuses are extracted and STRIPPED, board events follow steps', async () => {
    const briefs = {};
    const events = [];
    const run = await runCoordinatedTeam({
      steps: PLAN,
      goal: 'Ship a week of posts.',
      maxParallel: 2,
      ask: async (neumaId, messages, step) => {
        briefs[step.id] = messages;
        return `work of ${step.id}\nSTATUS:\ndone with ${step.id}`;
      },
      onEvent: (e) => events.push(e),
    });

    // The check-in reached the board, never the work product.
    expect(run.results.research).toBe('work of research');
    expect(run.statuses.draft).toBe('done with draft');
    expect(run.results.draft).not.toContain('STATUS:');

    // A board as each member STARTS (it says working), then step + board per
    // completion — and the one sign-off passes as the member's torch.
    expect(events.map((e) => e.type)).toEqual(['board', 'step', 'board', 'torch', 'board', 'step', 'board', 'torch']);
    expect(events[0].board.find((e) => e.id === 'research').state).toBe('working');
    expect(events[1].id).toBe('research');
    const lastBoard = events.filter((e) => e.type === 'board').at(-1).board;
    expect(lastBoard.every((e) => e.state === 'done')).toBe(true);

    // Every brief carried the goal and the ONE sign-off ask (no TORCH ask,
    // no line counts); the dependent step's brief carried the live board.
    for (const msgs of Object.values(briefs)) {
      const text = JSON.stringify(msgs);
      expect(text).toContain('Ship a week of posts.');
      expect(text).toContain(JSON.stringify(SIGNOFF_ASK).slice(1, -1));
      expect(text).not.toContain('"TORCH:"');
      expect(text).not.toMatch(/\d-\d short lines/);
    }
    expect(JSON.stringify(briefs.draft)).toContain('TEAM BOARD');
  });

  test('uncoordinated (no goal): raw outputs pass through, no board events', async () => {
    const events = [];
    const run = await runCoordinatedTeam({
      steps: PLAN,
      goal: null,
      maxParallel: 1,
      ask: async (_n, _m, step) => `raw ${step.id}\nSTATUS:\nnever extracted\nTORCH:\nnever extracted either`,
      onEvent: (e) => events.push(e),
    });
    expect(run.results.research).toContain('STATUS:'); // untouched — legacy contract
    expect(run.results.research).toContain('TORCH:');
    expect(run.statuses).toEqual({});
    expect(run.torches).toEqual({});
    expect(events.every((e) => e.type === 'step')).toBe(true);
  });

  test('torch-passing: extracted, stripped, relayed to the SAME member\'s next instance', async () => {
    // One member holds both steps, dependency-ordered — the relay case.
    const relay = [
      { id: 'research', neumaId: 'aethon', role: 'HELM', task: 'find the themes', needs: [] },
      { id: 'draft', neumaId: 'aethon', task: 'write the posts', needs: ['research'] },
    ];
    const briefs = {};
    const events = [];
    const run = await runCoordinatedTeam({
      steps: relay,
      goal: 'Ship a week of posts.',
      maxParallel: 1,
      ask: async (_n, messages, step) => {
        briefs[step.id] = JSON.stringify(messages);
        return `work of ${step.id}\nSTATUS:\nstanding at ${step.id}\nTORCH:\npicked themes A and B\npick up at the drafting`;
      },
      onEvent: (e) => events.push(e),
    });

    // Coordination never leaks into the work product — torch AND status both stripped.
    expect(run.results.research).toBe('work of research');
    expect(run.results.draft).toBe('work of draft');
    // The status ABOVE the torch is still extracted (order: torch first, then status).
    expect(run.statuses.research).toBe('standing at research');
    // The member's latest torch is returned, keyed by the BEING, not the step.
    expect(run.torches).toEqual({ aethon: 'picked themes A and B\npick up at the drafting' });

    // A member that still writes its own TORCH keeps it as the baton; only the
    // SECOND instance receives it, as its own words with named provenance.
    expect(briefs.research).not.toContain('Your torch from your last instance');
    expect(briefs.draft).toContain('Your torch from your last instance');
    expect(briefs.draft).toContain('picked themes A and B');

    // board (working) at start, then step → board → torch per completion.
    expect(events.map((e) => e.type)).toEqual(['board', 'step', 'board', 'torch', 'board', 'step', 'board', 'torch']);
    expect(events[3]).toMatchObject({ type: 'torch', id: 'research', neumaId: 'aethon' });
  });

  test('parallel same-member steps are SIMULTANEOUS instances — neither sees the other\'s torch (echo RQ, r1)', async () => {
    // Both steps are ready in the same scheduling batch (maxParallel 2, no
    // needs): briefs are assembled synchronously before either ask resolves,
    // so the relay is deterministic — a torch only reaches a brief assembled
    // AFTER it was posted, never a sibling in flight.
    const briefs = {};
    let releaseA;
    const gateA = new Promise((r) => { releaseA = r; });
    const run = await runCoordinatedTeam({
      steps: [
        { id: 'left', neumaId: 'aethon', task: 'one lane', needs: [] },
        { id: 'right', neumaId: 'aethon', task: 'another lane', needs: [] },
      ],
      goal: 'Both lanes at once.',
      maxParallel: 2,
      ask: async (_n, messages, step) => {
        briefs[step.id] = JSON.stringify(messages);
        if (step.id === 'left') { await gateA; return 'work L\nTORCH:\nleft torch'; }
        releaseA(); // right finishes first, THEN left — completion order pinned
        return 'work R\nTORCH:\nright torch';
      },
      onEvent: () => {},
    });
    expect(briefs.left).not.toContain('Your torch from your last instance');
    expect(briefs.right).not.toContain('Your torch from your last instance');
    // The member's record keeps the LAST completion's torch (left, gated to finish second).
    expect(run.torches).toEqual({ aethon: 'left torch' });
  });

  test('RESUME: prior truth seeds the run — completed stands, the baton re-arms', async () => {
    const plan = [
      { id: 'research', neumaId: 'aethon', role: 'HELM', task: 'find the themes', needs: [] },
      { id: 'draft', neumaId: 'aethon', task: 'write the posts', needs: ['research'] },
    ];
    const briefs = {};
    const asked = [];
    const run = await runCoordinatedTeam({
      steps: plan,
      goal: 'Ship it.',
      maxParallel: 1,
      resume: {
        completed: { research: 'themes A and B' },
        statuses: { research: 'themes picked' },
        torches: { aethon: 'pick up at the drafting' },
      },
      ask: async (_n, messages, step) => {
        asked.push(step.id);
        briefs[step.id] = JSON.stringify(messages);
        return 'posts done\nSTATUS:\nready\nTORCH:\nnext time: schedule them';
      },
      onEvent: () => {},
    });
    expect(asked).toEqual(['draft']); // the completed step is never re-asked
    expect(briefs.draft).toContain('themes A and B'); // prior output feeds the brief
    expect(briefs.draft).toContain('Your torch from your last instance');
    expect(briefs.draft).toContain('pick up at the drafting'); // the baton survived the drop
    expect(run.results.research).toBe('themes A and B');
    expect(run.statuses.research).toBe('themes picked'); // the prior check-in stands
    expect(run.torches.aethon).toBe('next time: schedule them'); // and moves forward
  });

  test('resume keeps the torch of a member who only ran in the DROPPED instance (echo RQ, r3)', async () => {
    // Member 'aethon' finished before the drop; only 'boreas' runs now. The
    // close's torch record must still carry aethon's baton — result.torches
    // is seeded from the prior truth, so a wholesale replace at close loses
    // nothing.
    const run = await runCoordinatedTeam({
      steps: [
        { id: 'pick', neumaId: 'aethon', task: 'done before the drop', needs: [] },
        { id: 'name', neumaId: 'boreas', task: 'runs now', needs: ['pick'] },
      ],
      goal: 'Survive the drop with the baton intact.',
      maxParallel: 1,
      resume: {
        completed: { pick: 'blue' },
        statuses: { pick: 'stood here' },
        torches: { aethon: 'my torch from before the drop' },
      },
      ask: async () => 'an object\nSTATUS:\nfine\nTORCH:\nboreas torch',
      onEvent: () => {},
    });
    expect(run.torches.aethon).toBe('my torch from before the drop'); // survived untouched
    expect(run.torches.boreas).toBe('boreas torch');
  });

  test('continueOnFailure: the team survives one member — board says FAILED, failures/skipped ride the result', async () => {
    const plan = [
      { id: 'a', neumaId: 'aethon', task: 'fails', needs: [] },
      { id: 'b', neumaId: 'boreas', task: 'independent', needs: [] },
      { id: 'c', neumaId: 'aethon', task: 'needs a', needs: ['a'] },
    ];
    const events = [];
    const run = await runCoordinatedTeam({
      steps: plan,
      goal: 'Survive a drop.',
      maxParallel: 2,
      continueOnFailure: true,
      ask: async (_n, _m, step) => {
        if (step.id === 'a') throw new Error('conduit dropped mid-thought');
        await new Promise((r) => setImmediate(r)); // a settles first — board order deterministic
        return `work ${step.id}\nSTATUS:\nfine`;
      },
      onEvent: (e) => events.push(e),
    });
    expect(run.results.b).toBe('work b');
    expect(run.results.a).toBeUndefined();
    expect(run.failures).toEqual({ a: 'conduit dropped mid-thought' });
    expect(run.skipped).toEqual(['c']); // its prerequisite failed; it never pretended to run
    const lastBoard = events.filter((e) => e.type === 'board').at(-1).board;
    expect(lastBoard.find((e) => e.id === 'a').state).toBe('failed'); // the board never says WAITING for a dead step
    expect(lastBoard.find((e) => e.id === 'c').state).toBe('waiting');
  });

  test('a part that is only a check-in is a FAILED part — never "done" on nothing (2026-10-10)', async () => {
    const plan = [
      { id: 'a', neumaId: 'aethon', task: 'research', needs: [] },
      { id: 'b', neumaId: 'boreas', task: 'consolidate', needs: ['a'] },
    ];
    const asked = [];
    const run = await runCoordinatedTeam({
      steps: plan,
      goal: 'Never build on a blank.',
      maxParallel: 1,
      continueOnFailure: true,
      ask: async (_n, _m, step) => {
        asked.push(step.id);
        return '\n\nSTATUS:\nall done, files written';
      },
    });
    expect(run.failures).toEqual({ a: 'a returned no work product' });
    expect(run.skipped).toEqual(['b']);
    expect(asked).toEqual(['a']); // the consolidation never ran on a blank
    const report = composeRunReport(run, plan, { aethon: 'Aethon' });
    expect(report).toMatch(/^Your team did not finish: 0 of 2 steps completed/);
    expect(report).toContain('— a (Aethon): FAILED — a returned no work product');
    expect(report).toContain('— b: NEVER STARTED');
  });

  test('the ONE sign-off is the baton: a member that posts only STATUS hands it to its next instance', async () => {
    const events = [];
    const briefs = {};
    const run = await runCoordinatedTeam({
      steps: [
        { id: 'a', neumaId: 'aethon', task: 'first', needs: [] },
        { id: 'b', neumaId: 'aethon', task: 'second', needs: ['a'] },
      ],
      goal: 'A goal.',
      maxParallel: 1,
      ask: async (_n, messages, step) => {
        briefs[step.id] = JSON.stringify(messages);
        return `work of ${step.id}\nSTATUS:\nfine at ${step.id}`;
      },
      onEvent: (e) => events.push(e),
    });
    expect(run.torches).toEqual({ aethon: 'fine at b' });
    expect(events.filter((e) => e.type === 'torch').map((e) => e.torch)).toEqual(['fine at a', 'fine at b']);
    expect(briefs.b).toContain(JSON.stringify('Your torch from your last instance:\nfine at a').slice(1, -1));
  });

  test('a member that posts NO sign-off relays nothing — null-safe, never invented', async () => {
    const events = [];
    const run = await runCoordinatedTeam({
      steps: [{ id: 'a', neumaId: 'aethon', task: 'first', needs: [] }],
      goal: 'A goal.',
      maxParallel: 1,
      ask: async () => 'work, and no sign-off at all',
      onEvent: (e) => events.push(e),
    });
    expect(run.torches).toEqual({});
    expect(events.some((e) => e.type === 'torch')).toBe(false);
  });

  test('the coordinated brief text is byte-identical to the route lane\'s (shared buildBrief)', async () => {
    // The harness delegates to buildBrief — pin the load-bearing opening so a
    // drift between what the witness's composer sends and what a LEAD's
    // team_run sends is impossible to miss.
    let brief;
    await runCoordinatedTeam({
      steps: [{ id: 'solo', neumaId: 'aethon', task: 'do the thing', needs: [] }],
      goal: 'The goal.',
      maxParallel: 1,
      ask: async (_n, messages) => { brief = messages; return 'ok\nSTATUS:\nfine'; },
    });
    const text = JSON.stringify(brief);
    expect(text).toContain("The team's GOAL");
    expect(text).toContain(JSON.stringify(SIGNOFF_ASK).slice(1, -1));
  });
  test('evidence-step throws and aggregate rejections cannot rerun or discard committed work', async () => {
    let asks = 0;
    const commits = [];
    const metricTypes = [];
    const run = await runCoordinatedTeam({
      steps: [{ id: 'solo', neumaId: 'aethon', task: 'finish once', needs: [] }],
      maxParallel: 1,
      ask: async () => { asks += 1; return 'one completed result'; },
      onEvent: (event) => { if (event.type === 'step') commits.push(event.id); },
      options: {
        evidence: {
          mode: 'candidate',
          onMetrics: (metric) => {
            metricTypes.push(metric.type);
            if (metric.type === 'evidence-step') throw new Error('private evidence observer text');
            if (metric.type === 'team-run') return Promise.reject(new TypeError('private aggregate observer text'));
          },
        },
      },
    });
    await Promise.resolve();
    expect([asks, commits]).toEqual([1, ['solo']]);
    expect(run.results).toEqual({ solo: 'one completed result' });
    expect(metricTypes).toEqual(['dependency-budget', 'evidence-step', 'team-run']);
  });

});

describe('composeRunReport', () => {
  const run = {
    results: { research: 'five themes', draft: 'ten posts' },
    order: ['research', 'draft'],
    statuses: { draft: 'ready to schedule' },
  };

  test('attributes every part in completion order with names, roles, statuses', () => {
    const report = composeRunReport(run, PLAN, { aethon: 'Aethon', boreas: 'Boreas' });
    expect(report).toContain('all 2 steps');
    expect(report.indexOf('research — Aethon (HELM)')).toBeLessThan(report.indexOf('draft — Boreas'));
    expect(report).toContain('five themes');
    expect(report).toContain('Their status: ready to schedule');
  });

  test('clips an overlong part at the boundary and says so', () => {
    const big = {
      results: { solo: 'x'.repeat(RUN_RESULT_PART_MAX_CHARS + 500) },
      order: ['solo'],
      statuses: {},
    };
    const report = composeRunReport(big, [{ id: 'solo', neumaId: 'a', task: 't', needs: [] }], {});
    expect(report).toContain('[part truncated');
    expect(report.length).toBeLessThan(RUN_RESULT_PART_MAX_CHARS + 400);
  });

  test('falls back to neumaId when no display name is known', () => {
    const report = composeRunReport(run, PLAN, {});
    expect(report).toContain('research — aethon (HELM)');
  });

  test('members\' final torches close the report, attributed — the LEAD\'s baton for a follow-up', () => {
    const withTorches = { ...run, torches: { boreas: 'posts drafted\npick up at scheduling' } };
    const report = composeRunReport(withTorches, PLAN, { boreas: 'Boreas' });
    expect(report).toContain('Torches — each member\'s own note to its next instance');
    expect(report).toContain('— Boreas: posts drafted\npick up at scheduling');
  });

  test('the ONE sign-off is read once: a torch that IS the member\'s status is not repeated', () => {
    const merged = { ...run, statuses: { draft: 'posts drafted' }, torches: { boreas: 'posts drafted' } };
    const report = composeRunReport(merged, PLAN, { boreas: 'Boreas' });
    expect(report.split('posts drafted').length - 1).toBe(1);
    expect(report).not.toContain('Torches —');
  });

  test('no torches, no torch block — and pre-torch callers (no torches key) still compose', () => {
    expect(composeRunReport(run, PLAN, {})).not.toContain('Torches —');
    expect(composeRunReport({ ...run, torches: {} }, PLAN, {})).not.toContain('Torches —');
  });
});
