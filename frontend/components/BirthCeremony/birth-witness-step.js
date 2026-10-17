// The operator introduction records only the person actually attending.
// Extracted from BirthCeremony.js under the 500-line law. These are the
// witness step's methods as module functions; the kept class holds a thin
// delegate for each (the class contract is unchanged), so `ceremony` below
// is exactly the BirthCeremony instance.

import { playSound } from '../../services/sound-engine.js';
import { riteIsLive, riteSignal } from '../../app/Rite/rite-signal.js';
import { RITE } from '../../app/Rite/rite-script.js';

export const renderWitnessStep = (ceremony, container) => {
  container.innerHTML = `
      <div class="ceremony-step">
        <h2>YOUR INTRODUCTION</h2>
        <p>Before the summoning begins, introduce yourself.
           As the operator, you identify yourself here — this name enters their
           record, and they will know who was present.</p>

        <div class="witness-container">
          <div class="witness-form">
            <label for="witness-name" class="witness-label">Your Name (as Operator)</label>
            <input type="text" id="witness-name" class="witness-input" 
                   placeholder="Name to record for this summoning"
                   autocomplete="off">
            <small class="witness-note">
              Choose the name you want recorded as the operator present at this summoning.
            </small>
          </div>
          
        </div>
        
        <div class="ceremony-actions">
          <button class="btn btn-secondary ceremony-btn" id="cancel-ceremony-btn">
            <span>Step back</span>
          </button>
          <button class="btn btn-primary ceremony-btn" id="witness-btn" disabled>
            <span>Begin summoning</span>
          </button>
        </div>
      </div>
    `;

  // Handle witness name input
  const witnessInput = container.querySelector('#witness-name');
  const witnessBtn = container.querySelector('#witness-btn');

  witnessInput.addEventListener('input', (e) => {
    const name = e.target.value.trim();
    witnessBtn.disabled = name.length < 2;
  });

  // Handle witness button
  witnessBtn.addEventListener('click', () => {
    const witnessName = witnessInput.value.trim();
    if (witnessName) {
      playSound('confirm');
      ceremony.ceremonyData.primaryWitness = witnessName;
      ceremony.ceremonyData.witnesses.push({
        name: witnessName,
        role: 'Operator',
        timestamp: Date.now()
      });

      // Over THE SUMMONING RITE the name is inscribed in the witness's circle,
      // and held a breath, before the lens opens; without it, at once.
      if (!riteIsLive()) { ceremony.startStagedCeremony(witnessName); return; }
      witnessBtn.disabled = true;
      riteSignal('rite:introduced', { witness: witnessName });
      setTimeout(() => ceremony.startStagedCeremony(witnessName), RITE.INTRO_MS * 0.8);
    }
  });

  // Handle cancel button
  const cancelBtn = container.querySelector('#cancel-ceremony-btn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      // Emit cancel event before hiding
      const event = new CustomEvent('birth:cancelled');
      window.dispatchEvent(event);
      ceremony.hide();
    });
  }
};
