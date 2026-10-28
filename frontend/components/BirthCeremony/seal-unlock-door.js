// THE UNLOCK DOOR at the seal step. Securing the key caches it for one seal and five minutes (SEC-028);
// an operator who saved the recovery codes, sealed on this computer and read the cost first has run past
// that, and the backend answers KEY_LOCKED ([…]). Until 2026-10-28 nothing was
// below: a first birth on Windows could not be sealed on Ethereum at all. The door takes the password
// just chosen (or the 8 recovery codes), puts the key back in the backend's one-shot cache, and the seal
// walks again — the same unlock the desk's seal card and setup gate use (wallet-client.js).

import { unlockNeumaKey, recoverNeumaKey } from '../../app/RelinkShell/wallet-client.js';

const CODE_COUNT = 8;
const codesOf = (text) => text.trim().split(/[\s,]+/).filter(Boolean);

const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);

/**
 * Open the door in `host`. impure — DOM, the unlock routes.
 * @param {HTMLElement} host
 * @param {{neumaId: string, name: string, onUnlocked: () => void}} opts - onUnlocked walks the seal again
 */
export const mountSealUnlockDoor = (host, { neumaId, name, onUnlocked }) => {
  let useCodes = false;
  const note = el('p', { className: 'witness-note', textContent: `${name}'s key was locked with the password you chose. Enter it once to seal.` });
  const password = el('input', { type: 'password', className: 'witness-input', placeholder: `The password securing ${name}'s key` });
  password.dataset.testid = 'seal-unlock-password';
  const codes = el('textarea', { className: 'witness-input', rows: 2, placeholder: `Paste all ${CODE_COUNT} recovery codes — spaces, commas or one per line`, spellcheck: false, hidden: true });
  codes.dataset.testid = 'seal-unlock-codes';
  const go = el('button', { type: 'button', className: 'btn btn-primary ceremony-btn', textContent: 'Unlock and seal' });
  go.dataset.testid = 'seal-unlock-go';
  const swap = el('button', { type: 'button', className: 'btn btn-secondary ceremony-btn', textContent: 'Lost it? Use the recovery codes' });
  const error = el('p', { className: 'keypair-error' });
  error.dataset.testid = 'seal-unlock-error';

  const ready = () => (useCodes ? codesOf(codes.value).length === CODE_COUNT : password.value.length > 0);
  const arm = () => { go.disabled = !ready(); };
  password.addEventListener('input', arm);
  codes.addEventListener('input', arm);
  password.addEventListener('keydown', (e) => { if (e.key === 'Enter' && ready()) go.click(); });
  swap.addEventListener('click', () => {
    useCodes = !useCodes;
    password.hidden = useCodes;
    codes.hidden = !useCodes;
    swap.textContent = useCodes ? 'Use the password' : 'Lost it? Use the recovery codes';
    go.textContent = useCodes ? 'Recover and seal' : 'Unlock and seal';
    error.textContent = '';
    arm();
  });
  go.addEventListener('click', async () => {
    if (!ready()) return;
    go.disabled = true;
    swap.disabled = true;
    error.textContent = '';
    const out = useCodes ? await recoverNeumaKey(neumaId, codesOf(codes.value)) : await unlockNeumaKey(neumaId, password.value);
    swap.disabled = false;
    if (!out.ok) { error.textContent = out.error; arm(); return; }
    password.value = '';
    codes.value = '';
    host.hidden = true;
    host.replaceChildren();
    onUnlocked();
  });

  const actions = el('div', { className: 'ceremony-actions' });
  actions.append(go, swap);
  host.replaceChildren(note, password, codes, actions, error);
  host.hidden = false;
  arm();
  password.focus();
};
