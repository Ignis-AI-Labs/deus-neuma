// WalletPicker — Modal: discovered wallets + the witness's Neuma wallets.
import './WalletPicker.css';
import './wallet-mnemonic.css';
import './wallet-confirm.css';
import { walletDiscovery } from '../../services/WalletDiscovery.js';
import { uiSound } from '../../services/ui-sound.js';
import { formatAddress } from '../../utils/format.js';
import { escapeHTML } from '../../utils/sanitize.js';
import { isElectron, connectViaBrowserBridge, applyBridgeSession } from '../../services/wallet-bridge-core.js';
import {
  isWalletUnlocked, getActiveWalletId, listWallets, canCreateWallet, MAX_WALLETS,
  createEmbeddedWallet, unlockEmbeddedWallet, tryRememberedUnlock, getEmbeddedProvider,
  importEmbeddedMnemonic, importEmbeddedWallet, importEmbeddedKeystore,
  canMakeKeyForMe, createWalletForMe,
} from '../../services/EmbeddedWallet.js';
import { showRecoveryPhrase } from './wallet-backup-panel.js';

/**
 * Show the wallet picker modal.
 * @param {string} [contextMessage] — Why the wallet is being requested
 * @returns {Promise<{ info, provider } | null>} — Chosen wallet or null if cancelled
 */
