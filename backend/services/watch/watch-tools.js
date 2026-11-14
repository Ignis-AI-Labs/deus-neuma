// watch-tools — the downloader and ffmpeg, found or set up on first use. impure (network, fs, child
// processes)
//
// Both live under <dataRoot>/watch/tools, never inside the install (read-only once installed). yt-dlp
// is the pinned release (watch-plan.js) until a site changes under it; then yt-dlp updates itself,
// at most once every six hours, and the record says which version is on disk and where it came
// from. ffmpeg is the machine's own when it has one (FFMPEG_PATH, then the PATH), else the pinned
// static build. Every download is checked against its pinned size and SHA-256 before it is used.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFile } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { getDataRoot } from '../data-root.js';
import { obtainArchive } from '../managed-ollama-download.js';
import { probeEnvironment } from '../agent-terminal-environment.js';
import { createLogger } from '../logger.js';
import { FFMPEG_BUILD, YT_DLP_VERSION, ffmpegFor, ytDlpFor, ytDlpUpdateArgs } from './watch-plan.js';

const log = createLogger('WatchTools');
const UPDATE_EVERY_MS = 6 * 3600_000;

export const watchHome = () => path.join(getDataRoot(), 'watch');
const toolsHome = () => path.join(watchHome(), 'tools');
const ytDir = () => path.join(toolsHome(), 'yt-dlp');
const recordPath = () => path.join(ytDir(), 'record.json');

/**
 * The environment the tools run in: the probe environment (never the backend's secrets), and, in
 * the installed app, the app's own Electron answering as Node: the JavaScript runtime yt-dlp needs
 * for YouTube. impure (env)
 */
export const toolEnvironment = () => ({ ...probeEnvironment(), ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) });

/** The JavaScript runtime handed to yt-dlp: this process's own Node (or Electron as Node). */
export const jsRuntime = () => process.execPath;

/**
 * Run a tool to the end. Never rejects. impure
 * @returns {Promise<{ok: boolean, stdout: string, stderr: string}>}
 */
export const runTool = (bin, args, { timeoutMs = 60_000, cwd } = {}) => new Promise((resolve) => {
  execFile(bin, args, { env: toolEnvironment(), cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
    (err, stdout, stderr) => resolve({ ok: !err, stdout: String(stdout || ''), stderr: `${stderr || ''}${err && !stderr ? err.message : ''}` }));
});

// pure — yt-dlp's dated versions compared as numbers (2026.10.26 < 2026.11.2)
const newer = (a, b) => {
  const pa = String(a || '').split('.').map(Number);
  const pb = String(b || '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
};

const readRecord = () => { try { return JSON.parse(fs.readFileSync(recordPath(), 'utf8')); } catch { return null; } };
const writeRecord = (record) => fsp.writeFile(recordPath(), JSON.stringify(record, null, 2));

// impure — a gzipped binary unpacked beside where it goes, made runnable, then moved in
const gunzipTo = async (gz, bin) => {
  const tmp = `${bin}.unpacking`;
  await fsp.mkdir(path.dirname(bin), { recursive: true });
  await pipeline(fs.createReadStream(gz), zlib.createGunzip(), fs.createWriteStream(tmp));
  if (process.platform !== 'win32') await fsp.chmod(tmp, 0o755);
  await fsp.rename(tmp, bin);
  await fsp.rm(gz, { force: true });
};

let ytReady = null;
let ffReady = null;

/**
 * yt-dlp on disk, set up from the pin when it is missing or older than the app's pin. impure
 * @returns {Promise<{bin: string, version: string}>}
 */
export const ensureYtDlp = () => (ytReady ??= (async () => {
  const pin = ytDlpFor(process.platform, process.arch);
  if (!pin) throw new Error(`no yt-dlp is published for ${process.platform} ${process.arch}`);
  const bin = path.join(ytDir(), pin.bin);
  const record = readRecord();
  if (fs.existsSync(bin) && record && !newer(YT_DLP_VERSION, record.version)) return { bin, version: record.version };
  await fsp.mkdir(ytDir(), { recursive: true });
  const download = path.join(ytDir(), `${pin.name}.download`);
  await obtainArchive(pin, download);
  if (process.platform !== 'win32') await fsp.chmod(download, 0o755);
  await fsp.rename(download, bin);
  await writeRecord({ version: YT_DLP_VERSION, from: 'pinned release', at: new Date().toISOString() });
  log.info('yt-dlp set up', { version: YT_DLP_VERSION });
  return { bin, version: YT_DLP_VERSION };
})().catch((err) => { ytReady = null; throw err; }));

/**
 * A site changed under the copy here: yt-dlp updates itself (through the guarded proxy, checked
 * against its publisher's key), at most once every six hours. Answers whether a newer version is now
 * on disk. impure
 * @param {{proxy: string}} through
 */
export const updateYtDlp = async ({ proxy }) => {
  const { bin } = await ensureYtDlp();
  const record = readRecord() || {};
  if (record.triedAt && Date.now() - Date.parse(record.triedAt) < UPDATE_EVERY_MS) return false;
  await writeRecord({ ...record, triedAt: new Date().toISOString() });
  await runTool(bin, ytDlpUpdateArgs({ proxy }), { timeoutMs: 300_000 });
  const version = (await runTool(bin, ['--version'], { timeoutMs: 60_000 })).stdout.trim();
  if (!version || version === record.version) return false;
  await writeRecord({ version, from: 'self-update', at: new Date().toISOString(), triedAt: new Date().toISOString() });
  ytReady = null;
  log.info('yt-dlp updated itself', { from: record.version, to: version });
  return true;
};

/**
 * ffmpeg and ffprobe: the machine's own, or the pinned static build. impure
 * @returns {Promise<{ffmpeg: string, ffprobe: string, dir: string|null}>} `dir` is handed to yt-dlp
 *   when the tools are not on the PATH
 */
export const ensureFfmpeg = () => (ffReady ??= (async () => {
  if (process.env.FFMPEG_PATH) {
    const ffprobe = process.env.FFPROBE_PATH || path.join(path.dirname(process.env.FFMPEG_PATH), path.basename(process.env.FFMPEG_PATH).replace('ffmpeg', 'ffprobe'));
    return { ffmpeg: process.env.FFMPEG_PATH, ffprobe, dir: path.dirname(process.env.FFMPEG_PATH) };
  }
  const [own, ownProbe] = await Promise.all([runTool('ffmpeg', ['-version'], { timeoutMs: 15_000 }), runTool('ffprobe', ['-version'], { timeoutMs: 15_000 })]);
  if (own.ok && ownProbe.ok) return { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', dir: null };
  const pins = ffmpegFor(process.platform, process.arch);
  if (!pins) throw new Error(`this computer has no ffmpeg, and none is published for ${process.platform} ${process.arch}`);
  const dir = path.join(toolsHome(), `ffmpeg-${FFMPEG_BUILD}`);
  for (const asset of [pins.ffmpeg, pins.ffprobe]) {
    const bin = path.join(dir, asset.bin);
    if (fs.existsSync(bin)) continue;
    const gz = path.join(toolsHome(), asset.name);
    await obtainArchive(asset, gz);
    await gunzipTo(gz, bin);
  }
  log.info('ffmpeg set up', { build: FFMPEG_BUILD });
  return { ffmpeg: path.join(dir, pins.ffmpeg.bin), ffprobe: path.join(dir, pins.ffprobe.bin), dir };
})().catch((err) => { ffReady = null; throw err; }));
