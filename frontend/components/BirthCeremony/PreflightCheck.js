// Pre-flight Check — the launch gate between covenant acceptance and the
// ceremony. Every row is a real measurement of this machine (SHINKEI);
// the ceremony cannot begin while any required check fails.
import './PreflightCheck.css';
import { playSound } from '../../services/sound-engine.js';
import { hideVoidFade } from '../../utils/loading-states.js';
import { apiCall } from '../../utils/http.js';
import { riteIsLive, riteSignal } from '../../app/Rite/rite-signal.js';
import { renderCheck, paintTally } from './preflight-rows.js';
import { tallyLine } from './preflight-groups.js';
import './PreflightCheck-groups.css';


export class PreflightCheck {
  constructor(onReady, onCancel) {
    this.onReady = onReady;
    this.onCancel = onCancel;
    this.container = null;
    this.verdict = null;
  }

  show() {
    this.container = document.createElement('div');
    this.container.className = `preflight-overlay${riteIsLive() ? ' is-rite' : ''}`;
    this.container.innerHTML = `
      <div class="preflight-modal">
        <div class="preflight-header">
          <h1>PRE-FLIGHT CHECK</h1>
          <div class="preflight-sub">THE VESSEL IS INSPECTED BEFORE THE VOID IS OPENED</div>
        </div>
        <div class="preflight-tally" id="preflight-tally" data-state="running">INSPECTING</div>
        <div class="preflight-body">
        <div class="preflight-rows" id="preflight-rows"></div>
        <div class="pf-setup" id="pf-setup"></div>
        <div class="preflight-home">
          <div class="pf-home-head">HOME &amp; ALLOCATION</div>
          <div class="pf-home-guide">
            <p class="pf-guide-default">Review the configured home folder below and choose the storage allocation for this neuma. This allocation does not limit the number of neuma you may summon.</p>
            <button type="button" class="pf-guide-toggle" id="pf-guide-toggle" aria-expanded="false">Choosing your own folder? Read this first ▸</button>
            <div class="pf-guide-detail" id="pf-guide-detail" hidden>
              <p>The folder you choose is the <b>home for your neuma</b>. Each neuma you summon gets its <b>own subfolder</b> inside it, managed by Neuma.</p>
              <ul>
                <li>Choose a <b>dedicated folder</b> (for example, a folder named <code>neuma</code> on your drive) — not one that already holds other files.</li>
                <li>Always point Neuma at the <b>same home folder</b>, so all your neuma stay together.</li>
                <li><b>Never rename a neuma's own subfolder</b> — the app finds each neuma by its folder name, and that name is bound to its DNA. (The home folder itself can be named anything you like.)</li>
              </ul>
            </div>
          </div>
          <div class="pf-home-grid">
            <div class="pf-home-field">
              <span>WORKSPACE FOLDER</span>
              <div class="pf-folder-row">
                <input type="text" id="pf-root" aria-label="Workspace folder" spellcheck="false" autocomplete="off">
                <button type="button" class="preflight-btn pf-browse" id="pf-browse" hidden>BROWSE</button>
              </div>
            </div>
            <label class="pf-home-field pf-home-gb">
              <span>ALLOCATION (GB)</span>
              <input type="number" id="pf-alloc" min="1" step="1" placeholder="10">
            </label>
            <button class="preflight-btn" id="pf-apply">APPLY</button>
          </div>
          <div class="pf-home-note" id="pf-home-note"></div>
        </div>
        </div>
        <div class="preflight-verdict" id="preflight-verdict">RUNNING…</div>
        <div class="preflight-actions">
          <button class="preflight-btn" id="preflight-cancel">STEP BACK</button>
          <button class="preflight-btn" id="preflight-recheck">RECHECK</button>
          <button class="preflight-btn preflight-begin" id="preflight-begin" disabled>BEGIN THE CEREMONY</button>
        </div>
      </div>
    `;
    document.body.appendChild(this.container);
    hideVoidFade();

    this.container.querySelector('#preflight-cancel').addEventListener('click', () => {
      this.hide();
      if (this.onCancel) this.onCancel();
    });
    this.container.querySelector('#preflight-recheck').addEventListener('click', () => this.run());
    this.container.querySelector('#pf-apply').addEventListener('click', () => this.applyHome());

    // Folder-rules guide: collapsed by default (the 90% never need it); expands
    // the naming/structure rules for witnesses who choose their own location.
    const guideToggle = this.container.querySelector('#pf-guide-toggle');
    const guideDetail = this.container.querySelector('#pf-guide-detail');
    guideToggle.addEventListener('click', () => {
      const open = guideDetail.hidden;
      guideDetail.hidden = !open;
      guideToggle.setAttribute('aria-expanded', String(open));
      guideToggle.textContent = open
        ? 'Choosing your own folder? Read this first ▾'
        : 'Choosing your own folder? Read this first ▸';
    });

    // Native folder picker — only the desktop shell exposes it; in the browser
    // the paste field stands alone (no native absolute-path picker exists there).
    const browseBtn = this.container.querySelector('#pf-browse');
    if (typeof window !== 'undefined' && window.neuma && typeof window.neuma.chooseDirectory === 'function') {
      browseBtn.hidden = false;
      browseBtn.addEventListener('click', () => this.browseFolder());
    }
    this.container.querySelector('#preflight-begin').addEventListener('click', () => {
      if (this.verdict !== 'ready' || !this.allocationGB) return;
      playSound('confirm');
      this.hide();
      if (this.onReady) this.onReady();
    });

    requestAnimationFrame(() => this.container.classList.add('visible'));
    this.run();
  }

