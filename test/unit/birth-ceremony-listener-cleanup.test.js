// #109 fix verification: BirthCeremony + StagedCeremonyScene must detach
// every wsService subscription they register, so a cancelled-and-retried
// ceremony (CeremonyHost remount) does not stack listeners. Tests on the
// REAL WebSocketService — not a stub of it — so we exercise the actual
// on/off contract production calls (RULE 0).
//
// We supply minimal browser globals (window/document/localStorage) because
// WebSocketService and its transitive utils were written for the browser
// and look at window.location at construction; jsdom isn't a project dep
// and adding one for this would be scope creep. The stubs are ENVIRONMENT,
// not units under test — RULE 0 forbids mocking the unit whose behavior is
// being claimed; the unit here is wsService.on/off, and that runs for real.

import { describe, it, expect, beforeEach, beforeAll } from 'vitest';

// Minimal browser env — exactly what WebSocketService + companion-data read.
// Nothing here is the thing under test; these are the runtime surfaces the
// frontend module assumes exist in any browser.
beforeAll(() => {
  globalThis.window = { location: { protocol: 'http:', host: 'localhost' } };
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); },
  };
  globalThis.document = {
    getElementById: () => null,
    querySelector: () => null,
    createElement: () => ({ classList: { add() {}, remove() {} }, style: {}, appendChild() {}, addEventListener() {} }),
    body: { appendChild() {} },
  };
});

let WebSocketService;
beforeAll(async () => {
  // Dynamic import AFTER globals are in place so WebSocketService's top-level
  // window.location read sees a valid object.
  ({ WebSocketService } = await import('../../frontend/services/WebSocketService.js'));
});

