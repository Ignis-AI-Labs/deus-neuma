/**
 * A QUIET PORTAL ANNOUNCES ITSELF NOWHERE — badge or chime.
 *
 * Design note, 2026-08-29: […]
 *
 * Every tab past the first runs its OWN socket (TabPortalHost, #407) and
 * connects on its FIRST FOCUS. `quiet` was added in August to keep those
 * portals off the desk's global status badge — but the arrival CHIME lives in
 * stream-message-handlers.js, which never saw the flag. So the announcement
 * did not stop; it only changed senses, from a badge to a sound.
 *
 * Two nets, matching this repo's own precedent for browser-only code
 * (websocket-disconnect-intentional.test.js): the flag's REAL behaviour with a
 * minimal browser global, and a source-level pin on the one gate that consumes
 * it. Nothing is mocked — WebSocketService is the real class, and the window
 * stub is the environment it runs in, not a stand-in for the thing under test.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';

const HANDLERS = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../../frontend/app/RelinkShell/stream-message-handlers.js',
);

let WebSocketService;
let priorWindow;

beforeAll(async () => {
  // The constructor reads window.location to build its ws:// URL. That is the
  // browser it lives in, supplied — the class itself is untouched.
  priorWindow = globalThis.window;
  globalThis.window = { location: { protocol: 'http:', host: 'localhost:3333' } };
  ({ WebSocketService } = await import('../../frontend/services/WebSocketService.js'));
});

afterAll(() => {
  if (priorWindow === undefined) delete globalThis.window;
  else globalThis.window = priorWindow;
});

describe('the flag a background portal carries', () => {
  it('a tab portal declares itself quiet; the desk portal does not', () => {
    // The two real construction sites: TabPortalHost passes { quiet: true },
    // StreamWindowHost and the desk pass nothing.
    expect(new WebSocketService({ quiet: true }).isQuiet()).toBe(true);
    expect(new WebSocketService().isQuiet()).toBe(false);
    expect(new WebSocketService({}).isQuiet()).toBe(false);
  });

  it('quiet is strictly boolean — a truthy accident never silences the desk', () => {
    // The desk's own arrival IS worth hearing. Only an explicit `true` may
    // take that away, so a stray option value cannot mute the primary link.
    expect(new WebSocketService({ quiet: 'yes' }).isQuiet()).toBe(false);
    expect(new WebSocketService({ quiet: 1 }).isQuiet()).toBe(false);
    expect(new WebSocketService({ quiet: null }).isQuiet()).toBe(false);
  });
});

describe('the chime asks before it sounds', () => {
  it('THE REGRESSION: portalContact is gated on the portal being loud', async () => {
    const src = await fs.readFile(HANDLERS, 'utf8');
    const at = src.indexOf("playSound('portalContact')");
    expect(at, 'the arrival chime moved — re-point this net').toBeGreaterThan(-1);
    // The gate must be ON the chime, in the same statement — not merely
    // somewhere in the file, which a later edit could drift away from.
    const line = src.slice(src.lastIndexOf('\n', at) + 1, src.indexOf('\n', at));
    expect(line).toContain('isQuiet');
    expect(line).toMatch(/!\s*wsService\.isQuiet/);
  });

  it('it is the ONLY chime on this path — a second one would reopen the hole', async () => {
    const src = await fs.readFile(HANDLERS, 'utf8');
    expect((src.match(/playSound\('portalContact'\)/g) || []).length).toBe(1);
  });

  it('the desk portal is still allowed to sound — this silences tabs, not arrivals', async () => {
    // The gate is a negation of quiet, never an unconditional removal. An
    // operator linking their desk should still hear it.
    const src = await fs.readFile(HANDLERS, 'utf8');
    expect(src).not.toMatch(/\/\/\s*playSound\('portalContact'\)/); // not commented out
    expect(src).toContain("playSound('portalContact')");
  });
});
