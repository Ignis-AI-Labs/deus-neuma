#!/usr/bin/env node
// build-voices.mjs — the VOICE PICKER: the source voices the cloning engines
// copy. Round one cloned flat 10-second consent readings and the result was
// flat; this page lets Founder choose better ones by ear from three pools:
// purpose-designed voices (pool/designed, design-refs*.py), voice actors
// (pool/src: Alba MacKenna CC BY 4.0, Kyutai's own CC0 recordings), and 154
// public-domain audiobook narrators (pool/voicezero, Voice-Zero CC0).
// Picks are saved to feedback/voice-picks.json through serve.mjs.
//
//   node scripts/voice-bakeoff/level.mjs --from pool --to pool-level
//   node scripts/voice-bakeoff/build-voices.mjs

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { arg } from './args.mjs';

const samples = resolve(arg('--samples', join(import.meta.dirname, '../../voice-engines/_samples/bakeoff-2026-09-30')));
const L = 'pool-level';
const leveled = (sub, file) => {
  const p = `${L}/${sub}/${file.replace(/\.(flac|mp3)$/, '.wav')}`;
  return existsSync(join(samples, p)) ? p : null;
};
const FEMALE_HZ = 165; // median voiced pitch: a rough split, labelled as such on the page

const designedPath = join(samples, 'pool/designed/designed.json');
const designed = existsSync(designedPath)
  ? (JSON.parse(readFileSync(designedPath, 'utf8')).clips || JSON.parse(readFileSync(designedPath, 'utf8')))
  : [];
const designedItems = (Array.isArray(designed) ? designed : Object.values(designed))
  .map((c) => ({ ...c, file: (c.file || c.path || '').split('/').pop() }))
  .map((c) => ({ id: `designed/${c.file}`, src: leveled('designed', c.file), group: c.voiceId, engine: c.engine, seed: c.seed, description: c.description, flagged: c.flag || c.flagged || c.diverged }))
  .filter((c) => c.src);

const ACTORS = [
  ['alba-mackenna_casual.wav', 'Alba MacKenna · casual', 'Voice actor, very casual chat lines', 'CC BY 4.0'],
  ['alba-mackenna_a-moment-by.wav', 'Alba MacKenna · a moment', 'Voice actor, a gentle reflective read', 'CC BY 4.0'],
  ['alba-mackenna_merchant.wav', 'Alba MacKenna · merchant', 'Voice actor, a game-character voice', 'CC BY 4.0'],
  ['alba-mackenna_announcer.wav', 'Alba MacKenna · announcer', 'Voice actor, an announcer voice', 'CC BY 4.0'],
  ['unmute-prod-website_default_voice.wav', 'Unmute default', "The voice of Kyutai's Unmute demo", 'CC0'],
  ['unmute-prod-website_developer-1.mp3', 'Unmute developer', 'A Kyutai team recording', 'CC0'],
].map(([file, name, about, licence]) => ({ id: `src/${file}`, src: leveled('src', file), name, about, licence })).filter((a) => a.src);

const vz = JSON.parse(readFileSync(join(samples, 'pool/voicezero/index.json'), 'utf8'));
const narrators = Object.entries(vz).map(([file, v]) => ({
  id: `voicezero/${file}`, src: leveled('voicezero', file),
  name: file.replace(/\.flac$/, '').replace(/_/g, ' '),
  accent: (v.accent || 'unknown').replace(/^America$/, 'American'),
  pitch: v.f0 >= FEMALE_HZ ? 'higher' : 'lower', f0: v.f0,
})).filter((n) => n.src);

const data = { designed: designedItems, actors: ACTORS, narrators };
writeFileSync(join(samples, 'voices.html'), page(data));
console.log(`${designedItems.length} designed, ${ACTORS.length} actor, ${narrators.length} narrator clips → ${join(samples, 'voices.html')}`);

