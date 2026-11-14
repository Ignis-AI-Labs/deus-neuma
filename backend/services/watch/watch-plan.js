// watch-plan — a neuma watches a video or listens to audio from any source, and learns from it.
// Pure: the pinned tools, the downloader's arguments, the clock, captions read into lines, and the
// part of a recording one call covers. watch.js does the work.
//
// Design note, 2026-11-14: […], then: […]
//
// ANY SOURCE is yt-dlp: one tool that knows how to fetch from well over a thousand sites (YouTube,
// X, TikTok, Instagram, Vimeo, Twitch, Facebook, Reddit, SoundCloud, Bandcamp, podcasts, news sites,
// and any page with a plain video or audio file on it). It is downloaded on first use from its own
// GitHub releases, pinned to the size and SHA-256 published there, like every engine the app sets
// up (managed-stt-plan.js). Sites change and break old copies, so when a site will not answer the
// pinned copy, the app asks yt-dlp to update itself once; yt-dlp checks its own update against its
// publisher's signature. ffmpeg cuts the picture into frames and the sound into what speech
// recognition reads; a machine without one gets a pinned static build.

export const YT_DLP_VERSION = '2026.10.26';
const YT_DLP_RELEASE = `https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}`;
// GitHub's own digests, the same as yt-dlp's SHA2-256SUMS for this release (checked 2026-11-14)
const MAC = Object.freeze({ name: 'yt-dlp_macos', size: 37_466_304, sha256: '0f922c15ccc0b83eefa1c8bc9104e434318c4bf16e408e1ee93b7745a6efe0aa', bin: 'yt-dlp' });
const YT_DLP = Object.freeze({
  'linux-x64': Object.freeze({ name: 'yt-dlp_linux', size: 41_166_968, sha256: '767ba9dce7052aa196f8b12652f433d76de128ba168966fa84b6394d5e6c6795', bin: 'yt-dlp' }),
  'linux-arm64': Object.freeze({ name: 'yt-dlp_linux_aarch64', size: 40_789_792, sha256: 'e87e9533e89fe5889abaa21f5114dfe7756d6aa6219b83551add04d48b18e483', bin: 'yt-dlp' }),
  'win32-x64': Object.freeze({ name: 'yt-dlp.exe', size: 23_575_744, sha256: 'f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d', bin: 'yt-dlp.exe' }),
  'darwin-x64': MAC,
  'darwin-arm64': MAC,
});

/** The pinned yt-dlp for this system, or null where none is published. Pure. */
export const ytDlpFor = (platform, arch) => {
  const e = YT_DLP[`${platform}-${arch}`];
  return e ? Object.freeze({ ...e, label: 'yt-dlp', version: YT_DLP_VERSION, url: `${YT_DLP_RELEASE}/${e.name}` }) : null;
};

// Static ffmpeg and ffprobe, gzipped, from the builds the ffmpeg-static package publishes (one
// release, every system). Only where the machine has no ffmpeg of its own.
export const FFMPEG_BUILD = 'b6.1.1';
const FFMPEG_RELEASE = `https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_BUILD}`;
const pair = (ffmpeg, ffprobe) => Object.freeze({ ffmpeg: Object.freeze(ffmpeg), ffprobe: Object.freeze(ffprobe) });
const FFMPEG = Object.freeze({
  'linux-x64': pair({ size: 29_354_986, sha256: 'bfe8a8fc511530457b528c48d77b5737527b504a3797a9bc4866aeca69c2dffa' }, { size: 29_276_839, sha256: '25d9b6ccb05e3d9de9e04e31e2506d8dd7f9f0418981965ac6df12e8d3afd067' }),
  'linux-arm64': pair({ size: 25_568_691, sha256: '754a678672298bc68156adff58aa7385a592c2b30b1d0ae8750c45c915c4bac0' }, { size: 25_493_573, sha256: '2ab6aba60ee84412dff9188720703376cb4e7aaf7e0b5e43aa8249f2acae5bf8' }),
  'win32-x64': pair({ size: 29_581_307, sha256: '8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77' }, { size: 29_521_644, sha256: 'f309e6223ad89d2fe54bccd420a7709b66fd27540674e92309578ed491a43c8d' }),
  'darwin-x64': pair({ size: 25_296_431, sha256: '929b375c1182d956c51f7ac25e0b2b0411fb01f6f407aa15c9758efeb4242106' }, { size: 25_239_438, sha256: 'd4da574d6e2e197bd259b47d69cf262df9e312af24ad960444f6d806d3d4c186' }),
  'darwin-arm64': pair({ size: 19_246_198, sha256: '8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa' }, { size: 19_207_077, sha256: 'd986a8ec7b030899fe66a8a288ed809a3543338705a3ce178cfb85869c5d80be' }),
});

