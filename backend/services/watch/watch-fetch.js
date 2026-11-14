// watch-fetch — a source made ready to watch or hear: a link fetched by yt-dlp (watch-plan.js), or
// a file on this computer, each kept in its own folder under <dataRoot>/watch/cache with what is
// known about it (title, who posted it, length, description, chapters, captions).
//
// A link is asked about first (what it is, and its captions: seconds, and for a talk or a podcast
// with captions, all that listening needs). The recording itself is fetched only when it is needed:
// the picture to watch, the sound to hear when there are no captions. When a site will not answer,
// yt-dlp updates itself once and the fetch is tried again; when the picture cannot be fetched but the
// captions were, the neuma still gets every word, and is told plainly what it could not see. Kept for
// a week, and the oldest go first past 12 GB. impure (network through the guarded proxy, fs)
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from '../logger.js';
import { readablePath } from '../fs-read-clearance.js';
import { checkPathAccess, isWithinRoots } from '../sandbox-path-policy.js';
import { startWatchEgress } from './watch-egress.js';
import { ensureFfmpeg, ensureYtDlp, jsRuntime, runTool, updateYtDlp, watchHome } from './watch-tools.js';
import { fetchFailure, isWatchableUrl, ytDlpArgs } from './watch-plan.js';
import { probeMedia } from './watch-media.js';

const log = createLogger('WatchFetch');
const KEEP_MS = 7 * 24 * 3600_000;
const KEEP_BYTES = 12 * 1024 ** 3;
const ENTRY = 'entry.json';
const CAPTION_EXT = /\.(vtt|srt)$/i;

const cacheHome = () => path.join(watchHome(), 'cache');
const keyOf = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 20);

// impure — a folder's files and their total size
const folderBytes = async (dir) => {
  let total = 0;
  for (const name of await fsp.readdir(dir).catch(() => [])) {
    const st = await fsp.stat(path.join(dir, name)).catch(() => null);
    if (st?.isFile()) total += st.size;
    else if (st?.isDirectory()) total += await folderBytes(path.join(dir, name));
  }
  return total;
};

/** impure — the cache kept to a week and to 12 GB, oldest first; the folder in use is never touched. */
const prune = async (keep) => {
  const names = await fsp.readdir(cacheHome()).catch(() => []);
  const entries = [];
  for (const name of names) {
    const dir = path.join(cacheHome(), name);
    if (dir === keep) continue;
    const st = await fsp.stat(dir).catch(() => null);
    if (st?.isDirectory()) entries.push({ dir, at: st.mtimeMs, bytes: await folderBytes(dir) });
  }
  entries.sort((a, b) => a.at - b.at);
  let total = entries.reduce((sum, e) => sum + e.bytes, 0);
  for (const e of entries) {
    if (Date.now() - e.at < KEEP_MS && total <= KEEP_BYTES) continue;
    await fsp.rm(e.dir, { recursive: true, force: true });
    total -= e.bytes;
  }
};

// impure — what is in a link's folder: the recording (one, the newest) and the caption tracks
const filesIn = async (dir) => {
  const names = await fsp.readdir(dir).catch(() => []);
  const media = names.filter((n) => n.startsWith('media.') && !/\.(json|vtt|srt|part|ytdl|temp)$/i.test(n) && !/\.f\d+\./.test(n));
  const captions = names.filter((n) => n.startsWith('media.') && CAPTION_EXT.test(n));
  // English first, then the language the video speaks itself
  const english = (n) => /\.en[.-]/.test(n);
  captions.sort((a, b) => Number(!english(a)) - Number(!english(b)) || a.localeCompare(b));
  return { media: media[0] ? path.join(dir, media[0]) : null, captions: captions[0] ? path.join(dir, captions[0]) : null };
};

