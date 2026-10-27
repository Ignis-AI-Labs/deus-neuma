#!/usr/bin/env node
// record-substrate-snapshot — a read-only recording of THIS machine for the
// SUBSTRATE window's render tests and screenshot proof (test/fixtures/substrate/).
//
// The machine is read through the backend's own reader (readMachineThermals:
// nvidia-smi, `sensors -j`, /sys, /proc) several times at the window's poll
// cadence, so a floating board input shows its swings across polls. The
// telemetry half is read through the telemetry service's own parsers from the
// same read-only sources (nvidia-smi, /proc/meminfo, the claimed server's
// /proc entry, the launch config). The model server itself is NEVER probed
// (port law): its sampler, activity and slot fields are recorded as null —
// the window draws them as '—', which is what an unprobed field is.
//
// Usage: node scripts/record-substrate-snapshot.mjs [out.json] [--polls 4] [--every 5000]
//
// impure — reads the machine; writes one JSON file.

import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import { promisify } from 'node:util';
import { readMachineThermals } from '../backend/services/machine-thermals.js';
import { parseComputeApps, parseGpu, parseRam, parseServerRam, summarizeSlots } from '../backend/services/substrate-telemetry.js';
import { activeLaunchConfig } from '../backend/services/llama-server-supervisor.js';
import { readClaim } from '../backend/services/substrate-claim-registry.js';

const exec = promisify(execFile);
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};
const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'test/fixtures/substrate/rig-snapshot.json';
const polls = arg('--polls', 4);
const every = arg('--every', 5000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const smi = (args) => exec('nvidia-smi', args, { encoding: 'utf8', timeout: 5000 }).then((r) => r.stdout).catch(() => null);
const text = (path) => readFile(path, 'utf8').catch(() => null);

const machine = [];
for (let i = 0; i < polls; i += 1) {
  if (i) await sleep(every);
  machine.push(await readMachineThermals());
}

const launch = activeLaunchConfig(process.env);
const claim = readClaim();
const [gpuCsv, appsCsv, meminfo, status, cmdline] = await Promise.all([
  smi(['--query-gpu=memory.used,memory.total,utilization.gpu,temperature.gpu,power.draw', '--format=csv,noheader,nounits']),
  smi(['--query-compute-apps=pid,process_name,used_memory', '--format=csv,noheader,nounits']),
  text('/proc/meminfo'),
  claim?.pid ? text(`/proc/${claim.pid}/status`) : null,
  claim?.pid ? text(`/proc/${claim.pid}/cmdline`) : null,
]);
const telemetry = {
  provider: 'llama-server',
  // The claimed model server's process is alive: the closest read-only fact to "serving".
  serving: Boolean(claim?.pid && existsSync(`/proc/${claim.pid}`)),
  model: claim?.model ?? null,
  contextLength: launch.contextLength,
  adapters: launch.loras,
  sampling: null,
  activity: null,
  slots: summarizeSlots(null),
  gpu: parseGpu(gpuCsv),
  processes: parseComputeApps(appsCsv),
  ram: { ...parseRam(meminfo, { totalBytes: os.totalmem(), freeBytes: os.freemem() }), server: parseServerRam(status, cmdline) },
  failures: [],
  at: new Date().toISOString(),
};

const recorded = {
  recordedAt: new Date().toISOString(),
  how: `readMachineThermals x${polls} every ${every} ms; telemetry from nvidia-smi + /proc via the telemetry parsers; model server not probed (sampler/activity/slots null)`,
  machine,
  telemetry,
};
await writeFile(out, `${JSON.stringify(recorded, null, 2)}\n`);
process.stdout.write(`recorded ${polls} machine polls + telemetry → ${out}\n`);
