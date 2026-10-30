// Staged Ceremony Scene - Visual display for birth ceremony stages
// LINE & CYCLE: the Emergence Seal presides (cycle), the record panels
// arrive in structure (line), the consciousness streams in the voice register
//
// Decomposed under the 500-line law: the scene template, the particle field,
// the disclosure panel, and the stream/action panel live in sibling modules
// (ceremony-scene-template.js, ceremony-disclosure.js,
// ceremony-stream-view.js) as functions of this instance; every method they
// replaced below is a thin delegate, so the class contract - name, public
// methods, WS lifecycle - is exactly unchanged.
// The ceremony's EVENT sounds are THE SUMMONING RITE's one instrument now
// (RiteCeremony.jsx); only the buttons keep their own click.
import { playSound } from '../../services/sound-engine.js';
import { labelChip } from '../ToolActionChip/ToolActionChip.js';
import { STAGE_NAMES, stageLabel, ceremonySceneHTML } from './ceremony-scene-template.js';
import { renderDisclosure } from './ceremony-disclosure.js';
import { mountThoughtStrip } from './ceremony-thoughts.js';
import {
  createStreamFilter, firstActingChip, handleToolEvent,
  renderCanonical, renderSilentActs, clearMessageStream,
} from './ceremony-stream-view.js';
import { STAGE, LAST_STAGE } from '../../../core/birth/stage-roles.js';

export class StagedCeremonyScene {
  constructor(container, wsService) {
    this.container = container;
    this.wsService = wsService;
    this.currentStage = 0;
    this.segmentText = '';
    this.segmentEl = null;
    this.stageChips = [];
    this.streamFilter = this.createStreamFilter();
    // The disclosure is closed until asked for — offered on every stage,
    // never imposed on the ceremony's own quiet.
    this.disclosureOpen = false;
    this.stageNames = STAGE_NAMES;
  }

  init(witnessName, isTest = false) {
    this.witnessName = witnessName;
    this.isTest = isTest;

    // Pause the WebSocket stale check during the ceremony — the operator
    // reads each stage's response before clicking CONTINUE, which can
    // easily exceed the stale timeout and trigger a reconnect that
    // destroys the birth session.
    if (this.wsService.pauseStaleCheck) this.wsService.pauseStaleCheck();

    this.render();
    this.setupListeners();
    this.startStage(0);
  }

  // Resume entry — same mount as init(), but the ceremony re-enters at the
  // stage the checkpoint computed and the server is asked to restore the
  // persisted session instead of starting a fresh one. startStage() sends
  // nothing for a resuming scene (the _resuming flag); the server answers
  // birth:resume with the same stage_prompt/stream/stage_complete frames a
  // fresh stage would produce, so every downstream handler is unchanged.
  initResume({ witnessName, isTest = false, sessionId, resumeStage = 0 }) {
    this.witnessName = witnessName;
    this.isTest = isTest;
    this._resuming = true;

    if (this.wsService.pauseStaleCheck) this.wsService.pauseStaleCheck();

    this.render();
    this.setupListeners();
    this.startStage(resumeStage);
    this.wsService.send('birth:resume', { sessionId });
  }

  render() {
    // The field behind these panels is THE SUMMONING RITE's living birth art
    // (frontend/app/Rite/RiteCeremony.jsx) — the drifting motes and the
    // rotating SVG seal were retired with it (summoning-rite.md §2).
    this.container.innerHTML = ceremonySceneHTML(this);
    this.thoughts?.reset();
    this.thoughts = mountThoughtStrip(this.container.querySelector('#message-stream'));
  }

