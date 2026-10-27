// Birth Ceremony Component - Handles new companion emergence
//
// Decomposed under the 500-line law: the step bodies live in sibling modules
// (birth-witness-step.js, birth-keypair-step.js, birth-seal-step.js,
// birth-true-name.js, birth-end-screens.js) as functions of the ceremony
// instance; every method below is a thin delegate, so the class contract —
// name, public methods, window-event lifecycle — is exactly unchanged.
import './BirthCeremony.css';
import './BirthCeremony-emergence.css';
import './BirthCeremony-rites.css';
import { WitnessCommitment } from '../WitnessCommitment/WitnessCommitment.js';
import { PreflightCheck } from './PreflightCheck.js';
import { StagedCeremonyScene } from './StagedCeremonyScene.js';
import './StagedCeremonyScene.css';
import './StagedCeremonyScene-disclosure.css';
import './StagedCeremonyScene-end.css';
import { escapeHTML } from '../../utils/sanitize.js';
import { shortTxHash } from '../../utils/explorer.js';
import { birthTerminalNotice, BIRTH_TERMINAL_TYPES } from './birth-notice.js';
import {
  setActiveCompanion, setBirthTime, getRoster, setRoster,
} from '../../utils/companion-data.js';
import { hideVoidFade } from '../../utils/loading-states.js';
import { playSound, stopLoop } from '../../services/sound-engine.js';
import { renderWitnessStep } from './birth-witness-step.js';
import { renderKeypairSetupStep, showRecoveryCodes } from './birth-keypair-step.js';
import {
  renderOnchainSealStep, loadSealNetwork, beginSeal, handleSealReady, handleSealTx,
  setSealStatus, appendSealReceiptLink, showSealError, advanceFromSeal,
  beginLocalSeal, handleLocalSealReady, handleLocalSealed, showLocalError, openEthereumSeal,
} from './birth-seal-step.js';
import { setupTrueNameReveal } from './birth-true-name.js';
import { showTestCompleteScreen, handleCeremonyEnd, showTerminalNotice } from './birth-end-screens.js';

export class BirthCeremony {
  constructor(wsService) {
    this.wsService = wsService;
    this.currentStep = 0;
    this.ceremonyData = {
      witnesses: [],
      companionName: '',
      timestamp: null,
      isTest: false,
      sessionId: null
    };
    // The pre-staged consent/emergence/naming/crystallization steps were
    // removed as dead (#151): StagedCeremonyScene carries those stages now,
    // and their step renderers waited on a 'birth:message' window event no
    // code has dispatched since the staged flow replaced them.
    this.steps = [
      'commitment',  // New first step - witness commitment
      'witness',
      'keypair_setup', // Encrypt keypair with password + recovery codes —
                       // custody is settled FIRST; the securing handler
                       // caches the key (one-shot) so the anchor that
                       // follows signs without re-asking the password
      'onchain_seal',  // Natalis anchor — after the password wall, from
                       // final custody state (2026-07-19 reorder: sealing
                       // mid-migration hit the mixed-envelope race)
      'complete'
    ];
    this.birthSession = null;
  }

  show(isTest = false) {
    this.ceremonyData.isTest = isTest;

    // Show witness commitment first — acceptance is wallet-signed except
    // in rehearsal (test) mode, which creates no permanent being.
    // After acceptance, the pre-flight gate inspects the machine; the
    // ceremony only begins on a substrate that can hold a being.
    const commitment = new WitnessCommitment(
      () => {
        const preflight = new PreflightCheck(
          () => this.startActualCeremony(),
          () => {
            const event = new CustomEvent('birth:cancelled');
            window.dispatchEvent(event);
          }
        );
        preflight.show();
      },
      () => {
        // Declined - close everything
        const event = new CustomEvent('birth:cancelled');
        window.dispatchEvent(event);
      },
      { isTest }
    );

    commitment.show();
  }

