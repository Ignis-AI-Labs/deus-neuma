// Portal Component - Identity connection + entry animation
// Wallet connection is the "login" — like entering an RPG.
// After this, everything flows seamlessly.
//
// The environment is NOT drawn here: it belongs to OpeningField above the
// phase machine — THE ARMILLARY, the panel and the name, painted in the very
// place THE IGNITION left them (Armillary/armillary-layout.js). The Portal is
// the landing surface within it: the status strip, the entry threshold
// beneath the name, and the ignition strip carrying the startup's true
// measurements. Its name is in the DOM for every reader, painted for the eye.
import './Portal.css';
import { getWalletService } from '../../services/WalletGate.js';
import { showWalletPicker } from '../WalletPicker/WalletPicker.js';
import { showNotification } from '../../utils/notifications.js';
import { isSoundOn, toggleSound, playSound } from '../../services/sound-engine.js';
import { uiSound } from '../../services/ui-sound.js';
import { readIgnitionReport } from '../../app/BootIgnition/ignition-report.js';
import { probePlatform } from '../../app/BootIgnition/boot-probes.js';
import { platformRow, ROW_KEYS, ROW_STATE } from '../../app/BootIgnition/boot-sequence.js';
import { OPENING_EVENTS } from '../../app/Opening/opening-events.js';
import { readEntryMode, writeEntryMode } from '../../app/entry-mode.js';

export class Portal {
  constructor(container, options = {}) {
    this.container = container;
    this.options = options;
    // Shared singleton — later surfaces (covenant signing, menu) need the
    // same provider this gateway connects
    this.walletService = getWalletService();
  }

  init() {
    this.render();
    this.attachEventListeners();
    this.renderIgnitionStrip();
  }

  render() {
    this.container.innerHTML = `
      <div class="portal">
        <div class="portal-background"></div>

        <div class="portal-status">
          <span>DEUS NEUMA // GATEWAY</span>
          <span class="portal-status-live">PORTAL — DORMANT</span>
          <button class="portal-sound-toggle${isSoundOn() ? ' on' : ''}" id="portal-sound-toggle">SOUND: ${isSoundOn() ? 'ON' : 'OFF'}</button>
        </div>

        <div class="portal-content">
          <!-- The platform introduces itself as DEUS NEUMA (Design note, 2026-10-03;
               its beings are neuma, the network is Unavis. Painted by the
               field in the ignition's place; here for every reader. -->
          <div class="portal-text">
            <h1 class="portal-title">DEUS NEUMA</h1>
            <p class="portal-subtitle">Sovereign relationships with AI. デウス・ネウマ</p>
          </div>

          <!-- Entry — wallet sign-in is the threshold into the void -->
          <div class="portal-entry-choices">
            <button class="portal-entry-option portal-entry-option--primary" id="portal-enter">
              <span class="bk bk-tl"></span><span class="bk bk-tr"></span>
              <span class="bk bk-bl"></span><span class="bk bk-br"></span>
              <span class="portal-entry-label">
                <svg class="btn-icon" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="2.5" y="2.5" width="7" height="7" transform="rotate(45 6 6)" fill="none" stroke="currentColor" stroke-width="1"/></svg>
                <span>Enter the Void</span>
              </span>
              <span class="portal-entry-hint">Sign in with your wallet — or have a key made for you</span>
              <!-- Adults only, on the one control every path enters by (Terms §1, EULA):
                   entering is the confirmation, so the statement rides the act -->
              <span class="portal-age-notice" id="portal-age-notice">18+ only · Not for minors · Entering confirms you are at least 18 and of legal age where you live</span>
            </button>
            <!-- ENTER AS (Design note, 2026-10-14: the full platform, or the harness
                 alone — remembered on this device, changeable from the desk -->
            <div class="portal-enter-as" role="radiogroup" aria-label="Enter as">
              ${['full', 'harness'].map((mode) => `<button type="button" role="radio" class="portal-enter-as-opt label-data" data-mode="${mode}" aria-checked="${readEntryMode() === mode}">${mode === 'full' ? 'FULL PLATFORM' : 'HARNESS ONLY'}</button>`).join('')}
            </div>
          </div>
        </div>

        <!-- The ignition report — what the boot truly measured this session -->
        <div class="portal-ignition" id="portal-ignition"></div>
      </div>
    `;
  }