// impure — one yt-dlp run through a guarded proxy of its own; a refusal names what was refused
const runYtDlp = async (want, url, dir) => {
  const { bin } = await ensureYtDlp();
  const ff = want === 'info' ? null : await ensureFfmpeg();
  const egress = await startWatchEgress();
  try {
    const args = ytDlpArgs({ url, dir, proxy: egress.url, want, ffmpegDir: ff?.dir || null, jsRuntime: jsRuntime(), cacheDir: path.join(watchHome(), 'tools', 'yt-dlp-cache') });
    const r = await runTool(bin, args, { timeoutMs: want === 'info' ? 180_000 : 45 * 60_000, cwd: dir });
    if (r.ok) return { ok: true };
    const failure = fetchFailure(r.stderr);
    if (egress.refused.length) failure.why = `the address leads inside this computer or its network, which a neuma never reaches (${egress.refused[0]})`;
    return { ok: false, ...failure, refusedInside: egress.refused.length > 0 };
  } finally {
    await egress.close();
  }
};

// impure — a run that, failing because the site changed, updates yt-dlp once and tries again
const fetchWithUpdate = async (want, url, dir) => {
  const first = await runYtDlp(want, url, dir);
  if (first.ok || !first.stale || first.refusedInside) return first;
  const egress = await startWatchEgress();
  let updated = false;
  try { updated = await updateYtDlp({ proxy: egress.url }); } finally { await egress.close(); }
  if (!updated) return first;
  log.info('trying the fetch again on the updated yt-dlp', { want });
  return runYtDlp(want, url, dir);
};

// pure — what a being is told about a link, from yt-dlp's own record of it
const describe = (info, url) => ({
  title: info.title || info.fulltitle || url,
  uploader: info.uploader || info.channel || info.creator || null,
  url: info.webpage_url || url,
  site: info.extractor_key || info.extractor || null,
  uploaded: info.upload_date ? `${info.upload_date.slice(0, 4)}-${info.upload_date.slice(4, 6)}-${info.upload_date.slice(6, 8)}` : null,
  views: Number.isFinite(info.view_count) ? info.view_count : null,
  duration: Number.isFinite(info.duration) ? info.duration : null,
  description: String(info.description || '').slice(0, 4000),
  chapters: (info.chapters || []).map((c) => ({ start: c.start_time, title: c.title })).filter((c) => Number.isFinite(c.start)),
  live: info.is_live === true,
});

const saveEntry = (entry) => fsp.writeFile(path.join(entry.dir, ENTRY), JSON.stringify(entry, null, 2));
const loadEntry = (dir) => { try { return { ...JSON.parse(fs.readFileSync(path.join(dir, ENTRY), 'utf8')), dir }; } catch { return null; } };

/**
 * A link made ready: its record and captions, and the recording itself when `need` asks for it
 * ('video' to watch, 'sound' to hear when there are no captions). impure
 * @param {string} url
 * @param {'video'|'sound'} need
 * @returns {Promise<{ok: true, entry: Object} | {ok: false, why: string, line?: string}>}
 */
const readyLink = async (url, need) => {
  const dir = path.join(cacheHome(), keyOf(url));
  await fsp.mkdir(dir, { recursive: true });
  await fsp.utimes(dir, new Date(), new Date()).catch(() => {});
  prune(dir).catch((err) => log.warn('the watch cache could not be pruned', { error: err.message }));
  let entry = loadEntry(dir);
  if (!entry) {
    const info = await fetchWithUpdate('info', url, dir);
    if (!info.ok) return { ok: false, why: info.why, line: info.line };
    let record = {};
    try { record = JSON.parse(await fsp.readFile(path.join(dir, 'media.info.json'), 'utf8')); } catch { /* the fetch below still tries */ }
    const { captions } = await filesIn(dir);
    entry = { kind: 'link', source: url, dir, ...describe(record, url), captions, file: null, media: null, hasVideo: null, misses: [] };
    await saveEntry(entry);
  }
  if (entry.live) return { ok: false, why: 'it is a live stream that is still going; it can be watched once it has ended' };
  const wanted = need === 'video' ? entry.media !== 'video' : (!entry.captions && !entry.file);
  if (wanted) {
    const got = await fetchWithUpdate(need === 'video' ? 'video' : 'audio', url, dir);
    if (got.ok) {
      const { media, captions } = await filesIn(dir);
      if (media) {
        const probe = await probeMedia(media);
        Object.assign(entry, { file: media, media: probe.hasVideo ? 'video' : 'audio', hasVideo: probe.hasVideo, hasAudio: probe.hasAudio, duration: entry.duration ?? probe.duration, captions: entry.captions || captions });
      }
    } else {
      entry.misses = [...new Set([...(entry.misses || []), `${need === 'video' ? 'the picture' : 'the sound'} could not be fetched: ${got.why}`])];
      if (!entry.captions) return { ok: false, why: got.why, line: got.line };
    }
    await saveEntry(entry);
  }
  return { ok: true, entry };
};

