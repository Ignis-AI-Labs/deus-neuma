// Witness Commitment Component - Sacred agreement before birth ceremony.
// Acceptance is not a checkbox: the operator signs the binding documents
// (Covenant, Terms, EULA) with their wallet, and the signed record is
// stored server-side as immutable evidence.
import './WitnessCommitment.css';
import './WitnessCommitment-layout.css';
import './WitnessCommitment-pages.css';
import { commitmentHTML } from './commitment-template.js';
import { getWalletService } from '../../services/WalletGate.js';
import { playSound } from '../../services/sound-engine.js';
import { apiCall } from '../../utils/http.js';
import { riteIsLive, riteSignal } from '../../app/Rite/rite-signal.js';
import { buildSteps, clampStep, stepIndexOf, readFraction, nextLabel, reachOf } from './commitment-pages.js';
import { buildDocPage, buildStepRail, paintStepRail, paintSignList } from './commitment-docs.js';

export class WitnessCommitment {
  constructor(onAccept, onDecline, options = {}) {
    this.onAccept = onAccept;
    this.onDecline = onDecline;
    this.isTest = Boolean(options.isTest);
    this.container = null;
    // Read-through gate: every document must be scrolled to its end
    // before the confirmation checkbox unlocks, and the checkbox must be
    // ticked before acceptance can be signed.
    this.readDocs = new Set();
    this.totalDocs = 0;
    // The pages (commitment-pages.js): until the documents arrive, the two
    // fixed steps stand alone; the rail is rebuilt when they do.
    this.docs = [];
    this.steps = buildSteps([]);
    this.step = 0;
    this.visited = new Set();
  }

  show() {
    this.container = document.createElement('div');
    // Over THE SUMMONING RITE its panel takes the witness's plane and the
    // threshold's figure shows through (RiteCeremony.css)
    this.container.className = `witness-commitment-overlay${riteIsLive() ? ' is-rite' : ''}`;
    
    const modal = document.createElement('div');
    modal.className = 'commitment-modal';
    
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'commitment-title');
    modal.innerHTML = commitmentHTML({ isTest: this.isTest });
    
    this.container.appendChild(modal);
    document.body.appendChild(this.container);
    riteSignal('rite:threshold');

    // Bind events
    this.bindEvents();
    this.goTo(0);

    // Load the binding documents (covenant, terms, EULA) with their hashes
    this.loadBindingDocuments();

