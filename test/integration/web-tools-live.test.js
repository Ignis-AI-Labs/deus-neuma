/**
 * Web tools — REAL network (RULE 0): real pages, real search, real DNS.
 * Skips its assertions cleanly where the rig has no egress, the same honesty
 * the tool itself reports to an air-gapped being.
 */
import { describe, test, expect, beforeAll } from 'vitest';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fetchWebPage } from '../../backend/services/web-fetch.js';
import { searchWeb } from '../../backend/services/web-search.js';
import { assertSafeWebTarget } from '../../backend/services/web-guard.js';

let online = false;
beforeAll(async () => {
  online = await fetch('https://example.com', { signal: AbortSignal.timeout(4000) })
    .then((r) => r.ok).catch(() => false);
});

describe('web_fetch against the real internet', () => {
  test('reads example.com as text with its real title', async () => {
    if (!online) return;
    const page = await fetchWebPage('https://example.com/');
    expect(page.ok).toBe(true);
    expect(page.status).toBe(200);
    expect(page.title).toBe('Example Domain');
    // The copy is IANA's and may change — assert structure, not wording.
    expect(page.text.length).toBeGreaterThan(50);
    expect(page.text.toLowerCase()).toContain('domain');
    expect(page.text).not.toContain('<html');
  });

  test('follows a real http→https redirect, re-guarded per hop', async () => {
    if (!online) return;
    const page = await fetchWebPage('http://github.com/');
    expect(page.ok).toBe(true);
    expect(page.url).toBe('https://github.com/');
  });

  test('refuses a non-textual response honestly', async () => {
    if (!online) return;
    // example.com's favicon is binary — the tool must say so, not dump bytes.
    const page = await fetchWebPage('https://example.com/favicon.ico');
    expect(page.ok).toBe(false);
    expect(page.error).toMatch(/not readable text|answered/);
  });
});

describe('the strict guard against a REAL loopback server', () => {
  test('a server on 127.0.0.1 is never fetched — even as a redirect target', async () => {
    const server = http.createServer((req, res) => { res.writeHead(200).end('secret'); });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    expect((await assertSafeWebTarget(`http://127.0.0.1:${port}/`)).ok).toBe(false);
    const page = await fetchWebPage(`http://127.0.0.1:${port}/`);
    expect(page.ok).toBe(false);
    expect(page.error).toMatch(/forbidden-host/);
    server.close();
  });
});

describe('searchWeb — the real configured index set', () => {
  test('a common query returns REAL results — silence is a parser bug, never an acceptable answer', async () => {
    if (!online) return;
    // A high-traffic query: zero rows here means the parser broke against
    // the live markup (2026-07-19 — an attribute-order-sensitive regex read
    // every result as silence). Tolerating ≥0 rows is how that slipped.
    const out = await searchWeb('duckduckgo', 5);
    expect(out.ok).toBe(true);
    expect(out.backends.every((backend) => ['exa', 'searxng', 'brave', 'duckduckgo'].includes(backend))).toBe(true);
    expect(out.results.length).toBeGreaterThan(0);
    for (const r of out.results) {
      expect(typeof r.title).toBe('string');
      expect(r.url).toMatch(/^https?:/);
      expect(typeof r.snippet).toBe('string');
    }
  });

  test('an empty query is refused before any packet leaves', async () => {
    const out = await searchWeb('   ');
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/empty query/);
  });
});

describe('handleWebTool — the ok path end to end (real fetch, real journal)', () => {
  test('auto mode fetches example.com through the handler and the journal records it', async () => {
    if (!online) return;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-ok-'));
    process.env.WORKSPACES_ROOT = dir; // read lazily per call — the journal lands here
    const { handleWebTool } = await import('../../backend/services/web-being-tools.js');
    const { createWebSettings } = await import('../../backend/services/web-settings.js');
    const settings = createWebSettings({ path: path.join(dir, 'web-access.json'), env: {} });
    await settings.setEnabled(true);

    const events = [];
    const connection = {
      ws: { readyState: 1, OPEN: 1, send: () => {} },
      companion: { name: 'probe', neumaId: 'webprobe' },
      activeTurn: null,
    };
    const ports = {
      sendToolEvent: (_ws, _c, ev) => events.push(ev),
      webSettings: settings,
    };
    const res = await handleWebTool(connection.ws, connection, null, 'auto',
      { toolName: 'web_fetch' }, { url: 'https://example.com/' }, ports);

    expect(res.status).toBe('ok');
    expect(res.content).toContain('Example Domain');
    expect(events.some((e) => e.status === 'ok' && e.tool === 'web/web_fetch')).toBe(true);

    // The reading list is on the being's record — a tool_call entry, written
    // to real disk and read back through the workspace's own decrypting path
    // (entries are encrypted at rest — the raw file is ciphertext by design).
    const { neumaWorkspace } = await import('../../core/index.js');
    const entries = await neumaWorkspace.readJournal('webprobe');
    const hit = entries.find((e) => e.type === 'tool_call' && e.metadata?.server === 'web' && e.metadata?.status === 'ok');
    expect(hit).toBeTruthy();
    expect(hit.metadata.tool).toBe('web/web_fetch');
    expect(hit.metadata.detail).toContain('example.com');
    delete process.env.WORKSPACES_ROOT;
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