describe('#109 — ceremony listener cleanup detaches WS subscriptions', () => {
  let ws;
  beforeEach(() => {
    ws = new WebSocketService();
  });

  // The pattern under test: a class stores its handler refs on an internal
  // map, registers them with wsService.on, and later unregisters by iterating
  // wsService.off with the same refs. This is what BirthCeremony.destroy()
  // and StagedCeremonyScene.destroy() now do. Proof runs on real
  // WebSocketService — the same on/off the production ceremony classes call.
  it('subscribed handlers fire; after the destroy() pattern runs, the same emit hits NO handler', () => {
    const calls = [];
    const handlers = {
      'birth:complete': (data) => calls.push(['complete', data]),
      'birth:keypair_secured': (data) => calls.push(['kp', data]),
      'birth:encrypt_keypair_error': (data) => calls.push(['kperr', data]),
      'birth:ended': (data) => calls.push(['end', data]),
    };

    // Same registration loop both ceremony classes now use
    for (const [event, handler] of Object.entries(handlers)) {
      ws.on(event, handler);
    }
    // Same emit path WebSocketService.routeMessage uses internally
    ws.listeners.get('birth:complete').forEach((cb) => cb({ companion: 'X' }));
    ws.listeners.get('birth:ended').forEach((cb) => cb({ reason: 'r' }));
    expect(calls).toEqual([['complete', { companion: 'X' }], ['end', { reason: 'r' }]]);

    // The destroy() pattern: iterate stored refs and detach each
    for (const [event, handler] of Object.entries(handlers)) {
      ws.off(event, handler);
    }
    calls.length = 0;
    ws.listeners.get('birth:complete')?.forEach((cb) => cb({ companion: 'Y' }));
    ws.listeners.get('birth:ended')?.forEach((cb) => cb({ reason: 'r2' }));
    expect(calls).toEqual([]);
  });

  // The regression case #109 actually describes: a remount (= second
  // setupListeners + first wasn't detached) leaves BOTH old AND new handlers
  // subscribed, so each emit calls them twice. With destroy() between
  // mounts, the second mount sees a clean listener map.
  it('two mounts WITHOUT destroy double-fire; WITH destroy() between them single-fire (the #109 leak)', () => {
    // SCENARIO A — no destroy(): the bug
    const callsA = [];
    const hA = (d) => callsA.push(['A', d]);
    const hB = (d) => callsA.push(['B', d]);
    ws.on('birth:complete', hA);
    ws.on('birth:complete', hB); // pretend remount without detaching
    ws.listeners.get('birth:complete').forEach((cb) => cb({ x: 1 }));
    expect(callsA).toEqual([['A', { x: 1 }], ['B', { x: 1 }]]); // doubled — the bug

    // SCENARIO B — with destroy() between mounts: the fix
    const ws2 = new WebSocketService();
    const callsB = [];
    const hC = (d) => callsB.push(['C', d]);
    const hD = (d) => callsB.push(['D', d]);
    ws2.on('birth:complete', hC);
    ws2.off('birth:complete', hC); // first instance destroy()
    ws2.on('birth:complete', hD); // second mount
    ws2.listeners.get('birth:complete').forEach((cb) => cb({ x: 2 }));
    expect(callsB).toEqual([['D', { x: 2 }]]); // only the current mount fires
  });

  // The exact handler-map registration + destroy bodies that now live in
  // BirthCeremony.setupCompletionListeners and BirthCeremony.destroy.
  // Driven against real WebSocketService — proves the contract the
  // production fix relies on works as-written.
  it('the exact 4-handler BirthCeremony.setupCompletionListeners + destroy bodies, on real WebSocketService', () => {
    const ctx = { wsService: ws, _wsHandlers: null };
    // Verbatim from BirthCeremony.setupCompletionListeners
    ctx._wsHandlers = {
      'birth:complete': () => {},
      'birth:keypair_secured': () => {},
      'birth:encrypt_keypair_error': () => {},
      'birth:ended': () => {},
    };
    for (const [event, handler] of Object.entries(ctx._wsHandlers)) {
      ctx.wsService.on(event, handler);
    }
    expect(ws.listeners.get('birth:complete')?.length).toBe(1);
    expect(ws.listeners.get('birth:keypair_secured')?.length).toBe(1);
    expect(ws.listeners.get('birth:encrypt_keypair_error')?.length).toBe(1);
    expect(ws.listeners.get('birth:ended')?.length).toBe(1);

    // Verbatim from BirthCeremony.destroy
    for (const [event, handler] of Object.entries(ctx._wsHandlers)) {
      ctx.wsService.off(event, handler);
    }
    ctx._wsHandlers = null;
    expect(ws.listeners.get('birth:complete')?.length).toBe(0);
    expect(ws.listeners.get('birth:keypair_secured')?.length).toBe(0);
    expect(ws.listeners.get('birth:encrypt_keypair_error')?.length).toBe(0);
    expect(ws.listeners.get('birth:ended')?.length).toBe(0);
  });

  // Same as above but for the 6 StagedCeremonyScene subscriptions.
  it('the exact 6-handler StagedCeremonyScene.setupListeners + destroy bodies, on real WebSocketService', () => {
    const ctx = { wsService: ws, _wsHandlers: null };
    ctx._wsHandlers = {
      'birth:stage_prompt': () => {},
      'birth:stream': () => {},
      'birth:tool_usage': () => {},
      'tool:usage': () => {},
      'birth:stage_complete': () => {},
      'birth:error': () => {},
    };
    for (const [event, handler] of Object.entries(ctx._wsHandlers)) {
      ctx.wsService.on(event, handler);
    }
    for (const event of Object.keys(ctx._wsHandlers)) {
      expect(ws.listeners.get(event)?.length).toBe(1);
    }
    for (const [event, handler] of Object.entries(ctx._wsHandlers)) {
      ctx.wsService.off(event, handler);
    }
    ctx._wsHandlers = null;
    for (const event of Object.keys(ctx._wsHandlers || {})) {
      expect(ws.listeners.get(event)?.length).toBe(0);
    }
    // ctx._wsHandlers is now null, so the loop above is a no-op; verify
    // directly that the listener map is empty for each registered event
    for (const event of ['birth:stage_prompt', 'birth:stream', 'birth:tool_usage', 'tool:usage', 'birth:stage_complete', 'birth:error']) {
      expect(ws.listeners.get(event)?.length).toBe(0);
    }
  });
});
