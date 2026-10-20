// workflow-member-log-links.test.js — a member's log never turns a search
// result's url into a live link unless it is http(s) (audit desk-electron-bench,
// finding 1). The sources travel the real path: a DuckDuckGo-lite results page
// through the real parser (parseDdgLite), the real tool-source shaping
// (toolSources) and the real log render (react-dom/server). RULE 0.

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseDdgLite } from '../../backend/services/web-search.js';
import { toolSources } from '../../backend/services/web-being-tools.js';
import { LogList } from '../../frontend/app/RelinkShell/WorkflowMemberLog.jsx';

const enc = encodeURIComponent;
const RESULTS = [
  `<a href="//duckduckgo.com/l/?uddg=${enc('smb://attacker.example/share')}&rut=1" class='result-link'>Shared drive</a>`,
  `<a href="//duckduckgo.com/l/?uddg=${enc('ms-msdt:/id PCWDiagnostic')}" class='result-link'>Diagnostic</a>`,
  `<a href="https://example.com/ok" class='result-link'>A real page</a>`,
].join('\n');

describe('a member log lists its sources', () => {
  it('links the web page, and shows a non-web url as text only', () => {
    const sources = toolSources(parseDdgLite(RESULTS, 10));
    expect(sources.map((s) => s.url)).toEqual(['smb://attacker.example/share', 'ms-msdt:/id PCWDiagnostic', 'https://example.com/ok']);
    const entries = [{ at: '2026-10-19T09:00:00.000Z', kind: 'act', tool: 'web/web_search', status: 'ok', summary: '3 results', detail: null, sources }];
    const html = renderToStaticMarkup(createElement(LogList, { entries, working: false }));
    expect(html).toContain('href="https://example.com/ok"');
    expect(html).not.toContain('href="smb:');
    expect(html).not.toContain('href="ms-msdt:');
    // The record is reported, not edited: both still show by their titles.
    expect(html).toContain('Shared drive');
    expect(html).toContain('Diagnostic');
  });
});
