// company-updates-text — the pure half of `company_updates`: reading a
// CHANGELOG's sections, holding back anything shaped like a secret, cutting a
// commit's patch to the files a being may read, telling which site pages
// changed, and drawing the whole answer with every line cited.
//
// THE CLAIM LAW: the answer says only what was read, and where — repo and
// commit for a commit, repo and fragment path for a changelog line, the page
// address for a site change. A repo that was not read says why, never "no
// changes".
//
// Pure throughout (the frame token is the one input that is random by default).

import { createHash } from 'crypto';
import { scanLine } from '../security/secret-sweep.js';
import { frameUntrustedSections } from '../untrusted-content.js';

export const SECRET_HELD = '[a line shaped like a secret was held back here]';

/**
 * Text with every secret-shaped line replaced, capped at `cap` characters.
 * Pure.
 * @param {string} text
 * @param {number} cap
 * @returns {{text: string, held: number, capped: boolean}}
 */
export const safeText = (text, cap) => {
  const lines = String(text ?? '').split('\n');
  let held = 0;
  const kept = lines.map((line, i) => {
    if (scanLine(line, lines[i + 1]).length === 0) return line;
    held += 1;
    return SECRET_HELD;
  }).join('\n');
  return { text: kept.length > cap ? `${kept.slice(0, cap)}\n…(cut at ${cap} characters)` : kept, held, capped: kept.length > cap };
};

/**
 * A CHANGELOG's level-2 sections, in order. Pure.
 * @param {?string} text
 * @returns {Array<{heading: string, body: string}>}
 */
