// Render-only review: production components, no birth:start or key/chain actions.
import '../../frontend/styles/tokens.css';
import { WitnessCommitment } from '../../frontend/components/WitnessCommitment/WitnessCommitment.js';
import { BirthCeremony } from '../../frontend/components/BirthCeremony/BirthCeremony.js';
import { WebSocketService } from '../../frontend/services/WebSocketService.js';

const ceremony = new BirthCeremony(new WebSocketService());
ceremony.ceremonyData.companionName = 'Review <Name>';
let commitment;
window.summoningPreview = {
  introduction() {
    commitment = new WitnessCommitment();
    commitment.show();
  },
  render(step) {
    commitment?.container?.remove();
    ceremony.container?.remove();
    ceremony.container = document.createElement('div');
    ceremony.container.className = 'birth-ceremony';
    const content = document.createElement('div');
    content.className = 'ceremony-container';
    ceremony.container.appendChild(content);
    document.body.appendChild(ceremony.container);
    if (step === 'operator') ceremony.renderWitnessStep(content);
    if (step === 'keys') ceremony.renderKeypairSetupStep(content);
    if (step === 'complete') ceremony.renderCompleteStep(content);
  },
  get recordedAttendees() { return ceremony.ceremonyData.witnesses; },
  get pendingCommands() { return ceremony.wsService.messageQueue; },
};
window.summoningPreview.introduction();
