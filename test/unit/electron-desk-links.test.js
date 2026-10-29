/**
 * The desk's two doors out (electron/desk-links.cjs): a new-window link goes to
 * the OS browser only when it is http(s), and the desk's own frame stays on the
 * desk's origin. The seven urls are the ones a real Electron 33 desk delivered
 * to setWindowOpenHandler from clicked target=_blank links under the desk's CSP
 * (audit desk-electron-bench, finding 1) — every non-http one of them used to be
 * handed to shell.openExternal, which runs whatever OS handler owns the scheme.
 * Pure module, real inputs, no Electron (RULE 0); the live navigation half is
 * proven in a real Electron on a virtual display (see the fix commit).
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { externalUrlFor, staysOnDesk, fromDesk } = require('../../electron/desk-links.cjs');

describe('externalUrlFor — only a web page leaves for the OS browser', () => {
  it('passes http and https through, normalized', () => {
    expect(externalUrlFor('https://example.com/a')).toBe('https://example.com/a');
    expect(externalUrlFor('http://ollama.com')).toBe('http://ollama.com/');
  });

  it('refuses every scheme that would launch a program instead', () => {
    for (const url of [
      'file://attacker.example/share/x.exe',
      'file:///etc/hostname',
      'smb://attacker.example/s',
      'ms-msdt:/id%20PCWDiagnostic',
      'search-ms:query=x',
      'mailto:a@b.c',
      'javascript:alert(1)',
    ]) expect(externalUrlFor(url)).toBeNull();
  });

  it('refuses what is not a url at all', () => {
    expect(externalUrlFor('')).toBeNull();
    expect(externalUrlFor('/relative/path')).toBeNull();
    expect(externalUrlFor(undefined)).toBeNull();
    expect(externalUrlFor({ toString: () => 'smb://x/y' })).toBeNull();
  });
});

describe('staysOnDesk — the desk frame keeps its own origin', () => {
  const DESK = 'http://127.0.0.1:47317';

  it('allows a route on the desk origin', () => {
    expect(staysOnDesk('http://127.0.0.1:47317/', DESK)).toBe(true);
    expect(staysOnDesk('http://127.0.0.1:47317/house?x=1#top', `${DESK}/`)).toBe(true);
  });

  it('refuses another port, host or scheme', () => {
    expect(staysOnDesk('http://127.0.0.1:47318/', DESK)).toBe(false);
    expect(staysOnDesk('http://localhost:47317/', DESK)).toBe(false);
    expect(staysOnDesk('https://example.com/', DESK)).toBe(false);
  });

  it('refuses a dropped file and anything unparseable', () => {
    expect(staysOnDesk('file:///home/me/notes.txt', DESK)).toBe(false);
    expect(staysOnDesk('not a url', DESK)).toBe(false);
    expect(staysOnDesk('http://127.0.0.1:47317/', 'not an origin')).toBe(false);
  });
});

// Audit 2026-10-28 M-07: only a desk's own top frame, on the desk's origin, speaks for the desk.
describe('fromDesk — which IPC messages the desk answers', () => {
  const desk = 'http://127.0.0.1:47317';
  const top = (url) => ({ senderFrame: { url, parent: null } });
  it('the desk\'s top frame on its origin, any path', () => {
    expect(fromDesk(top('http://127.0.0.1:47317/'), desk)).toBe(true);
    expect(fromDesk(top('http://127.0.0.1:47317/app?x=1#y'), desk)).toBe(true);
  });
  it('never a frame inside the page, another origin, another port, or a gone frame', () => {
    expect(fromDesk({ senderFrame: { url: 'http://127.0.0.1:47317/', parent: {} } }, desk)).toBe(false);
    expect(fromDesk(top('https://evil.example/'), desk)).toBe(false);
    expect(fromDesk(top('http://127.0.0.1:8080/'), desk)).toBe(false);
    expect(fromDesk(top('file:///etc/passwd'), desk)).toBe(false);
    expect(fromDesk(top('about:blank'), desk)).toBe(false);
    expect(fromDesk({ senderFrame: null }, desk)).toBe(false);
    expect(fromDesk({}, desk)).toBe(false);
  });
});

