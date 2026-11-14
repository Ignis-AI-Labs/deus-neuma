// system-dictation — dictation in every app, the ears way (Linux): hold a key that types nothing
// (Right Ctrl by default), speak, let go, and the words are typed into whatever window has focus.
// The words go through the speech engine the desk's own dictation uses (managed-stt.js, loaded and
// kept); the microphone is open only while the key is held; nothing leaves the computer.
//
// Off until the install owner turns it on (Settings). It needs what ears needs: the `input` group
// to read the keyboard (/dev/input), a recorder (PipeWire, PulseAudio or ALSA), and a typist
// (ydotool with its daemon on Wayland, xdotool on X11); readiness names whatever is missing and
// the command that adds it. impure (fs, child processes, the speech engine).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { getSettingsDir } from '../data-root.js';
import { createLogger } from '../logger.js';
import { sttReadiness, transcribeWav, usesManagedStt } from '../managed-stt.js';
import { HOLD_KEYS, parseKeyboards, parseKeyEvents } from './input-events.js';
import { HOLD_MS, IDLE, holdStep } from './hold-machine.js';
import { MIN_SPEECH_BYTES, RECORDERS, pcmToWav } from './audio.js';

const log = createLogger('SystemDictation');
const DEFAULTS = Object.freeze({ on: false, key: 'rightctrl' });
const settingsPath = () => path.join(getSettingsDir(), 'system-dictation.json');

/** The install owner's choice: on or off, and the key. A missing or unreadable file is off. impure */
export const readSystemDictation = () => {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    return Object.freeze({ on: saved.on === true, key: HOLD_KEYS[saved.key] ? saved.key : DEFAULTS.key });
  } catch {
    return DEFAULTS;
  }
};

const writeSettings = async (settings) => {
  await fsp.mkdir(path.dirname(settingsPath()), { recursive: true });
  const tmp = `${settingsPath()}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(settings, null, 2));
  await fsp.rename(tmp, settingsPath());
};

/** A program on PATH, or null. impure (fs) */
const which = (bin) => (process.env.PATH || '').split(path.delimiter).filter(Boolean)
  .map((dir) => path.join(dir, bin)).find((p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } }) ?? null;

const ydotoolSocket = () => process.env.YDOTOOL_SOCKET || `/run/user/${process.getuid?.() ?? 0}/.ydotool_socket`;

/** The typist for this session, or why there is none. impure (fs, env) */
const chooseTypist = () => {
  const wayland = process.env.XDG_SESSION_TYPE === 'wayland' || Boolean(process.env.WAYLAND_DISPLAY);
  if (wayland) {
    if (!which('ydotool')) return { ok: false, why: 'typing into other apps on Wayland needs ydotool', fix: 'install ydotool (Fedora: sudo dnf install ydotool; Ubuntu: sudo apt install ydotool), then start its daemon: ydotoold' };
    if (!fs.existsSync(ydotoolSocket())) return { ok: false, why: `ydotool's daemon is not running (no socket at ${ydotoolSocket()})`, fix: 'start it: ydotoold (or set YDOTOOL_SOCKET to its socket)' };
    return { ok: true, tool: 'ydotool', cmd: 'ydotool', args: ['type', '-d', '0', '-H', '8', '--file', '-'] };
  }
  if (!which('xdotool')) return { ok: false, why: 'typing into other apps on X11 needs xdotool', fix: 'install xdotool (Fedora: sudo dnf install xdotool; Ubuntu: sudo apt install xdotool)' };
  return { ok: true, tool: 'xdotool', cmd: 'xdotool', args: ['type', '--clearmodifiers', '--file', '-'] };
};

/** The keyboards this process may read. impure (fs) */
const readableKeyboards = () => {
  let text = '';
  try { text = fs.readFileSync('/proc/bus/input/devices', 'utf8'); } catch { return []; }
  return parseKeyboards(text).filter((k) => { try { fs.accessSync(`/dev/input/${k.event}`, fs.constants.R_OK); return true; } catch { return false; } });
};

/**
 * What dictation in every app needs here, and the one command for each missing piece. impure
 * @returns {Promise<object>} {supported, ready, missing: [{id, why, fix}], keyboards, recorder, typist}
 */
export const systemDictationReadiness = async () => {
  if (process.platform !== 'linux') {
    return Object.freeze({ supported: false, ready: false, missing: [], reason: 'Dictation in every app is on Linux first; Windows and macOS come next.' });
  }
  const missing = [];
  const keyboards = readableKeyboards();
  if (!keyboards.length) missing.push({ id: 'input', why: 'reading the keyboard needs the input group', fix: 'sudo usermod -aG input $USER, then sign out and back in' });
  const recorder = Object.keys(RECORDERS).find((bin) => which(bin)) ?? null;
  if (!recorder) missing.push({ id: 'recorder', why: 'there is no recorder (PipeWire, PulseAudio or ALSA tools)', fix: 'install pipewire-utils (Fedora) or pipewire-bin (Ubuntu)' });
  const typist = chooseTypist();
  if (!typist.ok) missing.push({ id: 'typist', why: typist.why, fix: typist.fix });
  const engine = usesManagedStt() ? await sttReadiness() : { ready: false };
  if (!engine.ready) missing.push({ id: 'engine', why: 'the dictation engine is not set up', fix: 'hold to talk once in a chat with your neuma, and download it there' });
  return Object.freeze({ supported: true, ready: missing.length === 0, missing, keyboards: keyboards.length, recorder, typist: typist.ok ? typist.tool : null });
};