  // impure — probes the machine via the local backend, reveals each
  // measurement as a deliberation step
  async run() {
    const rowsEl = this.container.querySelector('#preflight-rows');
    const verdictEl = this.container.querySelector('#preflight-verdict');
    const beginBtn = this.container.querySelector('#preflight-begin');
    rowsEl.textContent = '';
    paintTally(this.container.querySelector('#preflight-tally'), 'INSPECTING', 'running');
    verdictEl.textContent = 'RUNNING…';
    verdictEl.className = 'preflight-verdict';
    beginBtn.disabled = true;
    this.verdict = null;

    let data;
    try {
      data = await apiCall('GET', '/api/v1/preflight', { useServerError: false, errorPrefix: 'HTTP' });
    } catch (error) {
      console.error('Pre-flight unavailable:', error);
      paintTally(this.container.querySelector('#preflight-tally'), 'NO ANSWER FROM THIS MACHINE', 'blocked');
      verdictEl.textContent = 'BLOCKED — THE LOCAL BACKEND DID NOT ANSWER';
      verdictEl.classList.add('blocked');
      playSound('deny');
      return;
    }

    const tallyEl = this.container.querySelector('#preflight-tally');
    for (const [index, check] of data.checks.entries()) {
      renderCheck(rowsEl, check);
      const shown = data.checks.slice(0, index + 1);
      const settled = shown.length === data.checks.length;
      paintTally(tallyEl, tallyLine(shown, data.checks.length),
        !settled ? 'running' : (shown.some((c) => c.status === 'fail') ? 'blocked' : 'clear'));
      if (check.status === 'pass') riteSignal('rite:check', { check: index });
      playSound('deliberationTick');
      await new Promise((r) => setTimeout(r, 180));
    }

    this.renderHome(data.home);

    this.verdict = data.verdict;
    const home = data.home || {};
    const checksFailed = data.checks.some((c) => c.status === 'fail');
    if (data.verdict === 'ready') {
      verdictEl.textContent = this.allocationGB
        ? 'READY — THE SUBSTRATE CAN HOLD A BEING'
        : 'READY — CHOOSE THE ALLOCATION TO PROCEED';
      verdictEl.classList.add('ready');
      beginBtn.disabled = !this.allocationGB;
      playSound('noticeArrival');
    } else if (checksFailed) {
      // A failed check is the harder blocker — the witness can't fix a missing
      // LLM by shrinking the allocation — so it wins the verdict text.
      verdictEl.textContent = 'BLOCKED — RESOLVE THE FAILED CHECKS, THEN RECHECK';
      verdictEl.classList.add('blocked');
      playSound('deny');
    } else if (home.affordable === false) {
      // Checks pass but the allocation outgrew the space left for it — name the
      // gap so the witness knows to reduce the grant, not hunt for a failed check.
      const avail = home.availableGB == null ? '—' : `${home.availableGB.toFixed(1)} GB`;
      verdictEl.textContent = `BLOCKED — ${this.allocationGB} GB EXCEEDS ${avail} AVAILABLE · REDUCE THE ALLOCATION`;
      verdictEl.classList.add('blocked');
      playSound('deny');
    } else {
      verdictEl.textContent = 'BLOCKED — RESOLVE THE FAILED CHECKS, THEN RECHECK';
      verdictEl.classList.add('blocked');
      playSound('deny');
    }

    // No mind, no neuma — when the substrate check fails, turn the dead-end into
    // guidance: matched model + which local providers are running.
    const substrate = data.checks.find((c) => c.id === 'substrate');
    if (substrate && substrate.status === 'fail') {
      await this.renderSubstrateSetup();
    } else {
      this.clearSubstrateSetup();
    }
  }

