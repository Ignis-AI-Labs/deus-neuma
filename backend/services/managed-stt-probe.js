// managed-stt-probe — what this machine offers dictation, read for managed-stt-device.js: the
// NVIDIA card (memory and driver), the CUDA 13 runtime libraries, and the size of the house's model
// when the platform's own model server serves it. impure (nvidia-smi, fs, the model server).
//
// The CUDA libraries are borrowed, never downloaded for dictation: the Ollama the platform sets up
// ships them (lib/ollama/cuda_v13 beside its binary), as does a system-wide Ollama or a CUDA toolkit.
import fs from 'node:fs';
import path from 'node:path';
import { boundedExec } from './bounded-exec.js';
import { readManagedRecord } from './managed-ollama-record.js';

const PROBE_MS = 3000;
const CUDA_LIBS = Object.freeze(['libcudart.so.13', 'libcublas.so.13', 'libcublasLt.so.13']);

/**
 * nvidia-smi's "free, total, driver" line (MiB, MiB, version) → the card, or null. Pure.
 * @param {string} stdout
 */
export const parseNvidiaCard = (stdout) => {
  const [free, total, driver] = String(stdout ?? '').trim().split('\n')[0].split(',').map((s) => s.trim());
  const freeMiB = Number.parseInt(free, 10);
  const totalMiB = Number.parseInt(total, 10);
  if (!Number.isFinite(freeMiB) || !Number.isFinite(totalMiB) || totalMiB <= 0) return null;
  const major = Number.parseInt(String(driver ?? '').split('.')[0], 10);
  return Object.freeze({
    vendor: 'nvidia',
    freeBytes: freeMiB * 1024 * 1024,
    totalBytes: totalMiB * 1024 * 1024,
    driverMajor: Number.isFinite(major) ? major : null,
  });
};

/** The first NVIDIA card, or null where there is none or nvidia-smi does not answer. impure */
const readCard = async () => {
  const r = await boundedExec('nvidia-smi', ['--query-gpu=memory.free,memory.total,driver_version', '--format=csv,noheader,nounits'], { timeoutMs: PROBE_MS });
  return r.ok ? parseNvidiaCard(r.stdout) : null;
};

/** Where the CUDA 13 runtime may be: the platform's Ollama first, then a system Ollama, then a toolkit. impure */
const cudaCandidates = () => {
  const bin = readManagedRecord()?.bin;
  return [
    ...(bin ? [path.join(path.dirname(path.dirname(bin)), 'lib', 'ollama', 'cuda_v13')] : []),
    '/usr/local/lib/ollama/cuda_v13',
    '/usr/lib/ollama/cuda_v13',
    '/usr/local/cuda/lib64',
  ];
};

/** The folder holding all three CUDA 13 runtime libraries, or null. impure */
export const findCudaLibDir = (candidates = cudaCandidates()) =>
  candidates.find((dir) => CUDA_LIBS.every((lib) => fs.existsSync(path.join(dir, lib)))) ?? null;

/** The house model's file size when the platform's own server holds it, else null. impure */
const readHouseBytes = async () => {
  const record = readManagedRecord();
  if (!record?.managed || !record.endpoint || !record.model) return null;
  try {
    const res = await fetch(`${record.endpoint.replace(/\/$/, '')}/api/tags`, { signal: AbortSignal.timeout(PROBE_MS) });
    const body = await res.json();
    const want = String(record.model).toLowerCase();
    const hit = (body?.models ?? []).find((m) => String(m.name ?? m.model).toLowerCase() === want);
    return Number.isFinite(hit?.size) ? hit.size : null;
  } catch {
    return null;
  }
};

/** Everything managed-stt-device.js weighs, except whether a build exists. impure */
export const readSttMachine = async () => {
  if (process.platform !== 'linux') return Object.freeze({ gpu: null, cudaLibDir: null, houseBytes: null });
  const [gpu, houseBytes] = await Promise.all([readCard(), readHouseBytes()]);
  return Object.freeze({ gpu, cudaLibDir: gpu ? findCudaLibDir() : null, houseBytes });
};