/**
 * A file on this computer, made ready: read where it lies (never copied), cleared by the same deny
 * law a file read is (no secrets), and inside the neuma's own workspace or the ground the platform
 * may stand on. Captions beside it (same name, .vtt or .srt) are used. impure
 * @param {string} requested
 * @param {string|null} laneDir - the neuma's workspace, where a relative path starts
 */
const readyFile = async (requested, laneDir) => {
  const asked = laneDir && !path.isAbsolute(requested) ? path.join(laneDir, requested) : requested;
  let real;
  try {
    real = laneDir && isWithinRoots(fs.realpathSync(asked), [fs.realpathSync(laneDir)]) ? fs.realpathSync(asked) : await readablePath(asked);
  } catch (err) {
    return { ok: false, why: err.code === 'ENOENT' ? 'there is no such file' : `that file is outside what a neuma may read (${err.message})` };
  }
  const verdict = checkPathAccess(real);
  if (!verdict.allowed) return { ok: false, why: `that file is outside what a neuma may read (${verdict.reason})` };
  const st = await fsp.stat(real);
  if (!st.isFile()) return { ok: false, why: 'that is a folder, not a recording' };
  const dir = path.join(cacheHome(), keyOf(`${real}|${st.size}|${st.mtimeMs}`));
  await fsp.mkdir(dir, { recursive: true });
  let entry = loadEntry(dir);
  if (!entry) {
    const probe = await probeMedia(real);
    if (!probe.hasVideo && !probe.hasAudio) return { ok: false, why: 'the file holds no video or sound' };
    const stem = real.replace(/\.[^./\\]+$/, '');
    const beside = await fsp.readdir(path.dirname(real)).catch(() => []);
    const caption = beside.map((n) => path.join(path.dirname(real), n)).find((p) => p.startsWith(`${stem}.`) && CAPTION_EXT.test(p)) || null;
    entry = { kind: 'file', source: real, dir, title: path.basename(real), uploader: null, url: null, site: null, uploaded: st.mtime.toISOString().slice(0, 10),
      views: null, duration: probe.duration, description: '', chapters: [], live: false, captions: caption, file: real,
      media: probe.hasVideo ? 'video' : 'audio', hasVideo: probe.hasVideo, hasAudio: probe.hasAudio, misses: [] };
    await saveEntry(entry);
  }
  return { ok: true, entry };
};

/**
 * A source made ready to watch ('video') or hear ('sound'). impure
 * @param {string} source - a link, or a path on this computer
 * @param {{need: 'video'|'sound', laneDir: string|null}} ask
 */
export const readySource = async (source, { need, laneDir }) => {
  const s = String(source || '').trim();
  if (!s) return { ok: false, why: 'no source was given: name a link or a file' };
  if (isWatchableUrl(s)) return readyLink(s, need);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return { ok: false, why: 'only an http or https link, or a file on this computer, can be watched' };
  return readyFile(s, laneDir);
};

/** A scratch folder for one call's frames, inside the source's own folder. Pure. */
export const scratchFor = (entry) => path.join(entry.dir, `frames-${process.pid}-${Date.now()}`);