/** The pinned ffmpeg and ffprobe for this system ({ffmpeg, ffprobe}), or null. Pure. */
export const ffmpegFor = (platform, arch) => {
  const key = `${platform}-${arch}`;
  const p = FFMPEG[key];
  if (!p) return null;
  const exe = platform === 'win32' ? '.exe' : '';
  const asset = (tool) => Object.freeze({
    ...p[tool], label: tool, name: `${tool}-${key}.gz`, format: 'gz', bin: `${tool}${exe}`, url: `${FFMPEG_RELEASE}/${tool}-${key}.gz`,
  });
  return Object.freeze({ ffmpeg: asset('ffmpeg'), ffprobe: asset('ffprobe') });
};

// ── what one call covers ─────────────────────────────────────────────────────

/** One call hears and sees this much of a recording, unless it asks for less. */
export const WINDOW_S = 600;
/** The most one call may ask for. */
export const MAX_WINDOW_S = 1800;
/** Frames per sheet (three across, three down), sheets per part, and one sheet's frame width. */
export const SHEET = Object.freeze({ across: 3, down: 3, perPart: 2, width: 426 });
/** The overview a first look at a long video opens with: four across, three down, smaller. */
export const OVERVIEW = Object.freeze({ across: 4, down: 3, width: 320 });

/**
 * Seconds from what a being writes for a time: "1:02:03", "62:03", "90", "90s", "1h2m3s".
 * Null for nothing usable. Pure.
 * @param {unknown} raw
 * @returns {number|null}
 */
export const parseClock = (raw) => {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? raw : null;
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return null;
  if (/^\d+(\.\d+)?s?$/.test(s)) return Number(s.replace(/s$/, ''));
  const hms = /^(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+(?:\.\d+)?)s)?$/.exec(s);
  if (hms && (hms[1] || hms[2] || hms[3])) return Number(hms[1] || 0) * 3600 + Number(hms[2] || 0) * 60 + Number(hms[3] || 0);
  const parts = s.split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  return parts.map(Number).reduce((total, n) => total * 60 + n, 0);
};