// ── the running listener ─────────────────────────────────────────────────────
let running = null; // { streams (the keyboards' readers), state, timer, rec, typing }

/** The words, typed into the window in focus. impure */
const typeText = (text) => new Promise((resolve) => {
  const typist = chooseTypist();
  if (!typist.ok) { log.warn('cannot type', { why: typist.why }); resolve(); return; }
  const child = spawn(typist.cmd, typist.args, { env: { ...process.env, YDOTOOL_SOCKET: ydotoolSocket() }, stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  child.stderr.on('data', (c) => { err += c; });
  child.on('error', (e) => { log.warn('typing failed', { error: e.message }); resolve(); });
  child.on('close', (code) => { if (code) log.warn('typing failed', { code, error: err.trim().slice(0, 200) }); resolve(); });
  child.stdin.end(text);
});

const beginRecording = (run) => {
  const recorder = Object.keys(RECORDERS).find((bin) => which(bin));
  if (!recorder) return;
  const child = spawn(recorder, RECORDERS[recorder], { stdio: ['ignore', 'pipe', 'ignore'] });
  const chunks = [];
  child.stdout.on('data', (c) => chunks.push(c));
  child.on('error', (e) => log.warn('the recorder did not start', { recorder, error: e.message }));
  run.rec = { child, chunks, closed: new Promise((r) => child.once('close', r)) };
};

const finishRecording = async (run) => {
  const rec = run.rec;
  run.rec = null;
  if (!rec) return;
  rec.child.kill('SIGTERM');
  await rec.closed;
  const pcm = Buffer.concat(rec.chunks);
  if (pcm.length < MIN_SPEECH_BYTES) return;
  try {
    const { text } = await transcribeWav(pcmToWav(pcm));
    // one hold's words after the last's, never interleaved, with ears' trailing space
    if (text) run.typing = run.typing.then(() => typeText(`${text} `));
  } catch (err) {
    log.warn('a hold could not be read', { error: err.message });
  }
};

/** Start listening for the chosen key on every readable keyboard, if it is on and ready. impure */
export const startSystemDictation = async () => {
  if (running) return true;
  const settings = readSystemDictation();
  if (!settings.on) return false;
  const ready = await systemDictationReadiness();
  if (!ready.ready) {
    log.warn('dictation in every app is on but not ready', { missing: ready.missing.map((m) => m.id) });
    return false;
  }
  const code = HOLD_KEYS[settings.key].code;
  const run = { streams: [], state: IDLE, timer: null, rec: null, typing: Promise.resolve() };
  const feed = (type) => {
    const { state, action } = holdStep(run.state, { type, at: Date.now() });
    run.state = state;
    if (action === 'arm') { clearTimeout(run.timer); run.timer = setTimeout(() => feed('timer'), HOLD_MS); }
    if (action === 'start') beginRecording(run);
    if (action === 'stop') finishRecording(run);
  };
  // ONE `cat` PER KEYBOARD. A read on an input device waits for a key; read through fs it would
  // hold one of Node's four file threads per keyboard, and with four keyboards every file read and
  // write in the backend would wait for a key press (seen in this feature's own test). A child's
  // pipe is read on the event loop like any socket; Node refuses a device fd for that itself.
  for (const keyboard of readableKeyboards()) {
    const reader = spawn('cat', [`/dev/input/${keyboard.event}`], { stdio: ['ignore', 'pipe', 'ignore'] });
    const stream = reader.stdout;
    let carry;
    stream.on('data', (chunk) => {
      const read = parseKeyEvents(chunk, carry);
      carry = read.carry;
      for (const key of read.keys) {
        if (key.code !== code) continue;
        if (key.value === 1) feed('down');
        else if (key.value === 0) feed('up');
      }
    });
    reader.on('error', (e) => log.warn('a keyboard could not be read', { keyboard: keyboard.name, error: e.message }));
    run.streams.push(reader);
  }
  running = run;
  log.info('dictation in every app is listening', { key: HOLD_KEYS[settings.key].label, keyboards: run.streams.length });
  return true;
};

/** Stop listening; a recording in progress is dropped. impure */
export const stopSystemDictation = () => {
  if (!running) return;
  clearTimeout(running.timer);
  running.streams.forEach((reader) => reader.kill('SIGTERM'));
  running.rec?.child.kill('SIGTERM');
  running = null;
};

/** Is it listening now? impure (module state) */
export const systemDictationListening = () => Boolean(running);

/** The install owner turns it on or off, or picks the key; listening follows at once. impure */
export const saveSystemDictation = async ({ on, key }) => {
  const next = { on: on === true, key: HOLD_KEYS[key] ? key : readSystemDictation().key };
  await writeSettings(next);
  stopSystemDictation();
  if (next.on) await startSystemDictation();
  return Object.freeze({ ...next, listening: systemDictationListening() });
};

// the keyboards' readers and a recording never outlive the backend
process.once('exit', stopSystemDictation);