export const showWalletPicker = (contextMessage) => {
  return new Promise((resolve) => {
    // The embedded wallets have their own section below — keep them out of the
    // external-wallet list. (Discovery still surfaces them for the signer.)
    const providers = walletDiscovery.getProviders().filter((p) => !p.isEmbedded);

    const overlay = document.createElement('div');
    overlay.className = 'wallet-picker-overlay';

    const cleanup = () => overlay.remove();

    const resolveWithEmbedded = () => {
      const provider = getEmbeddedProvider();
      walletDiscovery.setPreferred('neuma.embedded');
      uiSound('activate'); // identity chosen — the same commit voice used platform-wide
      cleanup();
      resolve({
        info: { uuid: 'neuma-embedded', name: 'Neuma Wallet', icon: '', rdns: 'neuma.embedded' },
        provider,
        isEmbedded: true,
      });
    };

    // --- Render functions for inline flows ---

    const showPasswordFlow = (mode, walletId) => {
      const panel = overlay.querySelector('.wallet-picker-panel');
      const isCreate = mode === 'create';
      uiSound('open'); // stepping into a nested panel

      panel.innerHTML = `
        <div class="wallet-picker-header">
          <h2 class="wallet-picker-title">${isCreate ? 'Create Wallet' : 'Unlock Wallet'}</h2>
          <button class="wallet-picker-close">&times;</button>
        </div>
        <div class="wallet-picker-password">
          <input type="password" class="wallet-picker-password-input"
                 placeholder="Password${isCreate ? ' (min 12 characters)' : ''}"
                 id="wp-password" autocomplete="${isCreate ? 'new-password' : 'current-password'}" />
          ${isCreate ? `
            <input type="password" class="wallet-picker-password-input"
                   placeholder="Confirm password"
                   id="wp-password-confirm" autocomplete="new-password" />
          ` : isElectron() ? `
            <label class="wallet-picker-remember">
              <input type="checkbox" id="wp-remember" checked />
              Remember this password on this machine
            </label>
          ` : ''}
          <div class="wallet-picker-error" id="wp-error"></div>
          <button class="wallet-picker-submit" id="wp-submit">
            ${isCreate ? 'Create Wallet' : 'Unlock'}
          </button>
        </div>
      `;

      panel.querySelector('.wallet-picker-close').addEventListener('click', () => {
        uiSound('close'); cleanup(); resolve(null);
      });

      const passwordInput = panel.querySelector('#wp-password');
      const confirmInput = panel.querySelector('#wp-password-confirm');
      const errorEl = panel.querySelector('#wp-error');
      const submitBtn = panel.querySelector('#wp-submit');
      passwordInput.focus();

      const handleSubmit = async () => {
        const password = passwordInput.value;
        errorEl.textContent = '';

        if (isCreate) {
          if (password.length < 12) { uiSound('deny'); errorEl.textContent = 'Password must be at least 12 characters'; return; }
          if (password !== confirmInput.value) { uiSound('deny'); errorEl.textContent = 'Passwords do not match'; return; }
        }

        submitBtn.disabled = true;
        submitBtn.textContent = isCreate ? 'Creating...' : 'Unlocking...';

        try {
          if (isCreate) {
            const { mnemonic } = await createEmbeddedWallet(password);
            showMnemonicBackup(mnemonic, password);
          } else {
            const remember = panel.querySelector('#wp-remember')?.checked === true;
            await unlockEmbeddedWallet(walletId, password, { remember });
            resolveWithEmbedded();
          }
        } catch {
          uiSound('deny');
          errorEl.textContent = isCreate ? 'Failed to create wallet' : 'Wrong password';
          submitBtn.disabled = false;
          submitBtn.textContent = isCreate ? 'Create Wallet' : 'Unlock';
        }
      };

      submitBtn.addEventListener('click', handleSubmit);
      const handleEnter = (e) => { if (e.key === 'Enter') handleSubmit(); };
      passwordInput.addEventListener('keydown', handleEnter);
      if (confirmInput) confirmInput.addEventListener('keydown', handleEnter);
    };

    // The recovery phrase + the password-locked backup file (wallet-backup-panel.js).
    const showMnemonicBackup = (mnemonic, password) => {
      showRecoveryPhrase(overlay.querySelector('.wallet-picker-panel'), { mnemonic, password, onContinue: resolveWithEmbedded });
    };

    const showImportFlow = () => {
      const panel = overlay.querySelector('.wallet-picker-panel');
      uiSound('open'); // stepping into the import panel
      panel.innerHTML = `
        <div class="wallet-picker-header">
          <h2 class="wallet-picker-title">Import Wallet</h2>
          <button class="wallet-picker-close">&times;</button>
        </div>
        <p class="wallet-picker-context">
          Paste a recovery phrase or a private key from another wallet, and choose a password to protect it on this device.
        </p>
        <div class="wallet-picker-password">
          <textarea class="wallet-picker-password-input wallet-picker-phrase" id="wp-secret"
                    rows="3" placeholder="Recovery phrase, or 0x private key" autocomplete="off" spellcheck="false"></textarea>
          <input type="password" class="wallet-picker-password-input"
                 placeholder="Password (min 12 characters)" id="wp-password" autocomplete="new-password" />
          <div class="wallet-picker-error" id="wp-error"></div>
          <button class="wallet-picker-submit" id="wp-submit">Import</button>
          <p class="wallet-picker-footnote">Or <a href="#" id="wp-keystore-link">restore from a backup file</a></p>
          <input type="file" id="wp-keystore-file" accept="application/json,.json" hidden />
        </div>
      `;

      panel.querySelector('.wallet-picker-close').addEventListener('click', () => {
        uiSound('close'); cleanup(); resolve(null);
      });

      const secretInput = panel.querySelector('#wp-secret');
      const passwordInput = panel.querySelector('#wp-password');
      const errorEl = panel.querySelector('#wp-error');
      const submitBtn = panel.querySelector('#wp-submit');
      const fileInput = panel.querySelector('#wp-keystore-file');
      secretInput.focus();

      // A private key is 64 hex chars (optionally 0x-prefixed); anything else is
      // treated as a BIP-39 phrase (ethers validates the checksum on import).
      const looksLikePrivateKey = (s) => /^(0x)?[0-9a-fA-F]{64}$/.test(s.replace(/\s+/g, ''));

      const handleSubmit = async () => {
        const raw = secretInput.value.trim();
        const password = passwordInput.value;
        errorEl.textContent = '';
        if (!raw) { uiSound('deny'); errorEl.textContent = 'Enter your recovery phrase or private key'; return; }
        if (password.length < 12) { uiSound('deny'); errorEl.textContent = 'Password must be at least 12 characters'; return; }
        submitBtn.disabled = true;
        submitBtn.textContent = 'Importing...';
        try {
          if (looksLikePrivateKey(raw)) {
            const key = raw.replace(/\s+/g, '');
            await importEmbeddedWallet(key.startsWith('0x') ? key : '0x' + key, password);
          } else {
            await importEmbeddedMnemonic(raw.replace(/\s+/g, ' '), password);
          }
          resolveWithEmbedded();
        } catch {
          uiSound('deny');
          errorEl.textContent = 'Could not import — check your phrase or key';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Import';
        }
      };

      submitBtn.addEventListener('click', handleSubmit);

      panel.querySelector('#wp-keystore-link').addEventListener('click', (e) => {
        e.preventDefault();
        uiSound('open');
        fileInput.click();
      });

      fileInput.addEventListener('change', async () => {
        const file = fileInput.files && fileInput.files[0];
        const password = passwordInput.value;
        errorEl.textContent = '';
        if (!file) return;
        if (password.length < 12) {
          uiSound('deny');
          errorEl.textContent = 'Type the backup file\'s password above first (at least 12 characters).';
          return;
        }
        submitBtn.disabled = true;
        submitBtn.textContent = 'Importing...';
        try {
          await importEmbeddedKeystore(await file.text(), password);
          resolveWithEmbedded();
        } catch {
          uiSound('deny');
          errorEl.textContent = 'Could not open the backup file — is the password right?';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Import';
        }
      });
    };

    // --- System-browser wallet bridge (Electron → the user's real browser) ---
    // In Electron there are no injected extensions, so this opens the system
    // browser (where Rabby/MetaMask live) and waits for the token to come back.

    const runBridge = async () => {
      const panel = overlay.querySelector('.wallet-picker-panel');
      uiSound('open'); // opening the system-browser bridge panel
      panel.innerHTML = `
        <div class="wallet-picker-header">
          <h2 class="wallet-picker-title">Connect with browser wallet</h2>
          <button class="wallet-picker-close">&times;</button>
        </div>
        <p class="wallet-picker-context" id="wp-bridge-status">
          Opening your browser… connect and approve there, then come back here.
        </p>
      `;
      panel.querySelector('.wallet-picker-close').addEventListener('click', () => { uiSound('close'); cleanup(); resolve(null); });
      try {
        const { token, address } = await connectViaBrowserBridge({
          onStatus: (s) => {
            const el = panel.querySelector('#wp-bridge-status');
            if (el && s === 'waiting') el.textContent = 'Waiting for you to connect in your browser…';
          },
        });
        // Confirm the address before committing — the user just connected it in
        // their browser, so a mismatch here means a different session was
        // injected; they reject it and nothing is stored.
        panel.innerHTML = `
          <div class="wallet-picker-header">
            <h2 class="wallet-picker-title">Confirm wallet</h2>
          </div>
          <p class="wallet-picker-context">Connected in your browser as<br><code class="wallet-picker-address" id="wp-bridge-addr"></code></p>
          <button class="wallet-picker-submit" id="wp-bridge-confirm">Continue as this wallet</button>
          <button class="wallet-picker-create wallet-picker-restore" id="wp-bridge-cancel"><span>Cancel</span></button>
        `;
        // Address via textContent, never interpolated into innerHTML (Rule 8).
        panel.querySelector('#wp-bridge-addr').textContent = address;
        panel.querySelector('#wp-bridge-confirm').addEventListener('click', () => {
          applyBridgeSession({ token, address });
          walletDiscovery.setPreferred('bridge.system-browser');
          uiSound('activate');
          cleanup();
          resolve({ bridged: true, address });
        });
        panel.querySelector('#wp-bridge-cancel').addEventListener('click', () => { uiSound('close'); buildMainView(); });
        return;
      } catch (err) {
        uiSound('deny');
        const el = panel.querySelector('#wp-bridge-status');
        if (el) el.textContent = (err && err.message) || 'Could not connect — try again.';
        panel.insertAdjacentHTML('beforeend', '<button class="wallet-picker-submit" id="wp-bridge-back">Back</button>');
        panel.querySelector('#wp-bridge-back').addEventListener('click', () => { uiSound('close'); buildMainView(); });
      }
    };

    // --- Build the main picker view (async — lists the witness's wallets) ---

    const buildMainView = async () => {
      try {
        if (await tryRememberedUnlock()) {
          resolveWithEmbedded();
          return;
        }
      } catch { /* fall through to the picker */ }
      const wallets = await listWallets();
      const hasExternalWallets = providers.length > 0;


      const contextHTML = contextMessage ? `<p class="wallet-picker-context">${escapeHTML(contextMessage)}</p>` : '';

      const listHTML = providers
        .map((p, i) => {
          // Rule 8, and sharply here: name and icon arrive from EIP-6963
          // provider announcements — EXTENSION-controlled strings. A hostile
          // extension announcing markup must render as text, and only a
          // data:image icon may become a src (any other scheme falls back).
          const safeName = escapeHTML(p.info.name);
          const iconHTML = p.info.icon && /^data:image\//.test(p.info.icon)
            ? `<img src="${escapeHTML(p.info.icon)}" alt="${safeName}">`
            : `<span class="wallet-picker-icon-fallback">&#11042;</span>`;
          return `
            <button class="wallet-picker-item" data-index="${i}">
              <div class="wallet-picker-icon">${iconHTML}</div>
              <span class="wallet-picker-name">${safeName}</span>
            </button>`;
        })
        .join('');

      // Create / Import on top (hidden at the cap), the existing wallets below.
      // MAKE A KEY FOR ME leads where the keychain can keep one (ruling, 2026-10-14).
      const forMeHTML = canCreateWallet() && await canMakeKeyForMe()
        ? `<button class="wallet-picker-create wallet-picker-forme" id="wp-forme"><span>Make a key for me</span><small class="wallet-picker-forme-note">One click. This computer keeps it — no password to remember.</small></button>`
        : '';
      const createHTML = canCreateWallet()
        ? `${forMeHTML}
          <button class="wallet-picker-create" id="wp-create"><span>Create New Wallet</span></button>
          <button class="wallet-picker-create wallet-picker-restore" id="wp-import"><span>Import existing wallet</span></button>`
        : `<p class="wallet-picker-note">Wallet limit reached (${MAX_WALLETS}). Remove one to add another.</p>`;

      // In Electron, the user's extension wallets aren't visible in-app — offer
      // the system-browser bridge so they can still use Rabby/MetaMask.
      const bridgeHTML = isElectron()
        ? `<button class="wallet-picker-create wallet-picker-bridge" id="wp-bridge"><span>Connect with browser wallet</span></button>`
        : '';

      const walletsHTML = wallets.length
        ? `<div class="wallet-picker-divider"><span>your wallets</span></div>${wallets
            .map((w) => {
              const short = formatAddress(w.address);
              return `
                <button class="wallet-picker-item wallet-picker-embedded" data-wallet-id="${w.id}">
                  <div class="wallet-picker-icon"><span class="wallet-picker-icon-fallback">&#9670;</span></div>
                  <div class="wallet-picker-item-info">
                    <span class="wallet-picker-name">Neuma Wallet</span>
                    <span class="wallet-picker-address">${short}</span>
                  </div>
                </button>`;
            })
            .join('')}`
        : '';

      overlay.innerHTML = `
        <div class="wallet-picker-panel">
          <div class="wallet-picker-header">
            <h2 class="wallet-picker-title">Connect Identity</h2>
            <button class="wallet-picker-close">&times;</button>
          </div>
          ${contextHTML}
          ${hasExternalWallets ? `<div class="wallet-picker-list">${listHTML}</div><div class="wallet-picker-divider"><span>or</span></div>` : ''}
          ${bridgeHTML}
          ${createHTML}
          ${walletsHTML}
          ${!hasExternalWallets && !wallets.length && !isElectron() ? '<p class="wallet-picker-footnote">Or <a href="https://rabby.io" target="_blank" rel="noopener">install a wallet extension</a></p>' : ''}
        </div>
      `;

      overlay.querySelector('.wallet-picker-close').addEventListener('click', () => { uiSound('close'); cleanup(); resolve(null); });
      overlay.addEventListener('click', (e) => { if (e.target === overlay) { uiSound('close'); cleanup(); resolve(null); } });

      // External wallet selection
      overlay.querySelectorAll('.wallet-picker-item:not(.wallet-picker-embedded)').forEach((btn) => {
        btn.addEventListener('click', () => {
          const chosen = providers[parseInt(btn.dataset.index, 10)];
          walletDiscovery.setPreferred(chosen.info.rdns);
          uiSound('activate'); // external identity chosen
          cleanup();
          resolve(chosen);
        });
      });

      // Existing wallet → use it if it's the unlocked active one, else unlock it
      overlay.querySelectorAll('.wallet-picker-embedded').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.walletId;
          if (isWalletUnlocked() && id === getActiveWalletId()) resolveWithEmbedded();
          else showPasswordFlow('unlock', id);
        });
      });

      // Make a key for me
      const forMeBtn = overlay.querySelector('#wp-forme');
      if (forMeBtn) forMeBtn.addEventListener('click', async () => {
        forMeBtn.disabled = true;
        try {
          const { mnemonic } = await createWalletForMe();
          showMnemonicBackup(mnemonic, null);
        } catch (error) {
          uiSound('deny');
          forMeBtn.disabled = false;
          forMeBtn.querySelector('small').textContent = error.message || 'The key could not be made.';
        }
      });

      // Create / Import
      const createBtn = overlay.querySelector('#wp-create');
      if (createBtn) createBtn.addEventListener('click', () => showPasswordFlow('create'));
      const importBtn = overlay.querySelector('#wp-import');
      if (importBtn) importBtn.addEventListener('click', () => showImportFlow());
      const bridgeBtn = overlay.querySelector('#wp-bridge');
      if (bridgeBtn) bridgeBtn.addEventListener('click', () => runBridge());
    };

    document.body.appendChild(overlay);
    uiSound('open'); // the picker surfaces — same voice a menu opening gives
    overlay.innerHTML = '<div class="wallet-picker-panel"><p class="wallet-picker-empty label-data">Loading…</p></div>';
    buildMainView();
  });
};
