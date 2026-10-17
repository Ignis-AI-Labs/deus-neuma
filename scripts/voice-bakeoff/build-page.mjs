#!/usr/bin/env node
// build-page.mjs — the listening page for the voice bake-off.
//
// Built around what Founder needs to judge: every engine named and explained in
// plain words (engines.json), grouped by family, with a QUICK ROUND of five
// telling clips each, one overall 1–5 rating plus keep/cut per engine, and a
// COMPARE view that plays one line across every engine still in the running.
// Audio comes from level/ (equal loudness, level.mjs) so loudness never
// decides a vote. Ratings live in the browser and export as JSON.
//
//   node scripts/voice-bakeoff/level.mjs && node scripts/voice-bakeoff/build-page.mjs
//   python3 -m http.server 8765 --bind 127.0.0.1 --directory <samples>

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { arg } from './args.mjs';

const here = import.meta.dirname;
const samples = resolve(arg('--samples', join(here, '../../voice-engines/_samples/bakeoff-2026-09-30')));
const lines = JSON.parse(readFileSync(join(here, 'lines.json'), 'utf8'));
const guide = JSON.parse(readFileSync(join(here, 'engines.json'), 'utf8'));
const AUDIO = existsSync(join(samples, 'level')) ? 'level' : 'out';
// a round may clone other voices under the same ids; labels.json names them
const labelsPath = join(samples, 'labels.json');
const LABEL = { hannah: 'Hannah', james: 'James', ...(existsSync(labelsPath) ? JSON.parse(readFileSync(labelsPath, 'utf8')) : {}) };
const ROUND2 = existsSync(labelsPath);
const named = (text) => text.replace(/\bhannah\b/gi, LABEL.hannah).replace(/\bjames\b/gi, LABEL.james);