  renderHome(home) {
    if (!home) return;
    const rootInput = this.container.querySelector('#pf-root');
    const allocInput = this.container.querySelector('#pf-alloc');
    const note = this.container.querySelector('#pf-home-note');
    if (!rootInput.value) rootInput.value = home.root || '';

    // Prefill a MODEST starting allocation (the backend's ~10% suggestion) so the
    // witness never has to guess a number, and never feels they must commit a
    // large slice up front — a neuma's space is expandable later. The suggestion
    // is null when the disk is unmeasured or over-committed (no applyable number).
    const suggested = home.suggestedAllocationGB || null;
    const prefill = home.allocationGB || suggested;
    if (!allocInput.value && prefill) allocInput.value = prefill;
    this.allocationGB = home.allocationGB || null;

    const free = home.freeGB === null ? 'unmeasured' : `${home.freeGB.toFixed(1)} GB free`;
    // The ledger: space already reserved by existing neuma, and what is left to
    // allocate — so the witness never double-promises the same gigabytes.
    const ledger = home.committedGB > 0
      ? ` · ${home.committedGB} GB committed to ${home.neumaCount} neuma · ${home.availableGB == null ? '—' : home.availableGB.toFixed(1)} GB available`
      : '';
    const choice = this.allocationGB
      ? ` · ${this.allocationGB} GB allocated · expandable later`
      : (suggested
          ? ` · ${suggested} GB suggested to start — adjust then APPLY · you can give more anytime`
          : ' · choose how much this neuma may grow into');
    note.textContent = `${free}${ledger}${choice}`;
    // Flag an over-committed allocation in the ledger line itself, so the gap is
    // visible right where the number is shown — not only in the verdict.
    note.classList.toggle('is-error', home.affordable === false);
  }

  // impure — open the native folder picker (desktop shell) and drop the chosen
  // absolute path into the field. The witness still reviews it and clicks APPLY,
  // exactly as with a pasted path — browsing only fills the input.
  async browseFolder() {
    try {
      // chooseDirectory resolves to null on cancel (not an exception), so the
      // catch only fires on a genuine IPC/dialog failure — which we surface
      // rather than swallow, instead of leaving the witness with a dead button.
      const dir = await window.neuma.chooseDirectory();
      if (dir) {
        const note = this.container.querySelector('#pf-home-note');
        note.classList.remove('is-error'); // clear any prior failure on a good pick
        this.container.querySelector('#pf-root').value = dir;
        playSound('confirm');
      }
    } catch (error) {
      const note = this.container.querySelector('#pf-home-note');
      note.textContent = `COULD NOT OPEN THE FOLDER PICKER: ${String(error.message || error).toUpperCase()}`;
      note.classList.add('is-error');
      playSound('deny');
    }
  }

