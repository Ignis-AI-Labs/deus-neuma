// setup-model-server — the installer's own model-server step, headless. // impure (network, fs, processes)
//
// THE INSTALL STANDARD (2026-10-22): the installer, not the person, provides what the app needs. The
// Windows setup wizard runs this after it copies the app (build/installer.nsh), with the app's own
// runtime: `NEUMA.exe` under ELECTRON_RUN_AS_NODE=1. It is the SAME code the app's first run uses
// (managed-ollama.js): the plan read from this machine, the pinned Ollama checked against its
// SHA-256, kept under the app's data folder with no admin rights, and the model chosen for this PC.
// Every line it prints lands in the wizard's install log, so each is written for a person: what this
// PC is getting, how much is left, how long, and what happens if it cannot finish.
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
// the install log is for a person: the backend's own info lines (colour codes and all) stay out of it
process.env.LOG_LEVEL ||= 'error';

const M = await import('../services/managed-ollama.js');
const homeAt = process.argv.indexOf('--home');
const home = homeAt > 0 ? process.argv[homeAt + 1] : null;
const say = (line) => process.stdout.write(`${line}\n`);
const gb = (n) => `${(n / 1e9).toFixed(1)} GB`;
const later = 'Deus Neuma will offer it again when it first starts.';

const plan = await M.currentPlan();
if (!plan.supported) { say(`Model server: not set up. ${plan.reason} ${later}`); process.exit(1); }
if (plan.model?.name) say(`The model for this PC: ${plan.model.name} (${plan.model.quant}), about ${plan.model.sizeGB} GB.`);
for (const note of plan.notes || []) say(note);
if (plan.steps.length === 0) { say(`Model server: ready (${plan.model.name}).`); process.exit(0); }
say(`Setup will: ${plan.steps.map((s) => s.label).join(', ')}. Download ${gb(plan.downloadBytes)} in all.`);
// with a chosen folder the job itself checks that folder's drive; without one, the data root's
if (!home && !plan.enoughDisk) { say(`Not enough disk space: it needs ${gb(plan.needBytes)} free, this disk has ${gb(plan.freeBytes)}. ${later}`); process.exit(1); }
if (!process.argv.includes('--yes')) process.exit(0);
if (home) say(`Model folder: ${home}`);

// […]: the rate over the last minute, so a stall shows as one
const progress = (() => {
  let samples = [];
  return (j) => {
    if (!(j.total > 0)) return '';
    const now = Date.now();
    samples = [...samples.filter((s) => now - s.at < 60_000 && s.done <= j.completed), { at: now, done: j.completed }];
    const first = samples[0];
    const rate = now > first.at ? (j.completed - first.done) / ((now - first.at) / 1000) : 0;
    const left = rate > 0 ? Math.ceil((j.total - j.completed) / rate / 60) : null;
    const eta = left === null ? '' : left <= 1 ? ', about a minute left' : `, about ${left} min left`;
    return `: ${gb(j.completed)} of ${gb(j.total)} (${Math.floor((100 * j.completed) / j.total)}%)${eta}`;
  };
})();

// one attempt of the job, printed as it goes; resolves with the job's final state
const attempt = async () => {
  await M.startJob({ home });
  let last = '';
  for (;;) {
    const j = M.jobStatus();
    if (j.state === 'done') { say(j.line); return j; }
    if (j.state !== 'running') return j;
    if (!j.line) { await new Promise((r) => setTimeout(r, 500)); continue; }
    const line = `${j.line}${progress(j)}`;
    // a new step always prints; progress within a step at most every 10 s
    const stepChanged = line.split(':')[0] !== last.split(':')[0];
    if (line !== last && (stepChanged || !attempt.at || Date.now() - attempt.at >= 10_000)) { say(line); last = line; attempt.at = Date.now(); }
    await new Promise((r) => setTimeout(r, 2000));
  }
};

// A dropped connection is the usual way a long download fails: try again, and the download resumes
// where it stopped. Disk space and an unsupported machine are not retried.
const TRIES = 3;
for (let n = 1; n <= TRIES; n += 1) {
  const j = await attempt();
  if (j.state === 'done') process.exit(0);
  const reason = j.error || 'it stopped';
  const final = n === TRIES || /disk|space|not supported|cannot run/i.test(reason);
  if (final) { say(`Model server: not set up. ${reason} ${later}`); process.exit(1); }
  say(`The download stopped (${reason}). Trying again in 15 seconds, attempt ${n + 1} of ${TRIES}; it picks up where it stopped.`);
  await new Promise((r) => setTimeout(r, 15_000));
}
