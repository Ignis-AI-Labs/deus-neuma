// #112 (FE-FIX-007) — intentional disconnect must NOT auto-reconnect.
//
// Source-level regression net: the WebSocketService runs in a browser
// (uses window, WebSocket, sessionStorage); the vitest config is node-only
// and adding jsdom for this one assertion isn't worth a new dep. We assert
// the STRUCTURAL fix instead — the four touch points that together make
// the intentional-close gate work:
//   1. constructor initializes `_intentionalClose = false`
//   2. connect() resets it to false (re-arms unexpected-drop reconnect)
//   3. disconnect() sets it to true (the gate that suppresses reconnect)
//   4. onclose handler checks it with an early `return` before `reconnect()`
//
// Same pattern as #20 S1's require_systemd_user source-level guard:
// when a real forcing function isn't worth the test-infra cost, lock in
// the structural defense instead so a future maintainer can't silently
// regress it. The Verification checklist in #112 covers the manual
// browser-side proof (Network tab observation).

import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import path from 'path';

const WSS = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../../frontend/services/WebSocketService.js',
);

// Robustly find the end of a method body by scanning to the next sibling
// method definition (line starting with whitespace + identifier + `(` +
// `)`). Insulates the body-extraction regexes from benign refactors
// adding nested braces inside the method (ai6 #112 R1.3 hardening).
const sliceToNextMethod = (text, startIdx) => {
  // Skip past the method's opening brace, then find the next line that
  // looks like a sibling method signature.
  const firstBraceIdx = text.indexOf('{', startIdx);
  if (firstBraceIdx === -1) return text.length;
  const rest = text.slice(firstBraceIdx + 1);
  const nextMethodMatch = rest.match(/\n\s*[a-zA-Z_$][\w$]*\(.*?\)\s*\{/);
  if (!nextMethodMatch) return text.length;
  return firstBraceIdx + 1 + nextMethodMatch.index;
};

describe('#112 (FE-FIX-007) — disconnect() intentional-close gate', () => {
  // INVARIANT 1 — the four structural touch points all exist.
  it('_intentionalClose is initialized + set + reset + checked at the four required call sites', async () => {
    const text = await fs.readFile(WSS, 'utf8');

    // 1. Constructor init to false. Anchor on the method header and scan
    // to the next method definition (line that starts with whitespace +
    // word + `(` — covers `connect()`, `disconnect()`, etc.) so a
    // benign future refactor adding nested braces in the constructor
    // doesn't make this brittle. (ai6 R1.3 hardening.)
    // MATCH THE CONSTRUCTOR, NOT ITS ARGUMENT LIST. This pinned
    // `constructor()` exactly, so it went red the moment the class took its
    // first option (`{ quiet = false } = {}`, 2026-08-28) — a green test
    // turned red by a change it was never guarding. The invariant here is the
    // four `_intentionalClose` touch points; the signature is not one of them.
    const ctorStart = text.search(/^\s*constructor\(/m);
    expect(ctorStart, 'constructor() must exist').toBeGreaterThan(-1);
    const ctorBody = text.slice(ctorStart, sliceToNextMethod(text, ctorStart));
    expect(ctorBody).toMatch(/this\._intentionalClose\s*=\s*false/);

    // 2. connect() resets to false (re-arms after a disconnect()→connect() cycle)
    // Match the method DEFINITION (line-start, not the JSDoc mention) so
    // we're locating real code, not comments.
    const connectIdx = text.search(/^\s*connect\(\)\s*\{/m);
    const disconnectIdx = text.search(/^\s*disconnect\(\)\s*\{/m);
    expect(connectIdx).toBeGreaterThan(-1);
    expect(disconnectIdx).toBeGreaterThan(connectIdx);
    // Reset line appears AFTER connect() start (lives inside connect's body)
    const resetIdx = text.indexOf('this._intentionalClose = false', connectIdx + 1);
    expect(resetIdx).toBeGreaterThan(connectIdx);
    expect(resetIdx).toBeLessThan(disconnectIdx);

    // 3. disconnect() sets to true. Anchor to method definition + scan
    // to the next method (same hardening as constructor — ai6 R1.3).
    const discStart = text.search(/^\s*disconnect\(\)\s*\{/m);
    expect(discStart, 'disconnect() must exist').toBeGreaterThan(-1);
    const discBody = text.slice(discStart, sliceToNextMethod(text, discStart));
    expect(discBody).toMatch(/this\._intentionalClose\s*=\s*true/);

    // 4. onclose handler checks _intentionalClose with early return BEFORE
    //    the reconnect() call. We assert ordering: the check appears, and
    //    the literal `this.reconnect()` call comes AFTER it in source.
    const checkIdx = text.indexOf('if (this._intentionalClose)');
    expect(checkIdx, 'onclose must check _intentionalClose').toBeGreaterThan(-1);
    const reconnectCallIdx = text.indexOf('this.reconnect()', checkIdx);
    expect(reconnectCallIdx, 'this.reconnect() must come AFTER the _intentionalClose check').toBeGreaterThan(checkIdx);

    // The check block must contain an early `return` so reconnect doesn't fire
    const checkBlock = text.slice(checkIdx, reconnectCallIdx);
    expect(checkBlock).toMatch(/\breturn\b/);
  });

  // INVARIANT 2 — exactly 4 CODE touch points exist (1 init + 1 reset +
  // 1 set + 1 check). JSDoc mentions can vary; counting only `this.
  // _intentionalClose` (with the `this.` receiver) captures real call
  // sites and excludes comment prose. If a future maintainer adds a
  // fifth code touch point, this fails loudly so they re-examine the
  // gate's invariant.
  //
  // RE-EXAMINED (2026-09-30): a FIFTH was added with the phone road — close
  // code 4003 ("phone access ended") sets the flag too, because the server
  // has revoked the pairing and reconnecting would only loop on a dead door.
  // It is a second SET, not a bypass: it lives in onclose, before the check.
  it('exactly 5 CODE touch points of this._intentionalClose exist (excludes JSDoc prose)', async () => {
    const text = await fs.readFile(WSS, 'utf8');
    const codeOccurrences = text.match(/this\._intentionalClose/g) || [];
    expect(codeOccurrences).toHaveLength(5);
    // the fifth is the 4003 revocation, and it sets the flag, never clears it
    const revoked = text.indexOf('event.code === 4003');
    expect(revoked).toBeGreaterThan(-1);
    expect(text.slice(revoked, revoked + 120)).toMatch(/this\._intentionalClose = true/);
  });

  // INVARIANT 3 — the reconnect() call site in onclose is the ONLY one in
  // the file. (Documented assumption — if anyone adds a second reconnect()
  // call elsewhere that bypasses the _intentionalClose gate, the bug
  // returns.) Background reconnect() inside reconnect() recursion via
  // setTimeout(() => this.connect()) is allowed since connect() then
  // resets the flag.
  it('only ONE this.reconnect() call site (in onclose) — no bypass paths', async () => {
    const text = await fs.readFile(WSS, 'utf8');
    const calls = text.match(/\bthis\.reconnect\(\)/g) || [];
    expect(calls).toHaveLength(1);
  });

  // #135 gave the intentional path its own wording ('Portal closed') so the
  // witness could tell choice from failure. That distinction was right about
  // failure and wrong about choice: disconnect()'s ONLY caller is a stream
  // window unmounting, so the notice announced a portal event that never
  // happened, on a document-level badge belonging to a DIFFERENT window, and —
  // being the one 'ok' status in the file that forgot to dismiss itself — sat
  // there until a reload. Design note, 2026-07-31: […]
  //
  // The law is now SILENCE on the intentional path: the window disappearing is
  // the feedback. This test used to assert the removed line still existed —
  // a guard that outlived its subject and failed the build for doing its job.
  // It now guards what replaced it, including the reason clearStatus() stands
  // where nothing would have done.
  it('the intentional path says NOTHING and clears the badge; only the exhausted path speaks', async () => {
    const text = await fs.readFile(WSS, 'utf8');

    // No portal announcement on a stream window closing — not anywhere.
    expect(text).not.toMatch(/setStatus\('Portal closed'/);

    // clearStatus() rather than deleting the branch outright: a window closed
    // MID-CONNECT would otherwise strand […] on screen
    // forever — the same stuck-badge defect wearing a different label.
    // Bounded to the branch itself — from the gate to the next sibling
    // statement — so a clearStatus() living somewhere else in the file could
    // never stand in for the one that has to be HERE.
    const gateIdx = text.indexOf('if (this._intentionalClose)');
    expect(gateIdx).toBeGreaterThan(-1);
    const branch = text.slice(gateIdx, text.indexOf('if (this.reconnectAttempts', gateIdx));
    expect(branch, 'the intentional branch must clear the badge').toMatch(/clearStatus\(\)/);
    expect(branch, 'and must set no status of its own').not.toMatch(/setStatus\(/);

    // Failure still speaks — an exhausted reconnect is not a choice, and going
    // quiet there would hide a real severance.
    expect(text).toMatch(/setStatus\('Portal severed', 'error'\)/);
  });
});
