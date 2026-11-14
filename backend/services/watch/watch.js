// watch — a neuma watches a video or listens to audio, one part at a time, and keeps what it heard.
//
// One call covers one part (ten minutes unless it asks otherwise): what is said in it, with the second
// each sentence begins, and, to watch, frames from across it on sheets it looks at (the first look at a
// long video also gets one sheet across the whole of it). The full transcript heard so far is kept in
// the neuma's workspace under watched/, so what it learned outlives the turn; what it makes of it is
// its own to write down. impure (watch-fetch, watch-hear, watch-media, one workspace file)
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from '../logger.js';
import { registerEphemeralSight } from '../image-forge/ephemeral-sight.js';
import { MAX_IMAGES_PER_MESSAGE } from '../attachment-store.js';
import { OVERVIEW, SHEET, WINDOW_S, clock, watchedFileName, windowOf } from './watch-plan.js';
import { readySource, scratchFor } from './watch-fetch.js';
import { heardIn, heardSoFar } from './watch-hear.js';
import { frameSheets } from './watch-media.js';

const log = createLogger('Watch');

// pure — the record of what was watched, as the neuma reads it
const header = (e) => [
  `${e.title}${e.uploader ? ` — ${e.uploader}` : ''}${e.site ? ` (${e.site})` : ''}`,
  [e.url || e.source, e.duration ? `length ${clock(e.duration)}` : 'length unknown', e.uploaded ? `posted ${e.uploaded}` : '', e.views !== null && e.views !== undefined ? `${e.views.toLocaleString('en-US')} views` : '']
    .filter(Boolean).join(' · '),
].join('\n');

// pure — the transcript file: the record, then every paragraph heard so far
const transcriptFile = (e, lines, from) => [
  `# ${e.title}`,
  '',
  header(e).split('\n').slice(1).join('\n'),
  '',
  e.description ? `## Description\n\n${e.description}\n` : '',
  e.chapters?.length ? `## Chapters\n\n${e.chapters.map((c) => `- ${clock(c.start)} ${c.title}`).join('\n')}\n` : '',
  `## Transcript (${from === 'captions' ? 'the recording\'s own captions' : 'heard on this computer'})`,
  '',
  lines.map((l) => `[${clock(l.at)}] ${l.text}`).join('\n') || '(nothing heard yet)',
  '',
].filter((part) => part !== '').join('\n');

/**
 * Watch or listen to one part of a source. Never throws: a source that cannot be had answers why.
 * @param {{laneId: string|null, laneDir: string|null, source: string, from?: unknown, to?: unknown, mode: 'watch'|'listen'}} ask
 * @returns {Promise<{ok: boolean, content?: string, error?: string, summary: string, imageIds?: string[], file?: string|null}>}
 */
