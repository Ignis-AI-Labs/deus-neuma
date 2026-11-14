// model-server-setup — which setup a person with no model server gets, behind one door for the
// routes (model-server-routes.js). impure (reads the machine, drives one job).
//
// Where the platform's own supervisor can serve, Linux with an NVIDIA card, the setup installs
// the house's fast engine: llama.cpp with the model's files beside it (managed-engine.js,
// Design note, 2026-11-09. Everywhere else it sets up Ollama (managed-ollama.js), exactly as before. Both
// answer with the same plan and job shape, so the screen shows either.
import * as engine from './managed-engine.js';
import * as ollama from './managed-ollama.js';
import { chooseModelHome } from './model-home.js';

// the setups that download into Deus Neuma's own folder, the one a person may choose; a person's
// own Ollama (installed or running) keeps its models where it always has
const OWN_FOLDER = new Set(['download', 'managed', 'engine-download', 'engine-installed']);

// the setup whose job was started last: its job is the one the screen polls
let active = null;

/** The setup this machine takes, and its plan. impure */
const chosen = async (verify) => {
  const plan = await engine.currentPlan({ verify });
  return plan ? { setup: engine, plan } : { setup: ollama, plan: await ollama.currentPlan({ verify }) };
};

/**
 * The plan, the job and the folder it installs into, as GET /plan answers: `home` as the screen
 * shows it, `homePath` whole (where the folder dialog opens), `homeChangeable` whether the
 * download goes into a folder the person may choose. impure
 */
export const planView = async () => {
  const { setup, plan } = await chosen(true);
  return {
    plan, job: jobStatus(), home: setup.installHome(), homePath: setup.installHomePath(),
    homeChangeable: OWN_FOLDER.has(plan?.server),
  };
};

/**
 * The person picks the folder the models go in, before the setup; the plan is read again for it
 * (its free space). Refused while a setup runs: its files are going into the folder it has. impure
 * @param {string} home - an absolute folder
 */
export const chooseHome = async (home) => {
  if (jobStatus().state === 'running') throw Object.assign(new Error('The setup is running. Stop it first, then choose the folder.'), { code: 'MODEL_HOME' });
  await chooseModelHome(home);
  return planView();
};

/** The job the screen polls. impure (module state) */
export const jobStatus = () => (active || ollama).jobStatus();

/** Stop the running job. impure */
export const cancelJob = () => (active || ollama).cancelJob();

/**
 * Start the setup this machine takes, or answer with the job already running. Each setup reads
 * its own plan once the folder is set. impure
 */
export const startJob = async ({ home, loadModel = true } = {}) => {
  if (active?.jobStatus().state === 'running') return active.jobStatus();
  const { setup } = await chosen(loadModel);
  active = setup;
  return setup.startJob({ home, loadModel });
};
