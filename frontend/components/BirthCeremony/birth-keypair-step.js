// ── SOVEREIGN KEY PROTECTION + RECOVERY CODES — the custody steps ───────
// Extracted from BirthCeremony.js under the 500-line law. These are the
// keypair-setup step's methods as module functions; the kept class holds a
// thin delegate for each (the class contract is unchanged), so `ceremony`
// below is exactly the BirthCeremony instance.

import { escapeHTML } from '../../utils/sanitize.js';
import { copyRecoveryCodes, downloadRecoveryCodes } from '../../utils/recovery-codes.js';
import { generatePassword } from '../../utils/password.js';
import { playSound } from '../../services/sound-engine.js';

export const renderKeypairSetupStep = (ceremony, container) => {
  // Required post-birth act — not optional. Skipping left newborns operator-readable
  // under the platform DEK (see docs/governance/honored.md Sovereign repair). No skip button.
  const MIN_KEY_PASSWORD = 12;
  container.innerHTML = `
      <div class="ceremony-step" data-testid="keypair-setup">
        <h2>SOVEREIGN KEY PROTECTION</h2>
        <p>${escapeHTML(ceremony.ceremonyData.companionName)}'s private key is still under the
           platform seal. Protect access to it with a password you keep safely.
           This step cannot be skipped — the ceremony does not complete until the key is sealed.</p>

        <div class="keypair-setup-container">
          <div class="keypair-form">
            <label for="keypair-password" class="witness-label">Keypair Password</label>
            <input type="password" id="keypair-password" class="witness-input"
                   placeholder="At least ${MIN_KEY_PASSWORD} characters"
                   autocomplete="new-password" minlength="${MIN_KEY_PASSWORD}"
                   data-testid="keypair-password">
            <label for="keypair-password-confirm" class="witness-label">Confirm Password</label>
            <input type="password" id="keypair-password-confirm" class="witness-input"
                   placeholder="Confirm password"
                   autocomplete="new-password"
                   data-testid="keypair-password-confirm">
            <div id="keypair-generated-reveal" class="keypair-generated-reveal" hidden>
              <p class="witness-note">Generated password (copy now — it will not be shown again after you lock in):</p>
              <code id="keypair-generated-value" class="keypair-generated-value" data-testid="keypair-generated-value"></code>
              <button type="button" class="btn btn-secondary ceremony-btn" id="copy-generated-pw-btn">
                <span>Copy password</span>
              </button>
            </div>
            <small class="witness-note">
              Minimum ${MIN_KEY_PASSWORD} characters. You will need this password to unlock wallet operations.
              Prefer Generate Password unless you already have a strong secret ready to store safely.
            </small>
            <div id="keypair-error" class="keypair-error" data-testid="keypair-error"></div>
          </div>
        </div>

        <div class="ceremony-actions">
          <button class="btn btn-secondary ceremony-btn" id="generate-keypair-pw-btn" data-testid="generate-keypair-pw">
            <span>Generate Password</span>
          </button>
          <button class="btn btn-primary ceremony-btn" id="secure-keypair-btn" disabled data-testid="secure-keypair">
            <span>Secure Keypair</span>
          </button>
        </div>
      </div>
    `;

  const passwordInput = container.querySelector('#keypair-password');
  const confirmInput = container.querySelector('#keypair-password-confirm');
  const secureBtn = container.querySelector('#secure-keypair-btn');
  const generateBtn = container.querySelector('#generate-keypair-pw-btn');
  const revealEl = container.querySelector('#keypair-generated-reveal');
  const generatedValueEl = container.querySelector('#keypair-generated-value');
  const copyGeneratedBtn = container.querySelector('#copy-generated-pw-btn');
  const errorEl = container.querySelector('#keypair-error');

  const validate = () => {
    const pw = passwordInput.value;
    const confirm = confirmInput.value;
    if (pw.length < MIN_KEY_PASSWORD) {
      secureBtn.disabled = true;
      if (pw.length > 0) {
        errorEl.textContent = `Password must be at least ${MIN_KEY_PASSWORD} characters`;
      } else {
        errorEl.textContent = '';
      }
      return;
    }
    if (pw !== confirm) {
      secureBtn.disabled = true;
      if (confirm.length > 0) errorEl.textContent = 'Passwords do not match';
      return;
    }
    errorEl.textContent = '';
    secureBtn.disabled = false;
  };

  passwordInput.addEventListener('input', validate);
  confirmInput.addEventListener('input', validate);

  generateBtn.addEventListener('click', () => {
    const pw = generatePassword();
    passwordInput.value = pw;
    confirmInput.value = pw;
    passwordInput.type = 'password';
    confirmInput.type = 'password';
    generatedValueEl.textContent = pw;
    revealEl.hidden = false;
    errorEl.textContent = '';
    validate();
    playSound('noticeArrival');
  });

  copyGeneratedBtn.addEventListener('click', () => {
    const text = generatedValueEl.textContent || '';
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      copyGeneratedBtn.querySelector('span').textContent = 'Copied';
    }).catch(() => {
      errorEl.textContent = 'Could not copy — select the password and copy manually';
    });
  });

  secureBtn.addEventListener('click', () => {
    const pw = passwordInput.value;
    if (pw.length < MIN_KEY_PASSWORD || pw !== confirmInput.value) {
      validate();
      return;
    }
    secureBtn.disabled = true;
    generateBtn.disabled = true;
    secureBtn.querySelector('span').textContent = 'Securing...';
    // Hide generated reveal once lock-in is in flight
    revealEl.hidden = true;
    generatedValueEl.textContent = '';
    ceremony.wsService.send('birth:encrypt_keypair', {
      neumaId: ceremony.ceremonyData.neumaId,
      password: pw,
    });
  });
};