export const watchSource = async ({ laneId, laneDir, source, from, to, mode }) => {
  const verb = mode === 'watch' ? 'watch' : 'listen to';
  let ready;
  try {
    ready = await readySource(source, { need: mode === 'watch' ? 'video' : 'sound', laneDir });
  } catch (err) {
    log.warn('a source could not be made ready', { error: err.message });
    ready = { ok: false, why: err.message };
  }
  if (!ready.ok) {
    return {
      ok: false, summary: `could not ${verb} — ${ready.why}`,
      error: `Could not ${verb} ${source}: ${ready.why}.${ready.line ? `\n(yt-dlp: ${ready.line})` : ''}\nIf it is a page with words rather than a recording, read it with web_fetch.`,
    };
  }
  const e = ready.entry;
  if (mode === 'listen' && e.file && e.hasAudio === false && !e.captions) {
    return { ok: false, summary: `could not ${verb} — it has no sound`, error: `Could not ${verb} ${source}: the recording has no sound${e.hasVideo ? '; watch it with media_watch to see it' : ''}.` };
  }
  const w = windowOf({ from, to, duration: e.duration });
  const heard = await heardIn(e, w.start, w.end).catch((err) => ({ lines: [], from: 'none', note: err.message }));

  // the picture: sheets across this part, and once, on a first look at a long video, the whole of it
  let sheets = [];
  const seeing = mode === 'watch' && e.hasVideo && e.file;
  if (seeing) {
    const long = e.duration && e.duration > WINDOW_S && w.start === 0;
    const parts = await Promise.all([
      long ? frameSheets(e.file, { start: 0, end: e.duration, sheets: 1, ...OVERVIEW, scratch: `${scratchFor(e)}-all` }).then((s) => s.map((x) => ({ ...x, whole: true }))) : [],
      frameSheets(e.file, { start: w.start, end: w.end, sheets: SHEET.perPart, ...SHEET, scratch: scratchFor(e) }),
    ]).catch((err) => { log.warn('frames could not be taken', { error: err.message }); return [[], []]; });
    sheets = parts.flat().slice(0, MAX_IMAGES_PER_MESSAGE);
  }
  let imageIds = [];
  if (sheets.length && laneId) {
    try { imageIds = [...registerEphemeralSight(laneId, sheets.map((s) => ({ mime: 'image/jpeg', bytes: s.bytes })))]; } catch (err) { log.warn('frames could not be placed in sight', { error: err.message }); }
  }
  const shown = sheets.slice(0, imageIds.length);

  // the transcript kept in the workspace, rewritten whole with every part heard so far
  let file = null;
  if (laneDir) {
    try {
      file = `watched/${watchedFileName(e.title, new Date(e.firstWatched || Date.now()))}`;
      await fsp.mkdir(path.join(laneDir, 'watched'), { recursive: true });
      await fsp.writeFile(path.join(laneDir, file), transcriptFile(e, await heardSoFar(e), heard.from));
    } catch (err) {
      log.warn('the transcript could not be kept', { error: err.message });
      file = null;
    }
  }

  const span = `${clock(w.start)}–${clock(w.end)}`;
  const content = [
    `${mode === 'watch' ? 'WATCHING' : 'LISTENING TO'}: ${header(e)}`,
    e.description && w.start === 0 ? `DESCRIPTION: ${e.description.slice(0, 1200)}${e.description.length > 1200 ? '…' : ''}` : '',
    e.chapters?.length && w.start === 0 ? `CHAPTERS: ${e.chapters.map((c) => `${clock(c.start)} ${c.title}`).join(' · ')}` : '',
    ...(e.misses || []).map((m) => `NOTE: ${m}.`),
    `HEARD ${span} (${heard.from === 'captions' ? 'the recording\'s own captions' : heard.from === 'heard' ? 'heard on this computer' : 'nothing'}):`,
    heard.lines.length ? heard.lines.map((l) => `[${clock(l.at)}] ${l.text}`).join('\n') : `(no speech in this part${heard.note ? `: ${heard.note}` : ''})`,
    shown.length ? `SEEN: ${shown.map((s, i) => `sheet ${i + 1}${s.whole ? ' (the whole video)' : ''}: ${s.moments.length} frames at ${s.moments.map(clock).join(', ')}`).join('; ')}. Each sheet reads left to right, top to bottom.` : '',
    mode === 'watch' && !e.hasVideo ? 'NOTE: this recording has no picture, only sound.' : '',
    w.last || !e.duration ? 'END: that is the end of the recording.' : `NEXT: ${clock(e.duration - w.end)} remain — call again with from "${clock(w.end)}" for the next part.`,
    file ? `KEPT: the transcript heard so far is at ${file} in your workspace. Write down what you learned from it in your own notes.` : '',
  ].filter(Boolean).join('\n');

  if (!e.firstWatched && laneDir) {
    e.firstWatched = new Date().toISOString();
    await fsp.writeFile(path.join(e.dir, 'entry.json'), JSON.stringify(e, null, 2)).catch(() => {});
  }
  const summary = `${mode === 'watch' ? 'watched' : 'listened to'} ${e.title.slice(0, 70)} · ${span}${e.duration ? ` of ${clock(e.duration)}` : ''} · ${heard.from === 'captions' ? 'captions' : `${heard.lines.length} lines heard`}${shown.length ? ` · ${shown.reduce((n, s) => n + s.moments.length, 0)} frames` : ''}`;
  return { ok: true, content, summary, imageIds, file };
};