const metaOf = (engine) => {
  const p = join(samples, 'out', engine, 'meta.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
};
const clip = (engine, name) => (existsSync(join(samples, AUDIO, engine, name)) ? `${AUDIO}/${engine}/${name}` : null);
const takes = (engine, stem) => [1, 2].map((t) => clip(engine, `${stem}__t${t}.wav`)).filter(Boolean);
const plain = (text) => text.replace(/\s*\{(\w+)\}\s*/g, (_, c) => ` (${c}) `).replace(/\s+/g, ' ').trim();
const shortLicence = (l = '') => l.split(/[(;:]/)[0].trim();
const memory = (m) => (m?.device === 'cpu' ? 'CPU only' : m?.peakVramMb ? `${(m.peakVramMb / 1024).toFixed(1)} GB GPU` : '');

// The quick round: five clips that tell an engine's story fastest (hannah).
const QUICK = [
  { key: 'dialogue', label: 'Dialogue', stem: lines.dialogue.id, text: lines.dialogue.turns.map((t) => `${named(t.speaker)}: ${plain(t.text)}`).join('\n') },
  ...[['c02-tease', 'Laugh'], ['c03-comfort', 'Comfort'], ['c06-intimate', 'Intimate'], ['r01-summary', 'Read-aloud']].map(([id, label]) => {
    const l = [...lines.conversation, ...lines.readAloud].find((x) => x.id === id);
    return { key: id, label, stem: `${id}__hannah`, text: plain(l.text) };
  }),
];
// Every line × voice, for the compare view and an engine's "all clips".
const ALL = [
  { key: lines.dialogue.id, label: 'Dialogue (whole)', stem: lines.dialogue.id, text: QUICK[0].text },
  ...[...lines.conversation, ...lines.readAloud].flatMap((l) => l.voices.map((v) => ({
    key: `${l.id}__${v}`, label: `${l.id.replace(/^\w+-/, '')} · ${named(v)}`, stem: `${l.id}__${v}`, text: plain(l.text), emotion: l.emotion,
  }))),
];

const engines = Object.entries(guide.engines)
  .map(([id, g]) => ({ id, g, m: metaOf(id) }))
  .filter((e) => e.m)
  .map(({ id, g, m }) => ({
    id, family: g.family, name: g.name, size: g.size, one: g.one, limits: ROUND2 ? `Round 1 notes (other voices): ${g.limits}` : g.limits,
    facts: {
      copies: m.clones ? 'yes' : 'no',
      cues: g.cues,
      hears: m.contextAware ? 'yes' : 'no',
      memory: memory(m),
      licence: shortLicence(m.license),
    },
    clips: Object.fromEntries(ALL.map((x) => [x.key, takes(id, x.stem)]).filter(([, t]) => t.length)),
    notes: m.notes || [],
  }));

const data = { built: new Date().toISOString(), label: LABEL, families: guide.families, quick: QUICK, all: ALL, engines,
  refs: Object.fromEntries(Object.entries(lines.voices).map(([k, v]) => [k, v.ref])) };
writeFileSync(join(samples, 'index.html'), page(data));
console.log(`${engines.length} engines (${AUDIO}/) → ${join(samples, 'index.html')}`);

function page(payload) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Voice bake-off</title>
<style>
:root{color-scheme:dark;--bg:#0c0d10;--card:#15171c;--ink:#e8e6e1;--dim:#8f929b;--line:#262932;--gold:#d8b46a;--red:#c96b6b;--green:#7fb58a}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,sans-serif}
header{position:sticky;top:0;z-index:3;background:#0c0d10f2;border-bottom:1px solid var(--line);padding:10px 24px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
header h1{font-size:15px;margin:0 12px 0 0;letter-spacing:.08em;text-transform:uppercase}
button,select,textarea{background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:6px;padding:6px 12px;cursor:pointer;font:inherit}
button.on{border-color:var(--gold);color:var(--gold)}
button.playing{background:var(--gold);color:#000;border-color:var(--gold)}
#now{margin-left:auto;color:var(--gold);font-size:14px}
main{max-width:1080px;margin:0 auto;padding:12px 24px 90px}
.intro{color:var(--dim)}
.intro b{color:var(--ink)}
h2.fam{margin:34px 0 2px;font-size:18px}
p.fam{margin:0 0 8px;color:var(--dim)}
.eng{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 18px;margin:10px 0}
.eng.cut{opacity:.4}
.eng h3{margin:0;font-size:17px}
.eng h3 small{color:var(--dim);font-weight:normal;margin-left:6px}
.eng p{margin:4px 0}
.limits{color:var(--dim)}
.facts{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}
.facts span{font-size:12px;border:1px solid var(--line);border-radius:99px;padding:2px 10px;color:var(--dim)}
.facts span.yes{color:var(--green);border-color:#3c5a43}
.clips{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}
.rate{display:flex;gap:6px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--line);padding-top:10px;margin-top:6px}
.rate .lbl{color:var(--dim);margin-right:4px}
.rate button.keep.on{border-color:var(--green);color:var(--green)}
.rate button.cutb.on{border-color:var(--red);color:var(--red)}
.rate textarea{flex:1;min-width:220px;height:34px;cursor:text;resize:vertical}
details{margin-top:8px}
details summary{cursor:pointer;color:var(--dim)}
.allrow{display:flex;gap:6px;align-items:center;padding:3px 0;flex-wrap:wrap}
.allrow span{min-width:190px;color:var(--dim);font-size:13px}
.notes{color:var(--dim);font-size:12px;margin:6px 0 0;padding-left:18px}
.panel{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 18px;margin:12px 0}
.linetext{white-space:pre-wrap;font-size:16px;margin:8px 0 12px}
.cmprow{display:grid;grid-template-columns:230px auto 1fr;gap:10px;align-items:center;padding:5px 0;border-top:1px solid var(--line)}
.cmprow .who small{color:var(--dim);display:block;font-size:12px}
table{border-collapse:collapse;width:100%;font-size:14px}
td,th{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left}
.hidden{display:none}
</style></head><body>
<header><h1>Voice bake-off</h1>
<button data-view="quick" class="on">1 · Quick round</button>
<button data-view="compare">2 · Compare a line</button>
<button data-view="scores">3 · Scores</button>
<button id="export">Export ratings</button>
<button id="stop">■ Stop</button>
<span id="now"></span>
</header>
<main>
<section id="quick">
<div class="panel intro">
<p><b>Test your sound first:</b> <button class="play" data-src="${payload.refs.hannah}" data-who="Source voice · ${payload.label.hannah}">▶ ${payload.label.hannah} (the real voice)</button> <button class="play" data-src="${payload.refs.james}" data-who="Source voice · ${payload.label.james}">▶ ${payload.label.james} (the real voice)</button> These are the two real recordings every engine tries to sound like.</p>
<p><b>How to do this fast:</b> each engine below has five clips, all in ${payload.label.hannah}'s voice:</p>
<ul>
<li><b>Dialogue</b>: a short "I got the job" conversation. This is the one that matters most for a Sesame feel.</li>
<li><b>Laugh</b>, <b>Comfort</b> and <b>Intimate</b>: lines that need real emotion.</li>
<li><b>Read-aloud</b>: a plain summary.</li>
</ul>
<p>Give each engine one overall score from 1 to 5, and press <b>Cut</b> on any engine you don't want to hear again. Cut engines drop out of the Compare view.</p>
<p><b>Scores save automatically</b> (straight to disk, so I see them). Every clip is set to the same loudness, so no engine wins just by being louder.</p>
</div>
<div id="engines"></div>
</section>
<section id="compare" class="hidden">
<div class="panel"><select id="line"></select> <button id="playAll">▶ Play this line on every engine still in</button>
<p class="linetext" id="lineText"></p><div id="cmp"></div></div>
</section>
<section id="scores" class="hidden"><div class="panel" id="scoreBox"></div></section>
</main>
<script>
const DATA = ${JSON.stringify(payload)};
const KEY = 'voice-bakeoff-2026-09-30-v2';
const state = Object.assign({ score: {}, keep: {}, note: {} }, JSON.parse(localStorage.getItem(KEY) || '{}'));
// kept in the browser AND sent to serve.mjs, which writes feedback/ratings.json
const save = () => { localStorage.setItem(KEY, JSON.stringify(state)); fetch('save/ratings', { method: 'POST', body: JSON.stringify(state) }).catch(() => {}); };
const el = (tag, attrs = {}, ...kids) => { const n = document.createElement(tag); Object.assign(n, attrs); n.append(...kids.filter((k) => k != null)); return n; };
const byId = Object.fromEntries(DATA.engines.map((e) => [e.id, e]));

// ONE player for the whole page: a click always plays exactly one clip.
const player = new Audio();
let current = null; let queue = [];
const now = document.getElementById('now');
const mark = () => document.querySelectorAll('button.play').forEach((b) => b.classList.toggle('playing', b.dataset.src === current));
const play = (src, who) => {
  current = src; player.src = src; now.textContent = '▶ ' + who;
  player.play().catch((e) => { now.textContent = 'Could not play: ' + e.message; });
  mark();
};
player.onended = () => { current = null; mark(); now.textContent = ''; const next = queue.shift(); if (next) setTimeout(() => play(next.src, next.who), 450); };
player.onerror = () => { now.textContent = 'This clip failed to load: ' + player.src; };
const stop = () => { queue = []; player.pause(); current = null; mark(); now.textContent = ''; };
document.getElementById('stop').onclick = stop;
document.addEventListener('click', (e) => { const b = e.target.closest('button.play'); if (!b) return;
  if (b.dataset.src === current) return stop(); queue = []; play(b.dataset.src, b.dataset.who); });
const playBtn = (src, label, who) => { const b = el('button', { className: 'play', textContent: '▶ ' + label }); Object.assign(b.dataset, { src, who }); return b; };

const factChips = (f) => [
  ['Copies the voice', f.copies], ['Laughs/sighs on cue', f.cues], ['Hears the conversation', f.hears],
].map(([k, v]) => el('span', { className: v === 'yes' ? 'yes' : '', textContent: k + ': ' + v }))
  .concat([f.memory, f.licence].filter(Boolean).map((t) => el('span', { textContent: t })));

const engineCard = (e) => {
  const card = el('div', { className: 'eng' + (state.keep[e.id] === 'cut' ? ' cut' : '') });
  const clips = el('div', { className: 'clips' }, ...DATA.quick.map((q) => {
    const t = e.clips[q.key === 'dialogue' ? DATA.all[0].key : q.stem];
    return t ? playBtn(t[0], q.label, e.name + ' · ' + q.label) : null;
  }));
  const scoreBtns = [1, 2, 3, 4, 5].map((n) => { const b = el('button', { textContent: n, className: state.score[e.id] === n ? 'on' : '' });
    b.onclick = () => { state.score[e.id] = state.score[e.id] === n ? undefined : n; save(); renderEngines(); }; return b; });
  const keep = el('button', { className: 'keep' + (state.keep[e.id] === 'keep' ? ' on' : ''), textContent: 'Keep' });
  keep.onclick = () => { state.keep[e.id] = state.keep[e.id] === 'keep' ? undefined : 'keep'; save(); renderEngines(); };
  const cut = el('button', { className: 'cutb' + (state.keep[e.id] === 'cut' ? ' on' : ''), textContent: 'Cut' });
  cut.onclick = () => { state.keep[e.id] = state.keep[e.id] === 'cut' ? undefined : 'cut'; save(); renderEngines(); };
  const note = el('textarea', { placeholder: 'a note, if any', value: state.note[e.id] || '' });
  note.oninput = () => { state.note[e.id] = note.value; save(); };
  const all = el('details', {}, el('summary', { textContent: 'Every clip from this engine (both voices, both takes)' }),
    ...DATA.all.filter((x) => e.clips[x.key]).map((x) => el('div', { className: 'allrow' }, el('span', { textContent: x.label }),
      ...e.clips[x.key].map((src, i) => playBtn(src, 'take ' + (i + 1), e.name + ' · ' + x.label + ' · take ' + (i + 1))))),
    e.notes.length ? el('ul', { className: 'notes' }, ...e.notes.map((n) => el('li', { textContent: n }))) : null);
  card.append(
    el('h3', {}, e.name, e.size ? el('small', { textContent: e.size + ' parameters' }) : null),
    el('p', { textContent: e.one }), el('p', { className: 'limits', textContent: e.limits }),
    el('div', { className: 'facts' }, ...factChips(e.facts)), clips,
    el('div', { className: 'rate' }, el('span', { className: 'lbl', textContent: 'Overall' }), ...scoreBtns, keep, cut, note), all);
  return card;
};
const renderEngines = () => {
  const root = document.getElementById('engines'); root.textContent = '';
  for (const f of DATA.families) {
    const mine = DATA.engines.filter((e) => e.family === f.id); if (!mine.length) continue;
    root.append(el('h2', { className: 'fam', textContent: f.name }), el('p', { className: 'fam', textContent: f.about }), ...mine.map(engineCard));
  }
};

const lineSel = document.getElementById('line');
DATA.all.forEach((x) => lineSel.append(el('option', { value: x.key, textContent: x.label + (x.emotion ? ' (' + x.emotion + ')' : '') })));
const inRunning = () => DATA.engines.filter((e) => state.keep[e.id] !== 'cut');
const renderCompare = () => {
  const x = DATA.all.find((a) => a.key === lineSel.value);
  document.getElementById('lineText').textContent = x.text;
  const box = document.getElementById('cmp'); box.textContent = '';
  for (const e of inRunning()) { const t = e.clips[x.key]; if (!t) continue;
    box.append(el('div', { className: 'cmprow' }, el('div', { className: 'who' }, e.name, el('small', { textContent: e.facts.copies === 'yes' ? 'copies the voice' : 'preset / described voice' })),
      el('span', {}, ...t.map((src, i) => playBtn(src, 'take ' + (i + 1), e.name + ' · take ' + (i + 1)))), el('span'))); }
};
lineSel.onchange = renderCompare;
document.getElementById('playAll').onclick = () => { const x = DATA.all.find((a) => a.key === lineSel.value);
  queue = inRunning().filter((e) => e.clips[x.key]).map((e) => ({ src: e.clips[x.key][0], who: e.name + ' · ' + x.label }));
  const first = queue.shift(); if (first) play(first.src, first.who); };

const renderScores = () => {
  const box = document.getElementById('scoreBox'); box.textContent = '';
  const rows = [...DATA.engines].sort((a, b) => (state.score[b.id] ?? -1) - (state.score[a.id] ?? -1));
  const t = el('table'); t.innerHTML = '<tr><th>Engine</th><th>Score</th><th>Keep / cut</th><th>Note</th><th>Memory</th><th>Licence</th></tr>';
  for (const e of rows) { const tr = el('tr'); for (const v of [e.name, state.score[e.id], state.keep[e.id], state.note[e.id], e.facts.memory, e.facts.licence]) tr.append(el('td', { textContent: v ?? '—' })); t.append(tr); }
  box.append(t);
};

document.querySelectorAll('header button[data-view]').forEach((b) => b.onclick = () => {
  document.querySelectorAll('header button[data-view]').forEach((x) => x.classList.toggle('on', x === b));
  for (const v of ['quick', 'compare', 'scores']) document.getElementById(v).classList.toggle('hidden', v !== b.dataset.view);
  if (b.dataset.view === 'compare') renderCompare(); if (b.dataset.view === 'scores') renderScores(); });
document.getElementById('export').onclick = () => {
  const blob = new Blob([JSON.stringify({ built: DATA.built, exported: new Date().toISOString(), ...state }, null, 2)], { type: 'application/json' });
  el('a', { href: URL.createObjectURL(blob), download: 'voice-bakeoff-ratings.json' }).click(); };
renderEngines();
</script></body></html>`;
}
