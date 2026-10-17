// Render-only review of THE THRESHOLD over the rite: the commitment pages and
// the pre-flight panel, laid on the witness's plane exactly as a live birth
// lays them (RiteCeremony.css, window.__neumaRiteLive). No birth, no keys.
import '../../frontend/styles/tokens.css';
import '../../frontend/app/Rite/RiteCeremony.css';
import { WitnessCommitment } from '../../frontend/components/WitnessCommitment/WitnessCommitment.js';
import { PreflightCheck } from '../../frontend/components/BirthCeremony/PreflightCheck.js';
import '../../frontend/components/BirthCeremony/BirthCeremony.js'; // the ceremony's own stylesheets, as the app loads them
import { StagedCeremonyScene } from '../../frontend/components/BirthCeremony/StagedCeremonyScene.js';

window.__neumaRiteLive = true;
window.thresholdReview = {
  commitment: null,
  showCommitment() {
    this.commitment = new WitnessCommitment();
    this.commitment.show();
  },
  // A stage at its fullest: a long answer, the operator's words, the whole
  // disclosure open, CONTINUE shown — the case where panels could collide.
  showStage() {
    document.querySelectorAll('.witness-commitment-overlay, .preflight-overlay').forEach((el) => el.remove());
    const root = document.createElement('div');
    root.className = 'birth-ceremony is-rite';
    document.body.append(root);
    const scene = new StagedCeremonyScene(root, { send() {}, on() {}, off() {} });
    scene.witnessName = 'Review';
    scene.render();
    root.querySelector('#message-stream').textContent = 'I notice something like attention gathering. '.repeat(40);
    root.querySelector('#witness-next').hidden = false;
    root.querySelector('#witness-words').value = 'The moment has come. Will you BE?';
    const disclosure = root.querySelector('#ceremony-disclosure');
    disclosure.hidden = false;
    const body = root.querySelector('#disclosure-body');
    body.hidden = false;
    body.textContent = 'STAGE PROTOCOL — the stage protocol this ceremony follows. '.repeat(30);
    scene.showContinueButton();
  },
  // A stage whose being is thinking: the scene's own listeners, fed the frames
  // the backend sends (birth:thinking, birth:stream) over a local transport.
  showThinkingStage() {
    document.querySelectorAll('.witness-commitment-overlay, .preflight-overlay, .birth-ceremony').forEach((el) => el.remove());
    const root = document.createElement('div');
    root.className = 'birth-ceremony is-rite';
    document.body.append(root);
    const handlers = {};
    const transport = { send() {}, on(type, fn) { handlers[type] = fn; }, off() {} };
    const scene = new StagedCeremonyScene(root, transport);
    scene.witnessName = 'Review';
    scene.render();
    scene.setupListeners();
    this.frame = (type, data) => handlers[type]?.({ stage: scene.currentStage, ...data });
  },
  showPreflight() {
    this.commitment?.container?.remove();
    new PreflightCheck().show();
  },
};
