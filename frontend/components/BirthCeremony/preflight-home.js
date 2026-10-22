// preflight-home — the flight check's home and space: where the neuma will live, how much space it
// starts with, and the verdict that follows. A new neuma starts with 5 GB, applied without a click
// (it grows later); a person may change it, and a changed SIZE only re-reads the space numbers —
// only a changed FOLDER re-runs the checks, because the home checks are about that folder.
//
// impure (DOM, the local backend) except verdictFor, which is pure.
import { playSound } from '../../services/sound-engine.js';
import { apiCall } from '../../utils/http.js';

/**
 * The verdict line under the checks, and whether the ceremony may begin. Pure.
 * @param {{verdict: string, checksFailed: boolean, allocationGB: ?number, home: object}} state
 * @returns {{text: string, state: 'ready'|'blocked', begin: boolean}}
 */
export const verdictFor = ({ verdict, checksFailed, allocationGB, home }) => {
  if (checksFailed) return { text: 'NOT YET — FIX WHAT IS MARKED ABOVE, THEN PRESS RECHECK', state: 'blocked', begin: false };
  if (home?.affordable === false) {
    const avail = home.availableGB == null ? '—' : `${home.availableGB.toFixed(1)} GB`;
    return { text: `NOT YET — ${allocationGB} GB IS MORE THAN THE ${avail} LEFT ON THIS DISK · CHOOSE LESS BELOW`, state: 'blocked', begin: false };
  }
  if (verdict !== 'ready') return { text: 'NOT YET — FIX WHAT IS MARKED ABOVE, THEN PRESS RECHECK', state: 'blocked', begin: false };
  if (!allocationGB) return { text: 'ALMOST — CHOOSE HOW MUCH SPACE THIS NEUMA STARTS WITH BELOW, THEN APPLY', state: 'ready', begin: false };
  return { text: 'READY — EVERYTHING IS IN PLACE · BEGIN THE CEREMONY WHEN YOU ARE', state: 'ready', begin: true };
};

/** impure — paint the verdict and the BEGIN button from the check's current state. */
export const paintVerdict = (check, { arrival = false } = {}) => {
  const verdictEl = check.container.querySelector('#preflight-verdict');
  const beginBtn = check.container.querySelector('#preflight-begin');
  const v = verdictFor(check);
  verdictEl.textContent = v.text;
  verdictEl.className = `preflight-verdict ${v.state}`;
  beginBtn.disabled = !v.begin;
  if (v.state === 'ready' && !v.begin) check.container.querySelector('#pf-apply')?.scrollIntoView({ block: 'center' });
  if (arrival) playSound(v.state === 'ready' ? 'noticeArrival' : 'deny');
};

/** impure — show the folder, the space and the allocation. */
export const renderHome = (check, home) => {
  if (!home) return;
  check.home = home;
  const rootInput = check.container.querySelector('#pf-root');
  const allocInput = check.container.querySelector('#pf-alloc');
  const note = check.container.querySelector('#pf-home-note');
  if (!rootInput.value) rootInput.value = home.root || '';
  const prefill = home.allocationGB || home.suggestedAllocationGB || null;
  if (!allocInput.value && prefill) allocInput.value = prefill;
  check.allocationGB = home.allocationGB || null;

  const free = home.freeGB === null ? 'free space could not be read' : `${home.freeGB.toFixed(1)} GB free`;
  const ledger = home.committedGB > 0
    ? ` · ${home.committedGB} GB already promised to ${home.neumaCount} neuma · ${home.availableGB == null ? '—' : home.availableGB.toFixed(1)} GB left`
    : '';
  const choice = check.allocationGB
    ? ` · this neuma starts with ${check.allocationGB} GB and can grow later · change it below if you like`
    : ' · choose how much space this neuma starts with';
  note.textContent = `${free}${ledger}${choice}`;
  note.classList.toggle('is-error', home.affordable === false);
};

/**
 * impure — save the folder and starting space. `auto` applies the default without a click.
 * A new folder re-runs the checks (they are about that folder); a new size only re-reads the space.
 */
export const applyHome = async (check, { auto = false } = {}) => {
  const rootInput = check.container.querySelector('#pf-root');
  const allocInput = check.container.querySelector('#pf-alloc');
  const note = check.container.querySelector('#pf-home-note');
  const applyBtn = check.container.querySelector('#pf-apply');
  const root = auto ? check.home?.root : rootInput.value.trim();
  const allocationGB = auto ? check.home?.suggestedAllocationGB : Number(allocInput.value);
  const movedFolder = !auto && root !== check.home?.root;
  applyBtn.disabled = true;
  try {
    // requireAuth guards this route (SEC-AUDIT-002): the session token rides along
    const body = await apiCall('POST', '/api/v1/preflight/workspace', { body: { root, allocationGB }, errorPrefix: 'Choice rejected' });
    if (!check.alive()) return;
    if (!auto) playSound('confirm');
    if (movedFolder) { await check.run(); return; }
    const { home } = await apiCall('GET', '/api/v1/preflight/home', { errorPrefix: 'Space not read' });
    if (!check.alive()) return;
    renderHome(check, home);
    // A folder the filesystem tool cannot reach is said HERE, not mid-ceremony.
    const warning = body.filesystemReachWarning || body.warning;
    if (warning) { note.textContent = warning.toUpperCase(); note.classList.add('is-error'); }
    if (!auto) paintVerdict(check);
  } catch (error) {
    if (!check.alive()) return;
    if (!auto) playSound('deny');
    note.textContent = String(error.message || error).toUpperCase();
    note.classList.add('is-error');
  } finally {
    if (check.alive()) applyBtn.disabled = false;
  }
};

/**
 * impure — the native folder picker fills the folder field; the person still presses APPLY.
 * chooseDirectory resolves null on cancel, so the catch is a real dialog failure, said aloud.
 */
export const browseFolder = async (check) => {
  try {
    const dir = await window.neuma.chooseDirectory();
    if (dir) {
      check.container.querySelector('#pf-home-note').classList.remove('is-error');
      check.container.querySelector('#pf-root').value = dir;
      playSound('confirm');
    }
  } catch (error) {
    const note = check.container.querySelector('#pf-home-note');
    note.textContent = `COULD NOT OPEN THE FOLDER PICKER: ${String(error.message || error).toUpperCase()}`;
    note.classList.add('is-error');
    playSound('deny');
  }
};
