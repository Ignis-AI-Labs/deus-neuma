// wallet-backup-panel — the recovery-phrase screen a new wallet shows once:
// the words, a copy, and a backup FILE locked by a password. The file and its
// password together bring the wallet back on any computer (Import → restore
// from a backup file).
//
// A wallet with a password seals the file under that password. A key made for
// the person has no password they know, so they choose one for the file here.

import { uiSound } from '../../services/ui-sound.js';
import { encryptMnemonicToKeystore } from '../../services/EmbeddedWallet.js';

export const BACKUP_PASSWORD_MIN = 12;

/** pure — the backup file's name, dated so several backups never collide. */
export const backupFileName = (date = new Date()) =>
  `deus-neuma-wallet-backup-${date.toISOString().slice(0, 10)}-${date.getTime()}.json`;

/** pure — why a chosen backup password cannot be used, or null when it can. */
export const backupPasswordProblem = (password, confirm) => {
  if (String(password).length < BACKUP_PASSWORD_MIN) return `The backup password needs at least ${BACKUP_PASSWORD_MIN} characters.`;
  if (password !== confirm) return 'The two backup passwords do not match.';
  return null;
};

// impure — hand the browser a file to save.
const downloadTextFile = (filename, content) => {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/**
 * impure — render the recovery-phrase screen into the picker's panel.
 * @param {HTMLElement} panel
 * @param {{mnemonic: string, password: ?string, onContinue: () => void}} options - password null = a key made for the person
 */
export const showRecoveryPhrase = (panel, { mnemonic, password, onContinue }) => {
  const words = mnemonic.split(' ');
  uiSound('open'); // the wallet exists now — reveal its recovery phrase
  const madeForMe = password === null;
  const node = (tag, attrs = {}, text = '') => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text) n.textContent = text;
    return n;
  };
  const header = node('div', { class: 'wallet-picker-header' });
  header.append(node('h2', { class: 'wallet-picker-title' }, 'Recovery Phrase'));
  const context = node('p', { class: 'wallet-picker-context' }, madeForMe
    ? `Your key is made and kept by this computer — nothing to remember. These ${words.length} words are the only way to recover it on another machine, or if this computer's keychain is ever reset. You can show them again any time from the WALLET window.`
    : `Write down these ${words.length} words and keep them somewhere safe and private. They are the only way to recover this wallet if you forget your password.`);
  const grid = node('div', { class: 'wallet-picker-mnemonic' });
  words.forEach((w, i) => {
    const word = node('span', { class: 'mnemonic-word' });
    word.append(node('span', { class: 'mnemonic-index' }, String(i + 1)), document.createTextNode(w));
    grid.append(word);
  });
  const lede = node('p', { class: 'wallet-picker-backup-lede' },
    `Or save a backup file, locked with ${madeForMe ? 'a password you choose' : 'your wallet password'}. Keep the file and the password: together they bring this wallet back on any computer (Import Wallet → restore from a backup file).`);
  const fields = node('div', { class: 'wallet-picker-backup-fields' });
  if (madeForMe) {
    fields.append(
      node('input', { type: 'password', class: 'wallet-picker-password-input', id: 'wp-file-pass', placeholder: `Backup password (at least ${BACKUP_PASSWORD_MIN} characters)`, autocomplete: 'new-password' }),
      node('input', { type: 'password', class: 'wallet-picker-password-input', id: 'wp-file-confirm', placeholder: 'Type the backup password again', autocomplete: 'new-password' }));
  }
  const actions = node('div', { class: 'wallet-picker-backup-actions' });
  actions.append(
    node('button', { class: 'wallet-picker-backup-btn', id: 'wp-copy', type: 'button' }, 'Copy the words'),
    node('button', { class: 'wallet-picker-backup-btn', id: 'wp-save', type: 'button' }, 'Save backup file'));
  const confirm = node('label', { class: 'wallet-picker-confirm-label' });
  confirm.append(node('input', { type: 'checkbox', id: 'wp-saved-check' }), document.createTextNode(' I have saved my recovery phrase or a backup file'));
  const proceed = node('button', { class: 'wallet-picker-submit', id: 'wp-continue', disabled: '' }, 'Continue');
  panel.replaceChildren(header, context, grid, lede, ...(madeForMe ? [fields] : []), actions,
    node('div', { class: 'wallet-picker-note', id: 'wp-backup-msg', role: 'status' }), confirm, proceed);
  if (madeForMe) {
    const later = node('button', { class: 'wallet-picker-create wallet-picker-restore', id: 'wp-later', type: 'button' });
    later.append(node('span', {}, 'Save it later'));
    panel.append(later);
  }

  const msgEl = panel.querySelector('#wp-backup-msg');
  const checkbox = panel.querySelector('#wp-saved-check');
  const continueBtn = panel.querySelector('#wp-continue');

  panel.querySelector('#wp-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(mnemonic);
      uiSound('tick');
      msgEl.textContent = 'Copied to clipboard.';
    } catch {
      uiSound('deny');
      msgEl.textContent = 'Clipboard unavailable — select the words and copy manually.';
    }
  });

  const laterBtn = panel.querySelector('#wp-later');
  if (laterBtn) laterBtn.addEventListener('click', () => { uiSound('tick'); onContinue(); });

  const saveBtn = panel.querySelector('#wp-save');
  saveBtn.addEventListener('click', async () => {
    const filePassword = madeForMe ? panel.querySelector('#wp-file-pass').value : password;
    const problem = madeForMe ? backupPasswordProblem(filePassword, panel.querySelector('#wp-file-confirm').value) : null;
    if (problem) { uiSound('deny'); msgEl.textContent = problem; return; }
    saveBtn.disabled = true;
    const label = saveBtn.textContent;
    saveBtn.textContent = 'Locking the file…';
    try {
      downloadTextFile(backupFileName(), await encryptMnemonicToKeystore(mnemonic, filePassword));
      uiSound('activate');
      msgEl.textContent = madeForMe
        ? 'Backup file saved. It opens only with the backup password you just chose — keep both.'
        : 'Backup file saved. It opens with your wallet password.';
      checkbox.checked = true;
      continueBtn.disabled = false;
    } catch {
      uiSound('deny');
      msgEl.textContent = 'Could not create the backup file.';
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = label;
    }
  });

  checkbox.addEventListener('change', () => {
    uiSound('toggle');
    continueBtn.disabled = !checkbox.checked;
  });
  continueBtn.addEventListener('click', () => onContinue());
};