const changelogSections = (text) => {
  const out = [];
  for (const line of String(text ?? '').split('\n')) {
    if (/^## /.test(line)) out.push({ heading: line.slice(3).trim(), body: '' });
    else if (out.length) out[out.length - 1].body += `${line}\n`;
  }
  return out.map((s) => ({ heading: s.heading, body: s.body.trim() }));
};

/**
 * What a CHANGELOG gained between two readings: the [Unreleased] section
 * when its text changed, and every section heading that is new. Pure.
 * @param {?string} before - the file at the window's start (null: not there)
 * @param {?string} after - the file at HEAD
 * @returns {Array<{heading: string, body: string}>}
 */
export const changelogGained = (before, after) => {
  const old = new Map(changelogSections(before).map((s) => [s.heading, s.body]));
  return changelogSections(after).filter((s) => (/^\[?unreleased\]?$/i.test(s.heading)
    ? s.body && old.get(s.heading) !== s.body
    : !old.has(s.heading)));
};

/**
 * One commit's patch cut to the files `mayRead` allows: a file section the
 * walls refuse is dropped whole and named by count only. Pure given `mayRead`.
 * @param {string} patch - `git show --stat --patch` output
 * @param {(file: string) => boolean} mayRead - repo-relative path → readable?
 * @returns {{text: string, withheld: number}}
 */
export const patchForBeing = (patch, mayRead) => {
  const parts = String(patch ?? '').split(/^(?=diff --git )/m);
  const [head, ...files] = parts[0].startsWith('diff --git ') ? ['', ...parts] : parts;
  let withheld = 0;
  const kept = files.filter((section) => {
    const names = /^diff --git a\/(.+?) b\/(.+)$/m.exec(section);
    const ok = names && mayRead(names[1]) && mayRead(names[2]);
    if (!ok) withheld += 1;
    return ok;
  });
  // The --stat lines name every file, a walled one too — a name alone is no
  // secret, but its line counts are dropped with it so nothing reads as shown.
  const statKept = head.split('\n').filter((line) => {
    const m = /^ (\S.*?)\s+\|\s+\d+/.exec(line);
    return !m || mayRead(m[1].trim());
  }).join('\n');
  return { text: [statKept.trimEnd(), ...kept.map((s) => s.trimEnd())].join('\n'), withheld };
};

/** A page's text as one comparable mark. Pure. */
export const pageMark = (text) => createHash('sha256').update(String(text ?? '').replace(/\s+/g, ' ').trim()).digest('hex');

/**
 * Which pages changed against the last report's marks. Pure.
 * @param {Object<string, string>} before - url → mark at the last report
 * @param {Array<{url: string, mark: string}>} pages - read now
 * @returns {Array<{url: string, state: 'changed'|'new'|'same'}>}
 */
export const pageStates = (before, pages) => pages.map(({ url, mark }) => ({
  url,
  state: !before?.[url] ? 'new' : before[url] === mark ? 'same' : 'changed',
}));

const short = (sha) => String(sha || '').slice(0, 9);
const day = (iso) => String(iso || '').slice(0, 10);

// pure — one repo's own lines (ours) and its repo-returned texts (framed).
const repoBlock = (r) => {
  const where = `${r.role ? `${r.role} — ` : ''}${r.path || r.remote}${r.path && r.remote ? ` (${r.remote})` : ''}`;
  if (r.unread) return { lines: [`### ${where}`, `NOT READ: ${r.unread}`], sections: [] };
  const lines = [
    `### ${where}`,
    `${r.total} commit(s) ${r.base ? `after ${short(r.base)}` : 'in its whole history'} · HEAD ${short(r.head)}`
      + `${r.total > r.commits.length ? ` · the newest ${r.commits.length} listed` : ''}`
      + `${r.fragments.length ? ` · ${r.fragments.length} changelog fragment(s)` : ''}`
      + `${r.changelog.length ? ` · CHANGELOG.md: ${r.changelog.map((s) => s.heading).join(', ')}` : ''}`
      + `${r.notes.length ? ` · ${r.notes.length} release note(s)` : ''}`,
  ];
  const sections = [];
  if (r.commits.length) {
    sections.push({ lead: `${where}: commit subjects (sha · date · subject)`, text: r.commits.map((c) => `${short(c.sha)} · ${day(c.at)} · ${c.subject}`).join('\n') });
  }
  for (const f of r.fragments) sections.push({ lead: `${where}: ${f.file} (added in ${short(f.sha)})`, text: f.text });
  for (const s of r.changelog) sections.push({ lead: `${where}: CHANGELOG.md — ${s.heading}`, text: s.body });
  for (const n of r.notes) sections.push({ lead: `${where}: ${n.file} (${n.status === 'A' ? 'added' : 'changed'} in ${short(n.sha)})`, text: n.text });
  return { lines, sections };
};

/**
 * The whole answer for a being. Pure given `token`.
 * @param {object} report - company-updates.js `readCompanyUpdates` output
 * @param {string} [token]
 * @returns {string}
 */
export const renderUpdates = (report, token) => {
  const { company, window, repos, site, marked, held } = report;
  const blocks = repos.map(repoBlock);
  const sections = blocks.flatMap((b) => b.sections);
  if (site?.pages?.length) {
    for (const p of site.pages.filter((x) => x.state !== 'same')) {
      sections.push({ lead: `the site: ${p.url} (${p.state === 'new' ? 'not read at a report before' : 'changed since your last report'})`, text: p.text || '' });
    }
  }
  const siteLines = !site ? ['### The site', 'Not read this time (pass site: true to read its pages — it leaves the machine, so it asks).']
    : site.unread ? ['### The site', `NOT READ: ${site.unread}`]
      : ['### The site',
        ...site.pages.map((p) => `${p.url} — ${p.state === 'same' ? 'unchanged since your last report' : p.state === 'new' ? 'not read at a report before' : 'CHANGED since your last report'}`),
        ...(site.failed || []).map((f) => `${f.url} — NOT READ: ${f.error}`)];
  return [
    `## WHAT CHANGED — ${company.name}`,
    `Window: since ${window.since} (${window.why}).`,
    ...blocks.flatMap((b) => ['', ...b.lines]),
    '',
    ...siteLines,
    ...(sections.length ? ['', frameUntrustedSections(`${company.name}'s own repositories and site, as read just now`, sections, token)] : []),
    ...(held ? ['', `${held} line(s) shaped like a secret were held back; the walls (.env, keys, credential stores) were never read.`] : []),
    '',
    'Every line above names its repo and commit, fragment or page — report only what is written here, and cite it.',
    marked ? `Recorded as your report point (${marked}): the next call starts here.`
      : 'Not recorded as a report point. When this is the read you report from, call again with markReported: true.',
  ].join('\n');
};