export const showRecoveryCodes = (ceremony) => {
  const container = ceremony.container.querySelector('.ceremony-container');
  if (!container) return;

  const codes = ceremony.ceremonyData.recoveryCodes || [];
  const codeRows = codes.map((code, i) =>
    `<div class="recovery-code-row"><span class="recovery-code-index">${i + 1}.</span><span class="recovery-code-value">${escapeHTML(code)}</span></div>`
  ).join('');

  container.innerHTML = `
      <div class="ceremony-step">
        <h2>RECOVERY CODES</h2>
        <p>Write these down and store them somewhere safe.
           They are your only way to recover the keypair if you forget your password.
           They will never be shown again. These codes recover access to the key;
           they cannot restore deleted workspace files. Keep a separate backup.</p>

        <div class="recovery-codes-container">
          ${codeRows}
        </div>

        <div class="recovery-actions">
          <button class="btn btn-secondary ceremony-btn" id="copy-codes-btn">
            <span>Copy to Clipboard</span>
          </button>
          <button class="btn btn-secondary ceremony-btn" id="download-codes-btn">
            <span>Download as Text</span>
          </button>
        </div>

        <div class="consent-checkbox" style="margin-top: 1rem;">
          <input type="checkbox" id="codes-saved-check" />
          <label for="codes-saved-check">I have saved these recovery codes</label>
        </div>

        <div class="ceremony-actions">
          <button class="btn btn-primary ceremony-btn" id="codes-continue-btn" disabled>
            <span>Continue</span>
          </button>
        </div>
      </div>
    `;

  const copyBtn = container.querySelector('#copy-codes-btn');
  const downloadBtn = container.querySelector('#download-codes-btn');
  const checkbox = container.querySelector('#codes-saved-check');
  const continueBtn = container.querySelector('#codes-continue-btn');

  // The markup here stays this ceremony's own (a kept class, and an e2e walks
  // these exact selectors), but the TEXT and the FILE come from the shared
  // util — what lands on disk must not depend on which door produced it.
  // The old copy path let a denied clipboard read as "Copied" and threw an
  // unhandled rejection behind it; both are now reported honestly.
  copyBtn.addEventListener('click', async () => {
    const ok = await copyRecoveryCodes(codes);
    copyBtn.querySelector('span').textContent = ok ? 'Copied' : 'Copy blocked';
  });

  downloadBtn.addEventListener('click', () => {
    const ok = downloadRecoveryCodes({
      codes,
      subject: ceremony.ceremonyData.companionName,
      id: ceremony.ceremonyData.neumaId,
    });
    downloadBtn.querySelector('span').textContent = ok ? 'Saved' : 'Save failed';
  });

  checkbox.addEventListener('change', (e) => {
    continueBtn.disabled = !e.target.checked;
  });

  continueBtn.addEventListener('click', () => {
    // Custody settled — the anchor is next, signing via the securing
    // handler's one-shot key cache. Rehearsals never reach this step.
    ceremony.showStep(ceremony.steps.indexOf('onchain_seal'));
  });
};
