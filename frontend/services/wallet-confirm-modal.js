/**
 * wallet-confirm-modal — the renderer confirmation + unlock prompts of
 * EmbeddedWallet, and the ensureUnlocked gate every sign/send crosses.
 *
 * THE SECURITY BOUNDARY (Rule 8): no signature or transaction leaves this
 * layer without an explicit human Confirm. Split out of EmbeddedWallet.js
 * (SIZE-028); DOM construction preserves its consent behavior. On desktop the native dialog in
 * main plays this role instead.
 *
 * Imports the registry view + lock state from wallet-session.js (CQ-036,
 * #395) — this used to reach back into EmbeddedWallet.js, which closed the
 * trio's three-way import cycle. Every edge points one way now.
 *
 * @module wallet-confirm-modal
 */

import { ethers } from 'ethers';
import { isWalletUnlocked, isWalletStored, unlockEmbeddedWallet, getActiveWalletId } from './wallet-session.js';

// impure — text is always data, never parsed HTML (SIZE-028 / #375).
const element = (tag, className, text) => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const confirmationRow = (label, value, mono = false) => {
  const row = element('div', 'wallet-confirm-row');
  row.append(element('span', 'wallet-confirm-label-text', label),
    element('span', `wallet-confirm-value${mono ? ' wallet-confirm-mono' : ''}`, value));
  return row;
};

const appendActions = (panel, reject, approve) => {
  const actions = element('div', 'wallet-confirm-actions');
  actions.append(element('button', 'wallet-confirm-btn wallet-confirm-reject', reject),
    element('button', 'wallet-confirm-btn wallet-confirm-approve', approve));
  panel.append(actions);
};

// impure — the browser confirmation modal (desktop uses a native dialog in main).
export const requestConfirmation = (type, details) => {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'wallet-confirm-overlay';

    const panel = document.createElement('div');
    panel.className = 'wallet-confirm-panel';

    // A sign-in challenge (EIP-4361) says what it is, as the desktop window does
    // (electron/wallet/confirm-view.cjs isSignInMessage).
    const text = typeof details?.message === 'string' && details.message.startsWith('0x')
      ? ethers.toUtf8String(details.message) : String(details?.message ?? '');
    const signIn = type !== 'transaction' && / wants you to sign in with your Ethereum account:$/.test(text.split('\n')[0]);
    const title = type === 'transaction' ? 'Confirm Transaction' : signIn ? 'Sign In' : 'Sign Message';
    const body = element('div', 'wallet-confirm-body');

    if (type === 'transaction') {
      const to = details.to || 'Unknown';
      const value = details.value ? ethers.formatEther(details.value) + ' ETH' : '0 ETH';
      body.append(confirmationRow('To', to, true), confirmationRow('Value', value));
      if (details.data && details.data !== '0x') {
        body.append(confirmationRow('Data', `${details.data.slice(0, 20)}...`, true));
      }
    } else {
      const msg =
        typeof details.message === 'string' && details.message.startsWith('0x')
          ? ethers.toUtf8String(details.message)
          : details.message;
      body.append(element('div', 'wallet-confirm-message', String(msg)));
    }

    panel.append(element('div', 'wallet-confirm-header', title), body);
    appendActions(panel, signIn ? 'Cancel' : 'Reject', signIn ? 'Sign in' : 'Confirm');

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    const cleanup = (result) => {
      overlay.remove();
      resolve(result);
    };

    panel.querySelector('.wallet-confirm-approve').addEventListener('click', () => cleanup(true));
    panel.querySelector('.wallet-confirm-reject').addEventListener('click', () => cleanup(false));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cleanup(false);
    });
  });
};

// impure — renderer password prompt to unlock the active wallet. Resolves with
// the typed password, or null if the witness cancels. The vault stays in the
// trusted layer (main on desktop); this only collects the password to unlock it.
const requestUnlock = ({ error } = {}) =>
  new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'wallet-confirm-overlay';
    const panel = document.createElement('div');
    panel.className = 'wallet-confirm-panel';
    const body = element('div', 'wallet-confirm-body');
    body.append(element('div', 'wallet-confirm-message', 'Your wallet is locked. Enter its password to authorize this signature.'));
    const input = element('input', 'wallet-unlock-input');
    input.type = 'password';
    input.autocomplete = 'current-password';
    input.placeholder = 'Wallet password';
    body.append(input);
    if (error) body.append(element('div', 'wallet-unlock-error', error));
    panel.append(element('div', 'wallet-confirm-header', 'Unlock Wallet'), body);
    appendActions(panel, 'Cancel', 'Unlock');
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    const cleanup = (result) => {
      overlay.remove();
      resolve(result);
    };
    // Empty submit is a no-op (keep the prompt open) — it must not burn a retry
    // or read as a wrong-password attempt, since no password was actually tried.
    const submit = () => { if (input.value) cleanup(input.value); };
    panel.querySelector('.wallet-confirm-approve').addEventListener('click', submit);
    panel.querySelector('.wallet-confirm-reject').addEventListener('click', () => cleanup(null));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
      else if (e.key === 'Escape') cleanup(null);
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cleanup(null);
    });
    setTimeout(() => input.focus(), 50);
  });

// impure — guarantee the active wallet is unlocked before a sign/send. Prompts
// the witness for their password (re-prompting on a wrong one, bounded) until it
// unlocks or they cancel. Throws on cancel so the caller surfaces a clean
// rejection. `force` re-prompts even when the advisory says unlocked — used after
// a genuine "locked" error from main, whose idle auto-lock can outrun the cache.
export const ensureUnlocked = async ({ force = false } = {}) => {
  if (!force && isWalletUnlocked()) return;
  if (!isWalletStored()) throw new Error('No wallet to unlock.');
  let error = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const password = await requestUnlock({ error });
    if (password === null) throw new Error('Wallet unlock cancelled');
    try {
      await unlockEmbeddedWallet(getActiveWalletId(), password);
      return;
    } catch (e) {
      error = /password|decrypt|wrong|integrity/i.test(e.message || '')
        ? 'Wrong password — try again.'
        : (e.message || 'Unlock failed.');
    }
  }
  throw new Error('Wallet unlock failed — too many attempts.');
};
