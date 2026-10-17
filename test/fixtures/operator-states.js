// Driven by test/integration/operator-states-browser.test.js in a real browser:
// the real companion, desk-layout and language stores, through both operator
// states. Exposes window.__operatorStates() for the test to call.
import * as companions from '../../frontend/utils/companion-data.js';
import * as desk from '../../frontend/app/windowing/window-storage.js';
import * as language from '../../frontend/i18n/language-preference.js';
import { writeEntryMode } from '../../frontend/app/entry-mode.js';
import { recoverRoster } from '../../frontend/app/roster-recovery.js';

window.__operatorStates = async () => {
  const cael = { neumaId: 'cael-1', name: 'Cael' };
  const lane = { neumaId: 'harness-0a1b2c3d', name: 'qwen', participantKind: 'harness' };
  const read = () => ({
    active: companions.getActiveCompanion()?.neumaId ?? null,
    window: companions.getWindowCompanion()?.neumaId ?? null,
    windows: desk.loadDesk(),
    shelf: desk.loadShelf(),
    language: language.loadLanguagePreference(),
    roster: companions.getRoster().map((m) => m.neumaId),
    witnesses: companions.getWitnesses().map((m) => m.neumaId),
  });
  localStorage.setItem('walletAddress', '0xABCDEF0000000000000000000000000000000001');

  // the full platform, as it has always been
  writeEntryMode('full');
  companions.setActiveCompanion(cael);
  companions.setWindowCompanion(cael);
  companions.setRoster([cael, { neumaId: 'rugevil-1', name: 'Rugevil' }], [{ neumaId: 'witness-basunor', name: 'Basunor' }]);
  desk.saveDesk([{ id: 'house' }, { id: 'chat' }]);
  desk.saveShelf({ favorites: ['/home/founder/repos/neuma'], recents: [] });
  language.saveLanguagePreference('ja');
  const fullBefore = read();
  const fullKeys = Object.keys(localStorage).sort();

  // the harness: nothing of the full desk, then its own
  writeEntryMode('harness');
  const harnessFresh = read();
  companions.setActiveCompanion(lane);
  companions.setWindowCompanion(lane);
  desk.saveDesk([{ id: 'terminal' }]);
  const harnessOwn = read();
  // the house is never read from the harness — not even with a session to read it
  sessionStorage.setItem('authToken', 'a-session');
  const requested = [];
  const realFetch = window.fetch;
  window.fetch = (...args) => { requested.push(String(args[0])); return realFetch(...args); };
  const recovered = await recoverRoster();
  window.fetch = realFetch;
  const harnessRecovery = { companion: recovered.companion?.neumaId ?? null, requested, after: read() };

  // back to the full platform: exactly as it was left
  writeEntryMode('full');
  const fullAfter = read();
  writeEntryMode('harness');
  const harnessAgain = read();
  return { fullBefore, fullKeys, harnessFresh, harnessOwn, harnessRecovery, fullAfter, harnessAgain };
};
