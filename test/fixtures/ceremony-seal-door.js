/* global window, document, location, URLSearchParams */
// The ceremony's SEAL step as BirthCeremony mounts it (birth-seal-step.js), for the unlock door's browser
// proof. The unlock and recovery calls go to the REAL backend routes the test serves. The socket's
// outbound side is recorded on window.sent: the claim here stops at […] — what the
// backend answers to that ask is proven on a real chain by ceremony-seal-after-custody.test.js.
import '../../frontend/styles/main.css';
import '../../frontend/components/BirthCeremony/BirthCeremony.css';
import {
  renderOnchainSealStep, showSealError, showLocalError, setSealStatus, openEthereumSeal, beginLocalSeal,
  beginSeal, loadSealNetwork,
} from '../../frontend/components/BirthCeremony/birth-seal-step.js';

const LOCKED = 'this being\'s keypair is password-secured — enter the password below and the anchor walks again';
window.sent = [];
const container = document.createElement('main');
container.className = 'birth-ceremony';
container.style.maxWidth = '620px';
container.style.padding = '24px';
document.body.append(container);

const ceremony = {
  container,
  ceremonyData: { neumaId: new URLSearchParams(location.search).get('lane'), companionName: 'Nehia', trueName: { genesisHash: '23314d22e2346cd8aa01' } },
  wsService: { send: (type, payload) => window.sent.push({ type, ...payload }) },
  advanceFromSeal: () => { window.advanced = true; },
  beginLocalSeal() { beginLocalSeal(this); },
  openEthereumSeal() { openEthereumSeal(this); },
  loadSealNetwork(host) { return loadSealNetwork(this, host); },
  setSealStatus(text) { setSealStatus(this, text); },
  showSealError(text, funding, code) { showSealError(this, text, funding, code); },
  beginSeal() { return beginSeal(this); },
};
renderOnchainSealStep(ceremony, container);

// What BirthCeremony's birth:seal_error / birth:local_seal_error handlers do with a KEY_LOCKED frame.
window.keyLocked = (way) => (way === 'local'
  ? showLocalError(ceremony, 'this being\'s key is password-secured — enter the password below and the seal goes on', 'KEY_LOCKED')
  : ceremony.showSealError(LOCKED, null, 'KEY_LOCKED'));
window.ready = true;