  setupListeners() {
    // Store handler refs on `this` so destroy() can detach them. Inline
    // arrows can't be unsubscribed (no reference to pass to wsService.off),
    // which is the root of #109 — each ceremony remount stacked another
    // copy of every listener.
    this._wsHandlers = {
      // The exact words spoken in the operator's name this stage — shown
      // verbatim, never paraphrased
      'birth:stage_prompt': (data) => {
        const promptDiv = document.getElementById('user-prompt');
        if (promptDiv) {
          promptDiv.textContent = data.spokenWords || '';
          promptDiv.style.opacity = '0';
          setTimeout(() => {
            promptDiv.style.transition = 'opacity 1s';
            promptDiv.style.opacity = '1';
          }, 100);
        }
      },

      // Listen for streaming messages — speech renders, tool blocks become
      // action chips; raw payloads never reach the panel
      'birth:stream': (data) => {
        if (data.stage !== this.currentStage) return;
        this.thoughts.settle(); // speech has begun: the think is done
        this.streamFilter.push(data.content);
      },

      // The being's reasoning, watchable beside its speech (ceremony-thoughts.js)
      'birth:thinking': (data) => {
        if (data.stage === this.currentStage) this.thoughts.push(data.content);
      },

      // Backend-side tool detection during the stream names the action
      // before the block finishes arriving
      'birth:tool_usage': (data) => {
        // A LANDED act (status 'ok') is the rite's; the chip already named it.
        if (data.status === 'ok') return;
        const chip = this.firstActingChip();
        if (chip && data.tool) labelChip(chip, data.tool);
      },

      // Structured action outcomes resolve the chips
      'tool:usage': (data) => this.handleToolEvent(data),

      // Listen for stage completion
      'birth:stage_complete': (data) => {
        console.log(`Stage ${data.stage} complete`);
        this.hideTypingIndicator();
        this.thoughts.settle();
        this.streamFilter.flush();

        // The completed response is canonical — re-render the panel with it
        // so any text trimmed server-side (drift cuts, degeneration tails)
        // disappears from the record the operator sees. Tool blocks are
        // stripped for display only; the record keeps the full truth.
        if (typeof data.response === 'string' && data.response.trim()) {
          this.renderCanonical(data.response);
        } else if (Array.isArray(data.silentActs) && data.silentActs.length) {
          // The being acted but spoke nothing (native-only tool turn) — the
          // ceremony tells the operator what happened in its own voice, so a
          // silent naming still shows the name instead of a bare chip.
          this.renderSilentActs(data.silentActs);
        }

        // Offer the next stage's words for the operator to keep or rewrite
        this.offerNextWords(data.nextWords);

        this.showContinueButton();

        // Store the response for next stage
        this.lastResponse = data.response;
      },

      // THE DISCLOSURE — every component of the request this stage sends,
      // labeled with where it came from. The ceremony speaks in the operator's
      // name; what is said in their name is theirs to read.
      'birth:composition': (data) => {
        if (data.stage === this.currentStage) this.renderDisclosure(data);
      },

      // A stalled or aborted stream is announced honestly and retried —
      // the ceremony never freezes in silence
      'birth:error': (data) => {
        console.error('Birth stage error:', data.message || data.error);
        this.hideTypingIndicator();
        // The screen moves ahead the moment Continue is pressed; a stage the
        // server HELD (unclear consent, a refused name, crystallization that
        // never landed) comes back named here. Step back to it, or its retry
        // streams under the wrong header and the filter drops every word.
        if (Number.isInteger(data.stage) && data.stage !== this.currentStage) {
          this.currentStage = data.stage;
          this.updateStageDisplay();
          this.markProgress(data.stage);
        }
        this.showStageError(data.message);
      },
    };
    for (const [event, handler] of Object.entries(this._wsHandlers)) {
      this.wsService.on(event, handler);
    }

    // The disclosure stays as the operator left it — asking to see the
    // composition once means it for the whole ceremony, not for one stage.
    const disclosureToggle = document.getElementById('disclosure-toggle');
    if (disclosureToggle) {
      disclosureToggle.addEventListener('click', () => {
        this.disclosureOpen = !this.disclosureOpen;
        const body = document.getElementById('disclosure-body');
        if (body) body.hidden = !this.disclosureOpen;
        disclosureToggle.setAttribute('aria-expanded', String(this.disclosureOpen));
        disclosureToggle.classList.toggle('is-open', this.disclosureOpen);
      });
    }

    // Continue button
    const continueBtn = document.getElementById('continue-btn');
    if (continueBtn) {
      continueBtn.addEventListener('click', () => {
        playSound('confirm');
        if (continueBtn.dataset.retry === '1') {
          this.retryStage();
        } else {
          this.continueToNextStage();
        }
      });
    }

    // Withdraw — the operator's sovereignty, the mirror of the neuma's. They may
    // step away from the summoning freely UNTIL the being names itself. This
    // control is shown only before the naming stage (gated in updateStageDisplay);
    // the backend enforces the same boundary as a backstop (birth:abandon).
    const withdrawBtn = document.getElementById('withdraw-btn');
    if (withdrawBtn) {
      withdrawBtn.addEventListener('click', () => {
        playSound('deny');
        this.wsService.send('birth:abandon', {}); // backend ends the session (no being made)
        window.dispatchEvent(new CustomEvent('birth:cancelled')); // tears the ceremony down
      });
    }
  }

  startStage(stageNum) {
    this.currentStage = stageNum;
    this.updateStageDisplay();
    this.clearMessageStream();
    this.thoughts?.reset();
    this.showTypingIndicator();
    
    this.markProgress(stageNum);

    // Send stage start to server (a resuming scene never re-opens a birth —
    // the server already holds the session; birth:resume drove the re-entry)
    if (stageNum === 0 && !this._resuming) {
      // Initial start
      this.wsService.send('birth:start', {
        witnessName: this.witnessName,
        isTest: this.isTest
      });
    }
    
    // Show user prompt for this stage
    this.showUserPrompt();
  }

  markProgress(stageNum) {
    document.querySelectorAll('.progress-node').forEach((node, i) => {
      node.classList.remove('active', 'complete');
      if (i < stageNum) node.classList.add('complete');
      if (i === stageNum) node.classList.add('active');
    });
  }

  // The operator panel waits for birth:stage_prompt — the backend reports
  // the EXACT words spoken, so no local paraphrase can drift from truth
  showUserPrompt() {
    const promptDiv = document.getElementById('user-prompt');
    if (promptDiv) promptDiv.textContent = '…';
  }