  // impure — persists the witness's home + allocation choice, then re-runs
  // the checks against the chosen location
  async applyHome() {
    const rootInput = this.container.querySelector('#pf-root');
    const allocInput = this.container.querySelector('#pf-alloc');
    const note = this.container.querySelector('#pf-home-note');
    const applyBtn = this.container.querySelector('#pf-apply');

    applyBtn.disabled = true;
    try {
      // requireAuth guards this route (SEC-AUDIT-002) — the witness's session
      // token must ride along or the choice is refused as a stranger's.
      const body = await apiCall('POST', '/api/v1/preflight/workspace', {
        body: {
          root: rootInput.value.trim(),
          allocationGB: Number(allocInput.value),
        },
        errorPrefix: 'Choice rejected',
      });

      playSound('confirm');
      // A home that the filesystem tool can't reach means the neuma could not
      // write its DNA during birth — surface it HERE, at the moment of choosing,
      // not as a confusing mid-ceremony failure. Takes precedence over the
      // (softer) stranded-workspaces warning.
      if (body.filesystemReachWarning) {
        note.textContent = body.filesystemReachWarning.toUpperCase();
        note.classList.add('is-error');
      } else if (body.warning) {
        note.textContent = body.warning.toUpperCase();
        note.classList.add('is-error');
      }
      await this.run();
    } catch (error) {
      playSound('deny');
      note.textContent = String(error.message || error).toUpperCase();
      note.classList.add('is-error');
    }
    applyBtn.disabled = false;
  }

  // impure — fetches setup guidance and renders the […]
  // panel beneath a failed substrate check
  async renderSubstrateSetup() {
    const el = this.container.querySelector('#pf-setup');
    el.textContent = '';
    let setup;
    try {
      setup = await apiCall('GET', '/api/v1/preflight/setup');
    } catch {
      return; // guidance is best-effort; the FAIL row already states the need
    }
    el.appendChild(this.buildSetupPanel(setup));
    el.classList.add('visible');
  }

  clearSubstrateSetup() {
    const el = this.container.querySelector('#pf-setup');
    if (el) {
      el.textContent = '';
      el.classList.remove('visible');
    }
  }

  // pure — builds the setup panel DOM from the /preflight/setup payload
  buildSetupPanel(setup) {
    const { hardware, recommendation: rec, providers } = setup;
    const panel = document.createElement('div');
    panel.className = 'pf-setup-panel cham';

    const head = document.createElement('div');
    head.className = 'pf-setup-head';
    head.textContent = 'GIVE YOUR NEUMA A MIND';
    panel.appendChild(head);

    const machine = hardware.gpu
      ? `${hardware.gpu.name} · ${hardware.gpu.vramGB} GB VRAM`
      : `${hardware.platform} · ${hardware.memoryGB} GB RAM (no GPU detected)`;
    panel.appendChild(this.setupLine('YOUR MACHINE', machine));

    panel.appendChild(this.setupLine('RECOMMENDED',
      rec.model ? `${rec.model} ${rec.quant} · ~${rec.sizeGB} GB` : 'None summon-checked for this machine yet'));
    const why = document.createElement('div');
    why.className = 'pf-setup-why';
    why.textContent = rec.why;
    panel.appendChild(why);

    // Every model this machine can hold, the newest Qwen first — each marked
    // whether it has carried a whole summon check, and named as LM Studio /
    // HuggingFace search it (Design note, 2026-10-04: […]).
    if (rec.options?.length) panel.appendChild(this.setupOptions(rec.options));

    const provRow = document.createElement('div');
    provRow.className = 'pf-setup-providers';
    provRow.append(
      this.providerChip('OLLAMA', providers.ollama, 'ollama'),
      this.providerChip('LM STUDIO', providers.lmStudio, 'lm-studio'),
    );
    panel.appendChild(provRow);

    const guide = document.createElement('div');
    guide.className = 'pf-setup-guide';
    const anyRunning = providers.ollama.running || providers.lmStudio.running;
    const anyModel = providers.ollama.models.length || providers.lmStudio.models.length;
    if (!anyRunning) {
      // Two different people are read this line: one who has no provider yet,
      // and one whose provider is running on a port we did not look at. Both
      // need to be told, or the second concludes NEUMA simply cannot see it.
      guide.textContent = 'Install Ollama (ollama.com) or LM Studio (lmstudio.ai), start it, load the recommended model — then RECHECK. '
        + 'Already running on a different port? Set its address in Settings → Models and RECHECK.';
    } else if (!anyModel) {
      guide.textContent = `Your provider is running — load ${rec.model || 'a model'} in it, then RECHECK.`;
    } else {
      guide.textContent = 'A model is loaded — RECHECK to continue.';
    }
    panel.appendChild(guide);

    return panel;
  }