/** "m:ss", or "h:mm:ss" past an hour. Pure. */
export const clock = (seconds) => {
  const t = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

/**
 * The part of a recording one call covers: from where it asked (or the start), for a window (or to
 * where it asked, at most MAX_WINDOW_S), never past the end. Pure.
 * @param {{from?: unknown, to?: unknown, duration: number|null}} ask
 * @returns {{start: number, end: number, last: boolean}} `last` only when the length is known
 */
export const windowOf = ({ from, to, duration }) => {
  const known = Number.isFinite(duration) && duration > 0;
  let start = parseClock(from) ?? 0;
  if (known && start >= duration) start = Math.max(0, duration - Math.min(WINDOW_S, duration));
  const asked = parseClock(to);
  let end = asked !== null && asked > start ? Math.min(asked, start + MAX_WINDOW_S) : start + WINDOW_S;
  if (known) end = Math.min(end, duration);
  return { start, end, last: known && end >= duration - 0.5 };
};

/**
 * Evenly spaced moments across [start, end): `n` of them, the first at the start, never at the very
 * end (a time at the end decodes nothing). Pure.
 */
export const momentsIn = (start, end, n) => {
  if (!(end > start) || n < 1) return [];
  const step = (end - start) / n;
  return Array.from({ length: n }, (_, i) => Math.round((start + step * i) * 100) / 100);
};

// ── captions ─────────────────────────────────────────────────────────────────

const CUE_TIME = /(\d+:)?\d{1,2}:\d{2}[.,]\d{1,3}/g;

// pure — "00:01:02.345" or "01:02,345" in seconds
const cueSeconds = (stamp) => {
  const [hms, frac] = stamp.replace(',', '.').split('.');
  const parts = hms.split(':').map(Number);
  return parts.reduce((total, n) => total * 60 + n, 0) + Number(`0.${frac || 0}`);
};

/**
 * WebVTT or SRT captions as spoken lines with the second each begins, in order. Inline timing and
 * styling tags are dropped, and the rolling repeats of automatic captions (each cue carries the line
 * before it again) are said once. Pure.
 * @param {string} text
 * @returns {Array<{at: number, text: string}>}
 */
export const parseCaptions = (text) => {
  const out = [];
  const recent = [];
  for (const block of String(text || '').replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = block.split('\n');
    const timing = lines.findIndex((l) => l.includes('-->'));
    if (timing < 0) continue;
    const stamps = lines[timing].match(CUE_TIME);
    if (!stamps) continue;
    const at = cueSeconds(stamps[0]);
    for (const raw of lines.slice(timing + 1)) {
      const line = raw.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ').trim();
      if (!line || recent.includes(line)) continue;
      out.push({ at, text: line });
      recent.push(line);
      if (recent.length > 3) recent.shift();
    }
  }
  return out;
};

/**
 * Lines gathered into short timed paragraphs, a new one every `every` seconds, so a page reads as
 * speech rather than as a caption track. Pure.
 * @param {Array<{at: number, text: string}>} lines
 * @param {number} [every]
 * @returns {Array<{at: number, text: string}>}
 */
export const paragraphs = (lines, every = 20) => {
  const out = [];
  for (const line of lines) {
    const open = out[out.length - 1];
    if (open && line.at - open.at < every) open.text = `${open.text} ${line.text}`;
    else out.push({ at: line.at, text: line.text });
  }
  return out;
};

/** The heard paragraphs inside [start, end). Pure. */
export const linesIn = (lines, start, end) => lines.filter((l) => l.at >= start && (end === null || l.at < end));

// ── the downloader ───────────────────────────────────────────────────────────

/** Caption tracks asked for: English in any form, and whatever language the video speaks itself. */
export const CAPTION_LANGS = 'en.*,.*-orig';

/**
 * A link a being may hand the downloader: http or https only, never a local or option-shaped string.
 * Pure.
 */
export const isWatchableUrl = (raw) => {
  try {
    const u = new URL(String(raw || '').trim());
    return (u.protocol === 'http:' || u.protocol === 'https:') && Boolean(u.hostname);
  } catch {
    return false;
  }
};

/**
 * yt-dlp's arguments for one fetch, into its own folder. Every run ignores any yt-dlp configuration
 * and plugin on the machine (either could run anything), reaches the network only through the
 * platform's guarded proxy (watch-egress.js), downloads with its own downloader (never ffmpeg's, which
 * would bypass the proxy), and takes the link after `--` so it can never be read as an option. Pure.
 * @param {{url: string, dir: string, proxy: string, want: 'info'|'video'|'audio', ffmpegDir?: string|null,
 *   jsRuntime?: string|null, cacheDir: string}} run
 * @returns {string[]}
 */
export const ytDlpArgs = ({ url, dir, proxy, want, ffmpegDir = null, jsRuntime = null, cacheDir }) => {
  if (!isWatchableUrl(url)) throw new Error('only an http or https link can be watched');
  const common = [
    '--ignore-config', '--no-plugin-dirs', '--no-update', '--no-playlist', '--playlist-items', '1',
    '--proxy', proxy, '--downloader', 'native', '--socket-timeout', '30', '--retries', '3',
    '--cache-dir', cacheDir, '--restrict-filenames', '--no-mtime', '--no-progress', '--no-warnings',
    '--paths', dir, '--output', 'media.%(ext)s',
    ...(ffmpegDir ? ['--ffmpeg-location', ffmpegDir] : []),
    ...(jsRuntime ? ['--js-runtimes', `node:${jsRuntime}`] : []),
  ];
  if (want === 'info') {
    return [...common, '--skip-download', '--write-info-json', '--write-subs', '--write-auto-subs',
      '--sub-langs', CAPTION_LANGS, '--sub-format', 'vtt/srt/best', '--', url];
  }
  const format = want === 'audio'
    ? 'ba/b'
    : 'bv*[height<=720]+ba/b[height<=720]/bv*+ba/b';
  return [...common, '--format', format, '--merge-output-format', 'mkv', '--max-filesize', '4G', '--', url];
};

/** yt-dlp's arguments to update itself (it checks the update against its publisher's key). Pure. */
export const ytDlpUpdateArgs = ({ proxy }) => ['--ignore-config', '--no-plugin-dirs', '--proxy', proxy, '--update-to', 'stable'];

/**
 * What a failed fetch means, from yt-dlp's last ERROR line. `stale` asks for the one self-update:
 * the site changed under the pinned copy. Pure.
 * @param {string} stderr
 * @returns {{why: string, stale: boolean, line: string}}
 */
export const fetchFailure = (stderr) => {
  const lines = String(stderr || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const line = [...lines].reverse().find((l) => l.startsWith('ERROR:')) || lines[lines.length - 1] || 'no answer';
  const has = (re) => re.test(line);
  if (has(/Unsupported URL/i)) return { why: 'no video or audio was found at that address', stale: false, line };
  if (has(/not a bot/i)) return { why: 'the site asked to confirm this is not a bot', stale: true, line };
  if (has(/sign in|log ?in|login required|cookies|age.?restrict|confirm your age|members-only|private video|This video is private/i)) {
    return { why: 'the site shows this only to a signed-in account', stale: false, line };
  }
  if (has(/HTTP Error 404|not found|has been removed|no longer available|unavailable/i)) return { why: 'the site says it is gone or unavailable', stale: false, line };
  if (has(/refused by the platform/i)) return { why: 'the address leads inside this computer or its network, which a neuma never reaches', stale: false, line };
  if (has(/larger than max-filesize|File is larger/i)) return { why: 'the file is larger than 4 GB', stale: false, line };
  if (has(/Unable to extract|Unable to download (?:API|JSON|webpage)|Signature extraction|nsig|player|Requested format is not available|Failed to parse|KeyError|IndexError|extractor/i)) {
    return { why: 'the site changed how it serves this', stale: true, line };
  }
  if (has(/timed out|Connection|getaddrinfo|Network is unreachable|Temporary failure/i)) return { why: 'the network did not answer', stale: false, line };
  return { why: 'the fetch failed', stale: true, line };
};

/** A file-safe name for what was watched, from its title. Pure. */
export const watchedFileName = (title, now = new Date()) => {
  const slug = String(title || 'watched').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'watched';
  return `${now.toISOString().slice(0, 10)}-${slug}.md`;
};
