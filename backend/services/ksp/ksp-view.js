import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { registerEphemeralSight } from '../image-forge/ephemeral-sight.js';

const execFileAsync = promisify(execFile);
const WINDOW_TITLE = 'Kerbal Space Program';
const REQUEST = 'neuma:ksp-capture';
const RESULT = 'neuma:ksp-capture-result';
const MAX_FRAMES = 4;
const MAX_FRAME_BYTES = 4 * 1024 * 1024;
const CAPTURE_TIMEOUT_MS = 7000;

const boundedInteger = (raw, fallback, min, max, label) => {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}`);
  }
  return value;
};

/** Validate one live-view sampling request. Pure. */
const validateKspViewRequest = (raw = {}) => {
  const frames = boundedInteger(raw.frames, 1, 1, MAX_FRAMES, 'frames');
  const intervalMs = frames === 1 ? 0 : boundedInteger(raw.intervalMs, 250, 100, 1000, 'intervalMs');
  return Object.freeze({ frames, intervalMs });
};

const wait = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason || new Error('KSP view capture aborted'));
  const abort = () => {
    clearTimeout(timer);
    reject(signal.reason || new Error('KSP view capture aborted'));
  };
  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', abort);
    resolve();
  }, ms);
  signal?.addEventListener('abort', abort, { once: true });
});

const decodeParentFrame = (frame) => {
  if (frame?.mime !== 'image/jpeg' || typeof frame.data !== 'string') throw new Error('desktop capture returned a malformed frame');
  const bytes = Buffer.from(frame.data, 'base64');
  if (bytes.length === 0 || bytes.length > MAX_FRAME_BYTES) throw new Error('desktop capture frame exceeded the vision payload ceiling');
  return Object.freeze({
    mime: frame.mime,
    bytes,
    width: Number(frame.width) || null,
    height: Number(frame.height) || null,
    capturedAt: new Date().toISOString(),
    source: 'electron-window',
  });
};

// impure — ask the trusted Electron parent for the exact KSP window only.
const captureThroughParent = () => new Promise((resolve, reject) => {
  const requestId = randomUUID();
  const cleanup = () => {
    clearTimeout(timer);
    process.off('message', receive);
  };
  const finish = (done, value) => {
    cleanup();
    done(value);
  };
  const receive = (message) => {
    if (message?.type !== RESULT || message.requestId !== requestId) return;
    if (!message.ok) finish(reject, new Error(message.error || 'desktop capture failed'));
    else {
      try {
        finish(resolve, decodeParentFrame(message.frame));
      } catch (error) {
        finish(reject, error);
      }
    }
  };
  const timer = setTimeout(() => finish(reject, new Error('desktop capture timed out')), CAPTURE_TIMEOUT_MS);
  process.on('message', receive);
  process.send({ type: REQUEST, requestId }, (error) => {
    if (error) finish(reject, error);
  });
});

// impure — dev fallback for KSP's X11/XWayland window; no desktop capture.
const captureXWindow = async () => {
  const output = path.join(tmpdir(), `neuma-ksp-${randomUUID()}.jpg`);
  try {
    await execFileAsync('import', [
      '-window', WINDOW_TITLE,
      '-resize', '1920x1080>',
      '-quality', '82',
      output,
    ], { timeout: CAPTURE_TIMEOUT_MS, windowsHide: true, maxBuffer: 256 * 1024 });
    const bytes = await readFile(output);
    if (bytes.length === 0 || bytes.length > MAX_FRAME_BYTES) throw new Error('KSP window frame exceeded the vision payload ceiling');
    return Object.freeze({
      mime: 'image/jpeg', bytes, width: null, height: null,
      capturedAt: new Date().toISOString(), source: 'x11-window',
    });
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('window capture is unavailable outside the Neuma desktop app on this host', { cause: error });
    throw new Error(`Kerbal Space Program window capture failed: ${error.message}`, { cause: error });
  } finally {
    await unlink(output).catch(() => {});
  }
};

const captureFrame = () => (
  typeof process.send === 'function' && process.connected
    ? captureThroughParent()
    : captureXWindow()
);

/**
 * Capture one frame or a short sequential burst and register it for the next
 * vision-capable model round. This is sampled sight, not an unbounded recording.
 */
// impure
export const captureKspView = async (laneId, raw = {}, signal) => {
  const request = validateKspViewRequest(raw);
  const frames = [];
  for (let index = 0; index < request.frames; index += 1) {
    if (index > 0) await wait(request.intervalMs, signal);
    frames.push(await captureFrame());
  }
  const imageIds = registerEphemeralSight(laneId, frames);
  if (imageIds.length !== frames.length) throw new Error('live KSP frames exceeded the in-memory sight ceiling');
  return Object.freeze({
    capturedAt: frames[0].capturedAt,
    frameCount: frames.length,
    intervalMs: request.intervalMs,
    source: frames[0].source,
    dimensions: Object.freeze(frames.map((frame) => Object.freeze({ width: frame.width, height: frame.height }))),
    sight: Object.freeze({ laneId, imageIds, store: 'ephemeral', purpose: 'ksp-view' }),
  });
};