function page(payload) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Pick the voices</title>
<style>
:root{color-scheme:dark;--bg:#0c0d10;--card:#15171c;--ink:#e8e6e1;--dim:#8f929b;--line:#262932;--gold:#d8b46a;--green:#7fb58a}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,sans-serif}
header{position:sticky;top:0;z-index:3;background:#0c0d10f2;border-bottom:1px solid var(--line);padding:10px 24px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
header h1{font-size:15px;margin:0 12px 0 0;letter-spacing:.08em;text-transform:uppercase}
button,select{background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:6px;padding:6px 12px;cursor:pointer;font:inherit}
button.on{border-color:var(--gold);color:var(--gold)} button.playing{background:var(--gold);color:#000;border-color:var(--gold)}
button.pick.on{border-color:var(--green);color:var(--green)}
#now{margin-left:auto;color:var(--gold);font-size:14px}
main{max-width:1080px;margin:0 auto;padding:12px 24px 90px}
.panel{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 18px;margin:12px 0}
h2{margin:28px 0 4px;font-size:18px} p.dim{color:var(--dim);margin:0 0 8px}
.row{display:flex;gap:8px;align-items:center;padding:5px 0;border-top:1px solid var(--line);flex-wrap:wrap}
.row .name{min-width:230px} .row small{color:var(--dim)}
.row.picked{background:#7fb58a14}
#picks{color:var(--green)}
</style></head><body>
<header><h1>Pick the voices</h1><button id="stop">■ Stop</button><span id="picks"></span><span id="now"></span></header>
<main>
<div class="panel">
<p>Round one copied two flat 10-second recordings, and the clones came out flat. Choose the voices you'd actually want to talk to. Every engine that can copy a voice will then redo the whole script in your picks.</p>
<p>Pick as many as you like. <b>Two to four is ideal</b>, with at least one woman and one man.</p>
<p>Picks save straight to disk, so I see them.</p>
</div>
<div id="designedBox"></div>
<h2>Voice actors</h2><p class="dim">Real recordings from voice actors and Kyutai's team, cleared for any use.</p><div class="panel" id="actors"></div>
<h2>Audiobook narrators (${payload.narrators.length})</h2>
<p class="dim">Real LibriVox volunteers, public domain. "Higher" and "lower" is a rough split by pitch. Press <b>Next</b> to flip through them quickly.</p>
<div class="panel"><select id="pitch"><option value="higher">Higher voices</option><option value="lower">Lower voices</option><option value="">All</option></select>
<select id="accent"></select> <button id="next">▶ Next in this list</button> <span id="pos" class="dim"></span><div id="narr"></div></div>
</main>
<script>
const DATA = ${JSON.stringify(payload)};
const KEY = 'voice-bakeoff-picks';
const picks = new Set(JSON.parse(localStorage.getItem(KEY) || '[]'));
const save = () => { localStorage.setItem(KEY, JSON.stringify([...picks]));
  fetch('save/voice-picks', { method: 'POST', body: JSON.stringify({ picks: [...picks] }) }).catch(() => {});
  document.getElementById('picks').textContent = picks.size ? picks.size + ' picked' : ''; };
const el = (tag, attrs = {}, ...kids) => { const n = document.createElement(tag); Object.assign(n, attrs); n.append(...kids.filter((k) => k != null)); return n; };
const player = new Audio(); let current = null;
const now = document.getElementById('now');
const mark = () => document.querySelectorAll('button.play').forEach((b) => b.classList.toggle('playing', b.dataset.src === current));
const play = (src, who) => { current = src; player.src = src; now.textContent = '▶ ' + who; player.play().catch((e) => { now.textContent = 'Could not play: ' + e.message; }); mark(); };
player.onended = () => { current = null; mark(); now.textContent = ''; };
const stop = () => { player.pause(); current = null; mark(); now.textContent = ''; };
document.getElementById('stop').onclick = stop;
document.addEventListener('click', (e) => { const b = e.target.closest('button.play'); if (!b) return; if (b.dataset.src === current) return stop(); play(b.dataset.src, b.dataset.who); });
const playBtn = (src, label, who) => { const b = el('button', { className: 'play', textContent: '▶ ' + label }); Object.assign(b.dataset, { src, who }); return b; };
const pickBtn = (id, row) => { const b = el('button', { className: 'pick' + (picks.has(id) ? ' on' : ''), textContent: picks.has(id) ? '✓ Picked' : 'Pick' });
  b.onclick = () => { picks.has(id) ? picks.delete(id) : picks.add(id); b.classList.toggle('on'); b.textContent = picks.has(id) ? '✓ Picked' : 'Pick'; row.classList.toggle('picked', picks.has(id)); save(); }; return b; };
const row = (id, kids) => { const r = el('div', { className: 'row' + (picks.has(id) ? ' picked' : '') }); r.append(...kids, pickBtn(id, r)); return r; };

if (DATA.designed.length) {
  const box = document.getElementById('designedBox');
  box.append(el('h2', { textContent: 'Designed for this' }), el('p', { className: 'dim', textContent: 'Voices made from a written description. Each one speaks a natural, conversational passage with a laugh in it. Three different design engines tried each description, two attempts each. No real person is copied.' }));
  const groups = [...new Set(DATA.designed.map((d) => d.group))];
  const panel = el('div', { className: 'panel' });
  for (const g of groups) { const items = DATA.designed.filter((d) => d.group === g);
    panel.append(el('div', { style: 'margin-top:10px' }, el('b', { textContent: g }), el('small', { textContent: '  ' + (items[0].description || ''), style: 'color:var(--dim)' })));
    for (const d of items) panel.append(row(d.id, [el('span', { className: 'name' }, d.engine + ' · seed ' + d.seed, d.flagged ? el('small', { textContent: '  (flagged: drifted from the script)' }) : null), playBtn(d.src, 'Play', g + ' · ' + d.engine)])); }
  box.append(panel);
}
const actors = document.getElementById('actors');
for (const a of DATA.actors) actors.append(row(a.id, [el('span', { className: 'name' }, a.name, el('small', { textContent: '  ' + a.licence })), playBtn(a.src, 'Play', a.name), el('small', { textContent: a.about })]));

const accents = [...new Set(DATA.narrators.map((n) => n.accent.split(',')[0].trim()))].sort();
const accSel = document.getElementById('accent');
accSel.append(el('option', { value: '', textContent: 'Any accent' }), ...accents.map((a) => el('option', { value: a, textContent: a })));
accSel.value = 'American';
let list = []; let at = -1;
const renderNarr = () => { const p = document.getElementById('pitch').value; const a = accSel.value;
  list = DATA.narrators.filter((n) => (!p || n.pitch === p) && (!a || n.accent.startsWith(a))); at = -1;
  const box = document.getElementById('narr'); box.textContent = '';
  list.forEach((n) => box.append(row(n.id, [el('span', { className: 'name' }, n.name, el('small', { textContent: '  ' + n.accent })), playBtn(n.src, 'Play', n.name)])));
  document.getElementById('pos').textContent = list.length + ' voices'; };
document.getElementById('pitch').onchange = renderNarr; accSel.onchange = renderNarr;
document.getElementById('next').onclick = () => { if (!list.length) return; at = (at + 1) % list.length; const n = list[at];
  document.getElementById('pos').textContent = (at + 1) + ' of ' + list.length; play(n.src, n.name + ' (' + n.accent + ')'); };
renderNarr(); save();
</script></body></html>`;
}