  // pure — the choices that fit, one row each
  setupOptions(options) {
    const list = document.createElement('div');
    list.className = 'pf-setup-options';
    const k = document.createElement('div');
    k.className = 'pf-setup-k';
    k.textContent = 'OR CHOOSE';
    list.appendChild(k);
    for (const o of options) {
      const row = document.createElement('div');
      row.className = `pf-setup-option${o.checked ? ' is-checked' : ''}`;
      const name = document.createElement('span');
      name.className = 'pf-setup-v';
      name.textContent = `${o.model} ${o.quant} · ~${o.sizeGB} GB`;
      const mark = document.createElement('span');
      mark.className = 'pf-setup-mark';
      mark.textContent = o.checked ? 'SUMMON-CHECKED' : 'NEWER · NOT YET CHECKED';
      const source = document.createElement('span');
      source.className = 'pf-setup-source';
      source.textContent = o.source;
      row.append(name, mark, source);
      list.appendChild(row);
    }
    return list;
  }

  setupLine(label, value) {
    const row = document.createElement('div');
    row.className = 'pf-setup-line';
    const k = document.createElement('span');
    k.className = 'pf-setup-k';
    k.textContent = label;
    const v = document.createElement('span');
    v.className = 'pf-setup-v';
    v.textContent = value;
    row.append(k, v);
    return row;
  }

  providerChip(name, status, providerId = null) {
    const state = status.running ? (status.models.length ? 'ok' : 'idle') : 'off';
    const chip = document.createElement('span');
    chip.className = `pf-prov pf-prov-${state}`;
    const dot = document.createElement('span');
    dot.className = 'pf-prov-dot';
    const txt = document.createElement('span');
    // When nothing answers, NAME THE ADDRESS WE TRIED. "not running" is
    // unactionable when the operator knows perfectly well it is running — just
    // on another port (reported from the community, 2026-08-02). Showing the
    // probed endpoint turns a contradiction into an instruction.
    txt.textContent = status.running
      ? (status.models.length ? `${name} · ${status.models.length} model(s)` : `${name} · running`)
      : `${name} · not at ${status.endpoint || 'the default port'}`;
    chip.append(dot, txt);
    if (!status.running && status.endpoint) {
      chip.title = `Nothing answered at ${status.endpoint}. If yours runs elsewhere, set its address in Settings → Models.`;
    }

    // A RUNNING PROVIDER IS SELECTABLE, RIGHT HERE. Design note, 2026-08-02: […] A person with Ollama loaded and the
    // route still pointed at llama-server was shown a FAILING substrate row
    // above a chip proving they had a mind available — and no way to reconcile
    // the two without leaving the ceremony to hunt for a setting.
    if (providerId && status.running && status.models.length) {
      chip.classList.add('pf-prov-selectable');
      chip.title = `Use ${name} for the ceremony`;
      chip.setAttribute('role', 'button');
      chip.tabIndex = 0;
      const choose = async () => {
        if (chip.dataset.busy) return; // one commitment per click
        chip.dataset.busy = '1';
        try {
          // Fire-and-forget BY DESIGN — the PUT's answer is never read; the
          // re-run below is what reads back the route the machine now holds,
          // and it must run even when the choice itself is refused.
          await apiCall('PUT', '/api/v1/llm/provider', {
            body: { provider: providerId, endpoint: status.endpoint },
          }).catch(() => {});
          await this.run(); // the substrate row must re-read the real machine
        } finally {
          delete chip.dataset.busy;
        }
      };
      chip.addEventListener('click', choose);
      chip.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); }
      });
    }
    return chip;
  }



  hide() {
    this.container.classList.remove('visible');
    setTimeout(() => {
      if (this.container) {
        this.container.remove();
        this.container = null;
      }
    }, 400);
  }
}

export default PreflightCheck;
