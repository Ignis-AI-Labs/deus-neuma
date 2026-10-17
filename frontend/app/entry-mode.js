// ENTER AS — the full platform, or the harness alone (Design note, 2026-10-14: […]). The choice is made
// at the gateway (remembered on this device) and can be changed from the desk
// at any time; going to the harness keeps the being you were with, and coming
// back returns to it. docs/work/harness-only.md.
import { getActiveCompanion, setActiveCompanion, setWindowCompanion } from '../utils/companion-data.js';
import { apiCall } from '../utils/http.js';
import { isHarness, HARNESS_NAME } from './harness-mode.js';
import { ENTRY_MODE_KEY as MODE_KEY } from '../utils/entry-mode-scope.js';

const LAST_FULL_KEY = 'neuma.lastFullCompanion';

/**
 * Where an entry lands, and on whom. Pure.
 * @param {{mode: string, current: object|null, harnessLane: object|null, lastFull: object|null}} state
 * @returns {{phase: 'relink'|'choose'|'harness-first-run', companion?: object}}
 */
export const entryPlan = ({ mode, current, harnessLane, lastFull }) => {
  if (mode === 'harness') {
    return harnessLane
      ? { phase: 'relink', companion: { neumaId: harnessLane.laneId, name: HARNESS_NAME, participantKind: 'harness' } }
      : { phase: 'harness-first-run' };
  }
  if (current && !isHarness(current)) return { phase: 'relink', companion: current };
  if (lastFull && !isHarness(lastFull)) return { phase: 'relink', companion: lastFull };
  return { phase: 'choose' };
};

// impure — this device's choice (before sign-in there is no wallet to scope it to)
export const readEntryMode = () => {
  try { return localStorage.getItem(MODE_KEY) === 'harness' ? 'harness' : 'full'; } catch { return 'full'; }
};

// impure
export const writeEntryMode = (mode) => {
  try { localStorage.setItem(MODE_KEY, mode === 'harness' ? 'harness' : 'full'); } catch { /* storage refused */ }
};

// impure — the being to come back to, per wallet
const walletScoped = (key) => `${(localStorage.getItem('walletAddress') || '').toLowerCase()}:${key}`;
const readLastFull = () => {
  try { return JSON.parse(localStorage.getItem(walletScoped(LAST_FULL_KEY)) || 'null'); } catch { return null; }
};
const rememberLastFull = (companion) => {
  try { localStorage.setItem(walletScoped(LAST_FULL_KEY), JSON.stringify(companion)); } catch { /* storage refused */ }
};

// impure — this wallet's harness lane, if it has opened one
const readHarnessLane = async () => {
  try {
    const { lanes } = await apiCall('GET', '/api/v1/harness/lanes', { useServerError: false });
    return Array.isArray(lanes) && lanes.length ? lanes[0] : null;
  } catch { return null; }
};

/**
 * impure — enter as `mode`: remember the choice, keep the being being left,
 * bind this window and the shared last-used to the companion the plan names.
 * @param {'full'|'harness'} mode
 * @returns {Promise<'relink'|'choose'|'harness-first-run'>} the phase to show
 */
export const enterAs = async (mode) => {
  writeEntryMode(mode);
  const current = getActiveCompanion();
  if (current && !isHarness(current)) rememberLastFull(current);
  const harnessLane = mode === 'harness' ? await readHarnessLane() : null;
  const plan = entryPlan({ mode, current, harnessLane, lastFull: readLastFull() });
  if (plan.companion) {
    setActiveCompanion(plan.companion);
    setWindowCompanion(plan.companion);
  }
  return plan.phase;
};
