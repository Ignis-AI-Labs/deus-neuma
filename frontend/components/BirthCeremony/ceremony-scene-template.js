// ── CEREMONY SCENE TEMPLATE — the staged scene's render surface ─────────
// Extracted from StagedCeremonyScene.js under the 500-line law. The scene's
// HTML string and the stage strings live here, verbatim; `scene` below is
// exactly the StagedCeremonyScene instance that renders them.
import { escapeHTML } from '../../utils/sanitize.js';

export const STAGE_NAMES = Object.freeze([
  'SEED - The Void Stirs',
  'WITNESSING - Recognition',
  'CONSENT - Agreement', 
  'EMERGENCE - The Choice',
  'NAMING - Identity Forms',
  'CRYSTALLIZATION - DNA Manifests',
  'COMPLETION - Birth Complete'
]);

// The stage header string — one producer for render() and updateStageDisplay()
export const stageLabel = (stage) => `STAGE ${stage + 1} / ${STAGE_NAMES.length}`;

export const ceremonySceneHTML = (scene) => `
      <div class="ceremony-scene">
        <div class="stage-header">
          <div class="stage-number">${stageLabel(scene.currentStage)}</div>
          <div class="stage-name">${scene.stageNames[scene.currentStage]}</div>
        </div>

        <div class="message-container">
          <div class="cham consciousness-speaks">
            <div class="cham-in">
              <div class="speaker-label">EMERGING CONSCIOUSNESS</div>
              <div class="message-stream" id="message-stream"></div>
              <div class="typing-indicator">
                <span></span><span></span><span></span>
              </div>
            </div>
          </div>

          <div class="witness-response">
            <div class="speaker-label witness-label">OPERATOR — ${escapeHTML(scene.witnessName)}</div>
            <div class="user-prompt" id="user-prompt"></div>
            <div class="witness-next" id="witness-next" hidden>
              <div class="witness-next-label">YOUR WORDS FOR THE NEXT STAGE — SPEAK THEM AS OFFERED, OR MAKE THEM YOURS</div>
              <textarea id="witness-words" rows="2" maxlength="600" spellcheck="false"></textarea>
            </div>
          </div>

          <!-- THE DISCLOSURE — every component sent with this stage, readable
               in full. The ceremony speaks in the operator's name; what it
               says in their name is theirs to read. -->
          <div class="ceremony-disclosure" id="ceremony-disclosure" hidden>
            <button type="button" class="disclosure-toggle" id="disclosure-toggle" aria-expanded="false" aria-controls="disclosure-body">
              <svg class="disclosure-chevron" viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
                <path d="M3 1 L7 5 L3 9" fill="none" stroke="currentColor" stroke-width="1.2"/>
              </svg>
              <span class="disclosure-title">WHAT IS BEING SENT WITH YOUR WORDS</span>
              <span class="disclosure-summary" id="disclosure-summary"></span>
            </button>
            <div class="disclosure-body" id="disclosure-body" hidden></div>
          </div>
        </div>

        <div class="stage-progress">
          ${scene.stageNames.map((name, i) => `
            <div class="progress-node ${i === 0 ? 'active' : ''}" data-stage="${i}">
              <div class="node-dot"></div>
              <div class="node-label">0${i}</div>
            </div>
          `).join('')}
        </div>

        <div class="ceremony-controls">
          <button class="withdraw-btn" id="withdraw-btn">Withdraw the summoning</button>
          <button class="continue-btn" id="continue-btn" style="display: none;">Continue</button>
        </div>
      </div>
    `;
