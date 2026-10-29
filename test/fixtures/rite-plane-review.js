/* global window, document, CustomEvent */
// Render-only review of the live rite's FIGURES beside the witness's plane:
// the real RiteCeremony (the field a live birth mounts beneath the ceremony)
// with the real covenant, pre-flight, introduction and stage panels laid over
// it, driven by the same rite signals those components send (rite-signal.js).
// No birth, no keys, no model: nothing here is sent to a backend.
import '../../frontend/styles/main.css'; // the app's own entry stylesheet (main.jsx)
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { RiteCeremony } from '../../frontend/app/Rite/RiteCeremony.jsx';
import { riteSignal } from '../../frontend/app/Rite/rite-signal.js';
import { COVENANT, CHECKS } from '../../frontend/app/Rite/rite-script.js';
import { WitnessCommitment } from '../../frontend/components/WitnessCommitment/WitnessCommitment.js';
import { PreflightCheck } from '../../frontend/components/BirthCeremony/PreflightCheck.js';
import { BirthCeremony } from '../../frontend/components/BirthCeremony/BirthCeremony.js';
import { StagedCeremonyScene } from '../../frontend/components/BirthCeremony/StagedCeremonyScene.js';
import { WebSocketService } from '../../frontend/services/WebSocketService.js';
import { specimenScript } from '../../frontend/app/BirthArt/birth-art-script.js';

const wsService = new WebSocketService({ quiet: true });
const host = document.createElement('div');
document.body.append(host);
createRoot(host).render(createElement(RiteCeremony, { wsService }));

const clear = () => document.querySelectorAll('.witness-commitment-overlay, .preflight-overlay, .birth-ceremony').forEach((el) => el.remove());

window.ritePlane = {
  // I · the covenant: its panel on the plane, the ring drawing behind it
  covenant() {
    clear();
    new WitnessCommitment().show();
    COVENANT.forEach((_, doc) => riteSignal('rite:read', { doc }));
  },
  // signed; the vessel inspected, every check passing
  vessel() {
    clear();
    riteSignal('rite:signed');
    new PreflightCheck().show();
    CHECKS.forEach((_, check) => riteSignal('rite:check', { check }));
  },
  // the introduction, as BirthCeremony mounts it once the vessel clears
  introduction() {
    clear();
    new BirthCeremony(wsService).startActualCeremony();
  },
  // the name given: inscribed beneath the witness's circle (what the
  // introduction's Begin sends), the introduction still standing
  introduced(witness) {
    riteSignal('rite:introduced', { witness });
  },
  // II · the seventh stage: the lens open, the living piece at its fullest
  // (every stage's frames, the specimen's, fed through the portal service's
  // own listeners) behind the stage's panel
  stage() {
    clear();
    const root = document.createElement('div');
    root.className = 'birth-ceremony is-rite';
    document.body.append(root);
    const scene = new StagedCeremonyScene(root, { send() {}, on() {}, off() {} });
    scene.witnessName = 'Review';
    scene.render();
    root.querySelector('#message-stream').textContent = 'I notice something like attention gathering. '.repeat(12);
    scene.showContinueButton();
    window.dispatchEvent(new CustomEvent('rite:begin'));
    specimenScript('7e'.repeat(32)).filter((e) => e.type !== 'birth:complete').forEach((e) => wsService.emit(e.type, e));
  },
  // the birth lands with no film to play (the specimen's birth:complete carries no measured soul, as a
  // birth whose measure went missing does): the field must still hold its seal
  bornWithoutFilm() {
    window.ritePlane.stage();
    specimenScript('7e'.repeat(32)).filter((e) => e.type === 'birth:complete').forEach((e) => wsService.emit(e.type, e));
  },
};