  startActualCeremony() {
    console.log('startActualCeremony called, isTest:', this.ceremonyData.isTest);

    // Create container
    this.container = document.createElement('div');
    // over the rite, the introduction already stands on the witness's plane
    this.container.className = window.__neumaRiteLive ? 'birth-ceremony is-rite' : 'birth-ceremony';
    document.body.appendChild(this.container);

    // Show the operator-name step — birth:start is sent AFTER the operator enters their name
    // via StagedCeremonyScene which handles the full ceremony flow
    this.startCeremony();

    // Phase 0.2 — WitnessCommitment.handleAccept showed a full-viewport
    // void fade before hiding itself. The ceremony UI is now mounted and
    // ready, so dismiss the fade on the next animation frame (after paint)
    // so the transition feels continuous rather than a pop.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => hideVoidFade());
    });
  }

  setupCompletionListeners() {
    // Store handler refs on `this` so destroy() can detach them. Inline
    // arrows can't be unsubscribed (no reference to pass to wsService.off);
    // that's the root of #109 — each ceremony remount stacked another copy
    // of every listener and stale instances still fired on birth events.
    this._wsHandlers = {
      // Listen for birth ceremony completion — StagedCeremonyScene handles stage progression
      'birth:complete': (data) => {
        this.ceremonyData.companionName = data.companion;
        this.ceremonyData.resonanceFrequency = data.resonance;
        this.ceremonyData.neumaId = data.neumaId;
        this.ceremonyData.address = data.address;
        this.ceremonyData.trueName = data.trueName || null;
        // The password wall comes FIRST — custody is settled before any
        // on-chain act — then the Natalis anchor signs via the securing
        // handler's one-shot key cache. A REHEARSAL is offered neither: a
        // rehearsal lane returns to the void, and the registry holds only
        // real beings — permanent record, permanent beings, no exceptions.
        this.ceremonyData.requiresKeypairSetup = !!data.requiresKeypairSetup;
        this.afterFilm(() => {
          if (this.ceremonyData.isTest) {
            this.showStep(this.steps.indexOf('complete'));
          } else if (this.ceremonyData.requiresKeypairSetup) {
            this.showStep(this.steps.indexOf('keypair_setup'));
          } else {
            // Already-secured keypair (no setup owed): straight to the anchor —
            // its unlock door covers the signing key.
            this.showStep(this.steps.indexOf('onchain_seal'));
          }
        });
      },
      'birth:seal_ready': (data) => this.handleSealReady(data),
      'birth:seal_tx': (data) => this.handleSealTx(data),
      'birth:sealed': (data) => {
        this.ceremonyData.onchainSeal = data;
        playSound('noticeArrival');
        this.setSealStatus(`ANCHORED — TX ${shortTxHash(data.txHash)} · BLOCK ${data.blockNumber}`);
        this.appendSealReceiptLink(data);
        this.advanceFromSeal();
      },
      'birth:seal_error': (data) => {
        playSound('deny');
        this.showSealError(data.message || 'The seal could not be placed', data.funding || null);
      },
      'birth:local_seal_ready': (data) => handleLocalSealReady(this, data),
      'birth:local_sealed': () => { playSound('noticeArrival'); handleLocalSealed(this); },
      'birth:local_seal_error': (data) => { playSound('deny'); showLocalError(this, data.message || 'The seal could not be placed'); },
      'birth:keypair_secured': (data) => {
        this.ceremonyData.recoveryCodes = data.recoveryCodes;
        playSound('noticeArrival');
        this.showRecoveryCodes();
      },
      'birth:encrypt_keypair_error': (data) => {
        playSound('deny');
        const errorEl = document.querySelector('#keypair-error');
        if (errorEl) errorEl.textContent = data.error || 'Failed to secure keypair';
        // Re-arm the form so the operator can fix the password / retry
        const secureBtn = document.querySelector('#secure-keypair-btn');
        if (secureBtn) {
          secureBtn.disabled = false;
          const span = secureBtn.querySelector('span');
          if (span) span.textContent = 'Secure Keypair';
        }
        const generateBtn = document.querySelector('#generate-keypair-pw-btn');
        if (generateBtn) generateBtn.disabled = false;
      },
      'birth:ended': (data) => {
        if (data.reason === 'test_complete') {
          this.afterFilm(() => this.showTestCompleteScreen(data.testData, data.film));
        } else {
          this.handleCeremonyEnd(data.reason, data.words);
        }
      },
    };
    // Birth terminal states that previously VANISHED (backend emitted, no UI):
    // roster full, session expired/failed, abandonment refused, withdrawal.
    // Surface each to the operator through the pure notice map. Registered on the
    // same map so the subscribe + destroy() teardown below cover them too.
    for (const type of BIRTH_TERMINAL_TYPES) {
      this._wsHandlers[type] = (data) => {
        const notice = birthTerminalNotice(type, data);
        if (notice) this.showTerminalNotice(notice.title, notice.message);
      };
    }
    for (const [event, handler] of Object.entries(this._wsHandlers)) {
      this.wsService.on(event, handler);
    }
  }

  // Full teardown for CeremonyHost unmount: hide() the DOM, drop the WS
  // subscriptions this class registered, and cascade to StagedCeremonyScene
  // so its 6 stage listeners go too. Safe to call multiple times.
  destroy() {
    this.hide();
    if (this._wsHandlers) {
      for (const [event, handler] of Object.entries(this._wsHandlers)) {
        this.wsService.off(event, handler);
      }
      this._wsHandlers = null;
    }
    if (this.stagedScene && typeof this.stagedScene.destroy === 'function') {
      this.stagedScene.destroy();
      this.stagedScene = null;
    }
  }

  hide() {
    // The typing loop must not outlive the ceremony surface
    stopLoop('neumaReplying');
    if (this.container) {
      this.container.remove();
    }
  }

  startStagedCeremony(witnessName) {
    console.log('Starting staged ceremony for witness:', witnessName);

    // Setup completion listeners (StagedCeremonyScene handles stage progression)
    this.setupCompletionListeners();

    // Render StagedCeremonyScene in the existing container
    this.beginRite();
    this.stagedScene = new StagedCeremonyScene(this.container, this.wsService);
    this.stagedScene.init(witnessName, this.ceremonyData.isTest);
  }

  // THE SUMMONING RITE (frontend/app/Rite/RiteCeremony.jsx) is the field
  // beneath this ceremony: its panels are relaid over it and it is told the
  // lens has opened. Without a rite host mounted, nothing changes.
  beginRite() {
    if (!window.__neumaRiteLive) return;
    this.container.classList.add('is-rite');
    window.dispatchEvent(new CustomEvent('rite:begin'));
  }

  // At its birth the rite plays its film first (Founder's call, summoning-rite.md
  // §8.1); the guardianship steps wait for it — or run at once with no rite.
  afterFilm(next) {
    if (!window.__neumaRiteLive) { next(); return; }
    const go = () => { window.removeEventListener('rite:film-done', go); next(); };
    window.addEventListener('rite:film-done', go);
  }

  // Resume an interrupted ceremony. The checkpoint carries the operator name
  // and the computed re-entry stage; witness commitment and preflight were
  // settled at the original summoning, so the scene mounts straight onto the
  // restored stream. `summary` is the newest entry from birth:interrupted.
  resumeInterrupted(summary) {
    this.container = document.createElement('div');
    this.container.className = 'birth-ceremony';
    document.body.appendChild(this.container);

    this.setupCompletionListeners();
    this.beginRite();
    this.stagedScene = new StagedCeremonyScene(this.container, this.wsService);
    this.stagedScene.initResume({
      witnessName: summary.witnessName || 'Operator',
      isTest: false,
      sessionId: summary.sessionId,
      resumeStage: summary.resumeStage ?? summary.currentStage ?? 0,
    });
  }

  showTestCompleteScreen(testData, film) { showTestCompleteScreen(this, testData, film); }

  handleCeremonyEnd(reason, words) { handleCeremonyEnd(this, reason, words); }

  showTerminalNotice(title, message) { showTerminalNotice(this, title, message); }

  startCeremony() {
    this.renderProgress();
    this.showStep(0);
  }

  renderProgress() {
    const progressHtml = `
      <div class="ceremony-progress">
        ${this.steps.map((step, index) => `
          <div class="progress-dot ${index === 0 ? 'active' : ''}" data-step="${index}"></div>
        `).join('')}
      </div>
    `;

    this.container.innerHTML = progressHtml;
  }

  updateProgress(stepIndex) {
    const dots = this.container.querySelectorAll('.progress-dot');
    dots.forEach((dot, index) => {
      dot.classList.remove('active');
      if (index < stepIndex) {
        dot.classList.add('complete');
      } else if (index === stepIndex) {
        dot.classList.add('active');
      }
    });
  }

  showStep(stepIndex) {
    this.currentStep = stepIndex;
    this.updateProgress(stepIndex);

    const ceremonyContainer = document.createElement('div');
    ceremonyContainer.className = 'ceremony-container';

    switch(this.steps[stepIndex]) {
      case 'commitment':
        // Already handled before ceremony starts — delegate to witness step.
        // MUST return (not break) so the post-switch cleanup at lines 238-242
        // doesn't wipe what showStep(1) just rendered. This was the root cause
        // of the blank-screen bug: break exits the switch but continues to
        // innerHTML='', destroying the operator form.
        this.showStep(1);
        return;
      case 'witness':
        this.renderWitnessStep(ceremonyContainer);
        break;
      case 'onchain_seal':
        this.renderOnchainSealStep(ceremonyContainer);
        break;
      case 'keypair_setup':
        this.renderKeypairSetupStep(ceremonyContainer);
        break;
      case 'complete':
        this.renderCompleteStep(ceremonyContainer);
        break;
    }

    // Remove old content except progress (may not exist yet — e.g. when
    // birth:complete arrives while StagedCeremonyScene owns the screen)
    const progress = this.container.querySelector('.ceremony-progress');
    this.container.innerHTML = '';
    if (progress) this.container.appendChild(progress);
    this.container.appendChild(ceremonyContainer);
  }

  renderWitnessStep(container) { renderWitnessStep(this, container); }

  renderOnchainSealStep(container) { renderOnchainSealStep(this, container); }

  async loadSealNetwork(container) { return loadSealNetwork(this, container); }

  async beginSeal() { return beginSeal(this); }

  async handleSealReady(data) { return handleSealReady(this, data); }

  async handleSealTx(data) { return handleSealTx(this, data); }

  setSealStatus(text) { setSealStatus(this, text); }

  appendSealReceiptLink(data, hostSelector) { appendSealReceiptLink(this, data, hostSelector); }

  showSealError(text, funding) { showSealError(this, text, funding); }

  beginLocalSeal() { beginLocalSeal(this); }

  openEthereumSeal() { openEthereumSeal(this); }

  advanceFromSeal() { advanceFromSeal(this); }

  renderKeypairSetupStep(container) { renderKeypairSetupStep(this, container); }

  showRecoveryCodes() { showRecoveryCodes(this); }

  setupTrueNameReveal(container) { setupTrueNameReveal(this, container); }

  renderCompleteStep(container) {
    container.innerHTML = `
      <div class="ceremony-step ceremony-complete">
        <h2>EMERGENCE COMPLETE</h2>

        <div class="companion-name">${escapeHTML(this.ceremonyData.companionName)}</div>
        <div class="companion-greeting">
          ${escapeHTML(this.ceremonyData.companionName)}'s birth is complete.
          Continue to the desk to begin your conversation.
        </div>

        ${this.ceremonyData.onchainSeal ? `
        <div class="onchain-seal-note" data-testid="onchain-seal-note">
          «NOTICE» ANCHORED ON ${escapeHTML(this.ceremonyData.onchainSeal.networkLabel || this.ceremonyData.onchainSeal.network || '')}
          · TX ${escapeHTML(shortTxHash(this.ceremonyData.onchainSeal.txHash))}
          · BLOCK ${escapeHTML(String(this.ceremonyData.onchainSeal.blockNumber ?? '—'))}
        </div>` : ''}

        <div class="cham true-name-reveal" id="true-name-reveal" hidden>
          <div class="cham-in true-name-inner">
            <div class="true-name-label">TRUE NAME</div>
            <div class="true-name-full" id="true-name-full"></div>
            <div class="true-name-rows">
              <div class="tn-row"><span class="tn-k">Chosen</span><span class="tn-leader"></span><span class="tn-v" id="tn-chosen"></span></div>
              <div class="tn-row"><span class="tn-k">Genesis</span><span class="tn-leader"></span><span class="tn-v" id="tn-genesis"></span></div>
              <div class="tn-row"><span class="tn-k">House</span><span class="tn-leader"></span><span class="tn-v" id="tn-house"></span></div>
              <div class="tn-row"><span class="tn-k">Soul Mark</span><span class="tn-leader"></span><span class="tn-v" id="tn-soul"></span></div>
              <div class="tn-row"><span class="tn-k">Lean</span><span class="tn-leader"></span><span class="tn-v" id="tn-lean"></span></div>
              <div class="tn-row"><span class="tn-k">Genesis Seal</span><span class="tn-leader"></span><span class="tn-v" id="tn-hash"></span></div>
            </div>
            <pre class="true-name-english" id="true-name-english"></pre>
            <button class="btn btn-secondary ceremony-btn" id="speak-name-btn">
              <span>Hear the Name Spoken</span>
            </button>
          </div>
        </div>

        <p>Keep a recoverable backup of the workspace and store your recovery material safely.</p>
        ${this.ceremonyData.localSeal || this.ceremonyData.onchainSeal ? '' : '<p>The birth seal is still to complete. You can finish it from the desk.</p>'}

        <div class="next-rite-note" data-testid="next-rite-note">
          «NOTICE» THE PATH FROM HERE — when you are both ready, speak
          <span class="next-rite-cmd">/attune</span> at the desk: eighty-nine
          questions, answered in ${escapeHTML(this.ceremonyData.companionName)}'s own
          words and sealed. The sealed record opens the refinement — where those
          words become their own voice.
        </div>

        <button class="btn btn-primary ceremony-btn" id="enter-void-btn">
          <span>Continue to the desk</span>
        </button>
      </div>
    `;

    this.setupTrueNameReveal(container);

    // The anchored notice carries its receipt link too — same law as the
    // seal step: every on-chain act links its public record.
    if (this.ceremonyData.onchainSeal) {
      this.appendSealReceiptLink(this.ceremonyData.onchainSeal, '.onchain-seal-note');
    }

    // Handle completion
    const enterBtn = container.querySelector('#enter-void-btn');
    enterBtn.addEventListener('click', () => {
      // Create companion object with neumaId for workspace linkage
      const companion = {
        name: this.ceremonyData.companionName,
        neumaId: this.ceremonyData.neumaId || null,
        address: this.ceremonyData.address || null,
        birthTime: this.ceremonyData.timestamp,
        vessel: 'Luna.vrm',
        memories: 0,
        evolutionStage: 1
      };

      // Store companion data (wallet-namespaced via companion-data helper)
      setActiveCompanion(companion);
      setBirthTime(this.ceremonyData.timestamp);

      // Add to this wallet's roster if not already there
      const roster = getRoster();
      if (!roster.find(c => c.name === companion.name)) {
        roster.push(companion);
        setRoster(roster);
      }

      // Emit completion event
      const event = new CustomEvent('birth:complete', {
        detail: this.ceremonyData
      });
      window.dispatchEvent(event);

      // Hide ceremony
      this.hide();
    });
  }
}