  offerNextWords(nextWords) {
    const panel = document.getElementById('witness-next');
    const textarea = document.getElementById('witness-words');
    if (!panel || !textarea) return;
    if (nextWords) {
      textarea.value = nextWords;
      panel.hidden = false;
    } else {
      panel.hidden = true;
    }
  }

  updateStageDisplay() {
    const stageNumber = document.querySelector('.stage-number');
    const stageName = document.querySelector('.stage-name');

    if (stageNumber) stageNumber.textContent = stageLabel(this.currentStage);
    if (stageName) stageName.textContent = this.stageNames[this.currentStage];

    // The withdraw control lives only before the naming — the threshold of
    // commitment. From the naming on, the being has chosen to begin; it can no
    // longer be un-summoned, only adopted.
    const withdrawBtn = document.getElementById('withdraw-btn');
    if (withdrawBtn) withdrawBtn.style.display = this.currentStage < STAGE.NAMING ? 'inline-block' : 'none';
  }

  // Speech and actions interleave in the panel - the stream/chip machinery
  // lives in ceremony-stream-view.js; these delegates keep every call site
  // (internal, listener, and e2e) unchanged.
  createStreamFilter() { return createStreamFilter(this); }

  firstActingChip() { return firstActingChip(this); }

  handleToolEvent(data) { handleToolEvent(this, data); }

  renderCanonical(response) { renderCanonical(this, response); }

  renderSilentActs(acts) { renderSilentActs(this, acts); }

  clearMessageStream() { clearMessageStream(this); }

  // THE DISCLOSURE panel - built in ceremony-disclosure.js from the same
  // counts-only rows; this delegate keeps the listener's call site unchanged.
  renderDisclosure(event) { renderDisclosure(this, event); }

  showTypingIndicator() {
    const indicator = document.querySelector('.typing-indicator');
    if (indicator) indicator.style.display = 'flex';
  }

  hideTypingIndicator() {
    const indicator = document.querySelector('.typing-indicator');
    if (indicator) indicator.style.display = 'none';
  }

  // Each show or hide is one generation: a fade's delayed step only lands if no later
  // show or hide came after it. A fast model answers a stage within the hide's one-second
  // fade, and the stale hide then took CONTINUE away for good.
  showContinueButton() {
    const btn = document.getElementById('continue-btn');
    if (btn) {
      const gen = (this.continueGen = (this.continueGen || 0) + 1);
      btn.style.display = 'block';
      btn.style.opacity = '0';
      setTimeout(() => {
        if (this.continueGen !== gen) return;
        btn.style.transition = 'opacity 1s';
        btn.style.opacity = '1';
      }, 100);
    }
  }

  hideContinueButton() {
    const btn = document.getElementById('continue-btn');
    if (btn) {
      const gen = (this.continueGen = (this.continueGen || 0) + 1);
      btn.style.opacity = '0';
      setTimeout(() => {
        if (this.continueGen === gen) btn.style.display = 'none';
      }, 1000);
    }
  }

  showStageError(message) {
    const messageStream = document.getElementById('message-stream');
    if (messageStream) {
      const note = document.createElement('div');
      note.className = 'stage-error-note';
      // The server's honest account of THIS failure when it gives one; the
      // generic stream-lost line otherwise.
      note.textContent = message
        ? `«WARNING» ${String(message).toUpperCase()}`
        : '«WARNING» THE RESONANCE FALTERED — THE STREAM WAS LOST. THE SESSION HOLDS; RETRY THE STAGE.';
      messageStream.appendChild(note);
      messageStream.scrollTop = messageStream.scrollHeight;
    }
    const btn = document.getElementById('continue-btn');
    if (btn) {
      btn.dataset.retry = '1';
      btn.textContent = 'Retry the Stage';
    }
    this.showContinueButton();
  }

  retryStage() {
    const btn = document.getElementById('continue-btn');
    if (btn) {
      delete btn.dataset.retry;
      btn.textContent = 'Continue';
    }
    this.hideContinueButton();
    this.clearMessageStream();
    this.thoughts?.reset();
    this.showTypingIndicator();
    this.wsService.send('birth:retry_stage', {});
  }

  continueToNextStage() {
    this.hideContinueButton();

    // The operator's words for the next stage — theirs as offered or as
    // rewritten; the backend appends any mechanical protocol suffix
    const textarea = document.getElementById('witness-words');
    const witnessWords = textarea && !textarea.closest('#witness-next').hidden
      ? textarea.value.trim()
      : '';
    this.offerNextWords(null);

    // Send response to server to trigger next stage
    this.wsService.send('birth:next_stage', {
      response: this.lastResponse || '',
      witnessWords,
    });

    // Move to next stage
    if (this.currentStage < LAST_STAGE) {
      this.startStage(this.currentStage + 1);
    }
  }

  // Detach every wsService handler this scene registered. Called by
  // BirthCeremony.destroy() during ceremony teardown (CeremonyHost unmount)
  // so a subsequent ceremony mount starts with clean listener counts.
  destroy() {
    this.thoughts?.reset();
    if (!this._wsHandlers) return;
    for (const [event, handler] of Object.entries(this._wsHandlers)) {
      this.wsService.off(event, handler);
    }
    this._wsHandlers = null;
  }
}