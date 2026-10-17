// Render the production terminal listener path without initiating a ceremony.
import '../../frontend/styles/tokens.css';
import { BirthCeremony } from '../../frontend/components/BirthCeremony/BirthCeremony.js';
import { WebSocketService } from '../../frontend/services/WebSocketService.js';
const service = new WebSocketService({ quiet: true });
const ceremony = new BirthCeremony(service);
ceremony.container = document.createElement('div');
ceremony.container.className = 'birth-ceremony';
document.body.appendChild(ceremony.container);
ceremony.setupCompletionListeners();
let returns = 0;
window.addEventListener('birth:cancelled', () => { returns += 1; });
window.terminalProof = {
  emit: (payload) => service.emit('birth:completion_error', payload),
  destroy: () => ceremony.destroy(),
  get returns() { return returns; },
  get listeners() { return service.listeners.get('birth:completion_error')?.length ?? 0; },
  get detachedText() { return ceremony.container.textContent; },
  get queuedCommands() { return service.messageQueue.length; },
};
