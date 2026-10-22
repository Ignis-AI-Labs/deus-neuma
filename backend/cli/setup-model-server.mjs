// setup-model-server — the installer's own model-server step, headless. // impure (network, fs, processes)
//
// THE INSTALL STANDARD (2026-10-22): the installer, not the person, provides what the app needs. The
// Windows setup wizard runs this after it copies the app (build/installer.nsh), with the app's own
// runtime: `NEUMA.exe` under ELECTRON_RUN_AS_NODE=1. It is the SAME code the app's first run uses
// (managed-ollama.js): the plan read from this machine, the pinned Ollama checked against its
// SHA-256, kept under the app's data folder with no admin rights, and the model chosen for this PC.
//
//   setup-model-server.mjs                    print the plan and exit
//   setup-model-server.mjs --yes              do it, printing one line per step and progress as it goes
//   setup-model-server.mjs --yes --home <dir> keep the server and the models in <dir> (the folder the
//                                             person chose in the installer; models can be 30+ GB)
// Exit 0: ready (or nothing needed). Exit 1: not done; the app offers it again on first run.
import os from 'node:os';
import path from 'node:path';

// the packaged app's data root (electron/backend-spawn.cjs), so the app finds what this installs
process.env.NEUMA_DATA_ROOT ||= path.join(os.homedir(), '.neuma', 'data');
process.env.NEUMA_VAULT_ROOT ||= path.join(os.homedir(), '.neuma', 'vault');

const M = await import('../services/managed-ollama.js');
const homeAt = process.argv.indexOf('--home');
const home = homeAt > 0 ? process.argv[homeAt + 1] : null;
const say = (line) => process.stdout.write(`${line}\n`);
const gb = (n) => `${(n / 1e9).toFixed(1)} GB`;

const plan = await M.currentPlan();
if (!plan.supported) { say(`Model server: not set up. ${plan.reason}`); process.exit(1); }
for (const note of plan.notes || []) say(note);
if (plan.steps.length === 0) { say(`Model server: ready (${plan.model.name}).`); }
say(`Model server: ${plan.steps.map((s) => s.label).join(', ')}. Download ${gb(plan.downloadBytes)}.`);
if (!plan.enoughDisk) { say(`Not enough disk space: it needs ${gb(plan.needBytes)} free, this disk has ${gb(plan.freeBytes)}.`); process.exit(1); }
if (!process.argv.includes('--yes')) process.exit(0);

if (home) say(`Model folder: ${home}`);
await M.startJob({ home });
let last = '';
for (;;) {
  const j = M.jobStatus();
  const pct = j.total > 0 ? ` ${Math.floor((100 * j.completed) / j.total)}%` : '';
  const line = `${j.line || j.step}${pct}`;
  if (line !== last && j.state === 'running') { say(line); last = line; }
  if (j.state === 'done') { say(j.line); process.exit(0); }
  if (j.state !== 'running') { say(`Model server: not set up. ${j.error || ''} Deus Neuma will offer it again when it starts.`); process.exit(1); }
  await new Promise((r) => setTimeout(r, 2000));
}
