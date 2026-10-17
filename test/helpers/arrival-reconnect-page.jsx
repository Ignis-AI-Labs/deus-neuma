// impure — focused desk-arrival entry using production services and browser storage.
import { createRoot } from 'react-dom/client';
import { ArrivalVeil } from '../../frontend/app/RelinkShell/ArrivalVeil.jsx';
import { WebSocketService } from '../../frontend/services/WebSocketService.js';
import { getWalletService } from '../../frontend/services/WalletGate.js';
import {
  createEmbeddedWallet, getEmbeddedProvider, getStoredAddress, unlockEmbeddedWallet,
} from '../../frontend/services/EmbeddedWallet.js';
import { disconnectSession } from '../../frontend/services/session.js';
import '../../frontend/styles/tokens.css';

const root = createRoot(document.getElementById('root'));
const wsService = new WebSocketService();
let mount = 0;
const showArrival = () => root.render(<ArrivalVeil key={++mount} wsService={wsService} />);

window.arrivalProof = {
  async connect(password) {
    if (getStoredAddress()) await unlockEmbeddedWallet(null, password);
    else await createEmbeddedWallet(password);
    const wallet = getWalletService();
    wallet.setProvider(getEmbeddedProvider());
    await wallet.connect();
    await wallet.authenticate();
    showArrival();
    return wallet.getAddress();
  },
  remount: showArrival,
  disconnect: disconnectSession,
};