  // The strip carries the boot's real measurements. The boot writes a report
  // every session it plays — but a witness who skips inside the first beats
  // leaves an EMPTY report, and an empty strip measures nothing. No report
  // at all (?noboot) gets the same answer: measure the substrate now, once —
  // the strip never repeats a number it did not earn.
  // impure — DOM mutation + async fetch
  async renderIgnitionStrip() {
    const strip = this.container.querySelector('#portal-ignition');
    if (!strip) return;
    const report = readIgnitionReport();
    const hasRows = report && ROW_KEYS.some((k) => report[k]);
    if (!hasRows) {
      const verdict = platformRow(await probePlatform());
      strip.textContent = `PLATFORM ${verdict.text}`;
      if (verdict.state === ROW_STATE.FAIL) strip.classList.add('fail');
      return;
    }
    const rows = ROW_KEYS.filter((k) => report[k]).map((k) => ({ key: k, ...report[k] }));
    strip.textContent = rows.map((r) => `${r.key} ${r.text}`).join('  ·  ');
    if (rows.some((r) => r.state === ROW_STATE.FAIL)) strip.classList.add('fail');
  }

  attachEventListeners() {
    const enterBtn = this.container.querySelector('#portal-enter');
    const soundToggle = this.container.querySelector('#portal-sound-toggle');

    enterBtn.addEventListener('click', async () => {
      // Acknowledge the threshold action the instant it's taken — the same
      // 'activate' voice every primary control in the platform gives on press.
      // The wallet-sign and portal-open milestones sound later inside handleEnter.
      uiSound('activate');
      await this.handleEnter();
    });

    // ENTER AS — the layer this entry opens (entry-mode.js reads it after sign-in)
    this.container.querySelectorAll('.portal-enter-as-opt').forEach((opt) => {
      opt.addEventListener('click', () => {
        writeEntryMode(opt.dataset.mode);
        this.container.querySelectorAll('.portal-enter-as-opt').forEach((o) => o.setAttribute('aria-checked', String(o === opt)));
        uiSound('tick');
      });
    });

    // Sound is opt-in — the witness gives the world its voice here,
    // before the ceremony, so emergence can be heard
    soundToggle.addEventListener('click', () => {
      const on = toggleSound();
      soundToggle.textContent = `SOUND: ${on ? 'ON' : 'OFF'}`;
      soundToggle.classList.toggle('on', on);
      if (on) playSound('confirm');
    });
  }

  async handleEnter() {
    const enterBtn = this.container.querySelector('#portal-enter');
    const labelEl = enterBtn.querySelector('.portal-entry-label');
    const hintEl = enterBtn.querySelector('.portal-entry-hint');
    const originalLabel = labelEl.innerHTML;
    const originalHint = hintEl.textContent;

    const setBusy = (message) => {
      labelEl.innerHTML = `<span class="loading-spinner"></span><span>${message}</span>`;
      hintEl.textContent = '';
    };
    const restore = () => {
      enterBtn.disabled = false;
      labelEl.innerHTML = originalLabel;
      hintEl.textContent = originalHint;
    };

    enterBtn.disabled = true;
    setBusy('Connecting identity...');

    try {
      const chosen = await showWalletPicker('Choose your identity to enter the void');
      if (!chosen) {
        // Witness backed out of the identity picker — voice the retreat the
        // same way a dismissed menu does, and return the gate to rest.
        uiSound('close');
        restore();
        return;
      }

      setBusy('Establishing identity...');
      this.walletService.setProvider(chosen.provider);
      await this.walletService.connect();

      setBusy('Signing into the void...');
      playSound('walletSignRequest');
      await this.walletService.authenticate();

      this.openPortal();
    } catch (error) {
      console.error('Failed to establish identity:', error);
      restore();
      playSound('deny');
      showNotification('Could not establish identity. Try again.', 'error');
    }
  }

  openPortal() {
    const portal = this.container?.querySelector('.portal');

    // The gateway container can already be torn down by the time auth resolves —
    // a successful sign-in advances the app past the gateway, GatewayHost
    // unmounts, and its cleanup empties this node. The stale entry animation
    // then has nothing to play. Complete the entry and bail instead of throwing
    // on a null node (which the caller would mis-report as an auth failure).
    if (!portal) {
      if (this.options.onComplete) this.options.onComplete();
      return;
    }

    const statusLive = this.container.querySelector('.portal-status-live');

    playSound('portalContact');
    if (statusLive) {
      statusLive.textContent = 'PORTAL — OPENING';
      statusLive.classList.add('live');
    }

    // The field plays its own exit (OpeningField listens) — one environment
    // diving, not a surface swap.
    window.dispatchEvent(new CustomEvent(OPENING_EVENTS.PORTAL_OPENING));

    // Add opening class
    portal.classList.add('portal-opening');

    // After animation completes
    setTimeout(() => {
      if (this.options.onComplete) {
        this.options.onComplete();
      }
    }, 2000);
  }
}