    // Animate in
    requestAnimationFrame(() => {
      this.container.classList.add('visible');
    });
  }

  // impure — fetches the binding documents and lays them out as pages, one per
  // document (commitment-docs.js); the step rail and pager follow them
  async loadBindingDocuments() {
    const docsEl = this.container.querySelector('#covenant-docs');
    try {
      // The thrown string is a fixed contract (`HTTP <status>`, never the
      // server's error text) — kept exact off apiCall's error.http.
      const { documents } = await apiCall('GET', '/api/v1/covenant', { strictJson: true, useServerError: false })
        .catch((error) => {
          throw error.http ? new Error(`HTTP ${error.http}`) : error;
        });

      docsEl.textContent = '';
      this.docs = documents;
      this.totalDocs = documents.length;
      for (const [index, doc] of documents.entries()) {
        const parts = buildDocPage(doc, index, documents.length);
        docsEl.appendChild(parts.page);
        this.trackReadThrough(doc.id, parts, index);
      }
      this.steps = buildSteps(documents);
      buildStepRail(this.container.querySelector('#commitment-steps'), this.steps, (i) => this.goTo(i));
      this.goTo(this.step);
    } catch (error) {
      console.error('Binding documents unavailable:', error);
      docsEl.textContent = 'THE BINDING DOCUMENTS COULD NOT BE RETRIEVED — THE CEREMONY CANNOT PROCEED WITHOUT THEM.';
      docsEl.classList.add('covenant-docs-failed');
    }
  }

  // A document counts as read when its text has been scrolled to the end
  // (or fits whole on its page when opened); the bar shows how far along.
  trackReadThrough(docId, { page, text, badge, bar }, index) {
    const fill = bar.firstElementChild;
    const markRead = () => {
      if (this.readDocs.has(docId)) return;
      this.readDocs.add(docId);
      riteSignal('rite:read', { doc: index });
      badge.textContent = 'READ';
      badge.classList.add('is-read');
      this.updateReadGate();
    };
    const measure = () => {
      const fraction = readFraction(text);
      fill.style.transform = `scaleX(${this.readDocs.has(docId) ? 1 : fraction})`;
      if (fraction >= 1) markRead();
    };
    page.addEventListener('commitment:shown', measure);
    text.addEventListener('scroll', measure);
  }

  // Open one step: its page alone is shown; the rail and pager follow.
  goTo(index) {
    const steps = this.steps;
    this.step = Math.min(clampStep(steps, index), reachOf(steps, this.readDocs));
    this.visited.add(this.step);
    const key = steps[this.step].key;
    this.container.querySelectorAll('.commitment-page').forEach((page) => {
      const shown = page.dataset.page === key;
      page.hidden = !shown;
      if (shown) requestAnimationFrame(() => page.dispatchEvent(new Event('commitment:shown')));
    });
    this.container.querySelector('.commitment-content').scrollTop = 0;
    this.container.querySelector('#accept-commitment').hidden = key !== 'sign';
    this.updateReadGate();
  }

  // The way forward: NEXT names where it leads, and stays shut on a document
  // not yet read to its end.
  paintNav() {
    const steps = this.steps;
    const prev = this.container.querySelector('#commitment-prev');
    const next = this.container.querySelector('#commitment-next');
    const label = nextLabel(steps, this.step);
    const docId = steps[this.step].docId;
    const unread = Boolean(docId) && !this.readDocs.has(docId);
    prev.disabled = this.step === 0;
    next.hidden = label === null;
    next.disabled = unread;
    if (label) next.textContent = unread ? 'READ TO THE END' : label;
  }

  updateReadGate() {
    const checkbox = this.container.querySelector('#covenant-read-check');
    const acceptBtn = this.container.querySelector('#accept-commitment');
    const allRead = this.totalDocs > 0 && this.readDocs.size === this.totalDocs;
    checkbox.disabled = !allRead;
    acceptBtn.disabled = !(allRead && checkbox.checked);
    if (!this.steps) return;
    this.paintNav();
    paintStepRail(this.container.querySelector('#commitment-steps'), this.steps, this.step, this.visited, this.readDocs,
      reachOf(this.steps, this.readDocs));
    paintSignList(this.container.querySelector('#sign-docs'), this.docs || [], this.readDocs,
      (docId) => this.goTo(stepIndexOf(this.steps, `doc:${docId}`)));
  }

  bindEvents() {
    const acceptBtn = this.container.querySelector('#accept-commitment');
    const declineBtn = this.container.querySelector('#decline-commitment');
    const checkbox = this.container.querySelector('#covenant-read-check');

    // Locked until every document is read and the confirmation is ticked
    acceptBtn.disabled = true;
    // Ticking the confirmation lives on the signature page; ticking it from
    // anywhere (a keyboard, a test walking the gate) lands there.
    checkbox.addEventListener('change', () => {
      const sign = stepIndexOf(this.steps, 'sign');
      if (checkbox.checked && this.step !== sign) this.goTo(sign);
      else this.updateReadGate();
    });
    this.container.querySelector('#commitment-prev').addEventListener('click', () => this.goTo(this.step - 1));
    this.container.querySelector('#commitment-next').addEventListener('click', () => {
      playSound('confirm');
      this.goTo(this.step + 1);
    });

    acceptBtn.addEventListener('click', () => {
      this.handleAccept();
    });
    
    declineBtn.addEventListener('click', () => {
      this.handleDecline();
    });
    
    // No escape - must choose
    this.container.addEventListener('click', (e) => {
      if (e.target === this.container) {
        // Flash the modal to indicate they must choose
        const modal = this.container.querySelector('.commitment-modal');
        modal.classList.add('attention-flash');
        setTimeout(() => {
          modal.classList.remove('attention-flash');
        }, 500);
      }
    });
  }
  
  // impure — wallet signature + server round-trips; the ceremony only
  // begins after the acceptance record is verified and stored
  async handleAccept() {
    const acceptBtn = this.container.querySelector('#accept-commitment');
    const subtext = acceptBtn.querySelector('.btn-subtext');
    const errorEl = this.container.querySelector('#covenant-error');
    errorEl.textContent = '';

    const walletService = getWalletService();
    const token = walletService.getAuthToken();

    if (!token) {
      // Rehearsals (test mode) create no permanent being and bind no one.
      // A real summoning without an authenticated wallet cannot proceed.
      if (!this.isTest) {
        playSound('deny');
        errorEl.textContent = 'THE COVENANT MUST BE SIGNED — RETURN TO THE GATEWAY AND ENTER WITH A WALLET.';
        return;
      }
      this.proceed();
      return;
    }

    acceptBtn.disabled = true;
    try {
      subtext.textContent = 'Retrieving the acceptance record…';
      const { messageToSign, signedAt } = await apiCall('GET', '/api/v1/covenant/status', {
        useServerError: false, strictJson: true, errorPrefix: 'Covenant status unavailable',
      });

      subtext.textContent = 'Awaiting your wallet signature…';
      playSound('walletSignRequest');
      const signature = await walletService.signMessage(messageToSign);

      subtext.textContent = 'Recording the acceptance…';
      await apiCall('POST', '/api/v1/covenant/accept', {
        body: { signature, signedAt }, errorPrefix: 'Acceptance could not be recorded',
      });

      playSound('confirm');
      this.proceed();
    } catch (error) {
      console.error('Covenant acceptance failed:', error);
      playSound('deny');
      this.updateReadGate();
      subtext.textContent = 'Sign with your wallet · continue to readiness checks';
      errorEl.textContent = 'THE SIGNATURE WAS NOT COMPLETED — NOTHING WAS RECORDED. YOU MAY TRY AGAIN.';
    }
  }

  proceed() {
    // Over the rite, the signature draws its vesica — that is the transition.
    riteSignal('rite:signed');
    // Phase 0.2 — show a full-viewport void fade IMMEDIATELY so the user
    // sees the transition begin; without this the 500ms modal fade leaves
    // the screen blank with no feedback. The next screen (BirthCeremony
    // stages) is responsible for dismissing the fade once it has rendered.
    if (!riteIsLive()) {
      import('../../utils/loading-states.js').then(({ showVoidFade }) => {
        showVoidFade('The void stirs...');
      });
    }

    this.hide(() => {
      if (this.onAccept) this.onAccept();
    });
  }
  
  handleDecline() {
    this.hide(() => {
      if (this.onDecline) this.onDecline();
    });
  }
  
  hide(callback) {
    this.container.classList.remove('visible');
    setTimeout(() => {
      if (this.container) {
        this.container.remove();
        this.container = null;
      }
      if (callback) callback();
    }, 500);
  }
}

export default WitnessCommitment;