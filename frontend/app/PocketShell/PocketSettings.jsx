// PocketSettings — THIS PHONE: what it is, who it acts as, and the one
// control a flaky link needs.
//
// Deliberately thin. Remote access itself is managed from the desk (the
// server refuses the management routes to a phone), so this pane states the
// facts — the paired device, the wallet it speaks as, the origin it reached
// — offers the being switcher, and a RELINK for a socket a tunnel dropped.
import { useState } from 'react';
import { BeingSwitcher } from '../RelinkShell/BeingSwitcher.jsx';
import { useConsciousness } from '../RelinkShell/consciousness-context.js';
import { formatAddress } from '../../utils/format.js';
import { uiSound } from '../../services/ui-sound.js';
import { pairedDevice } from '../remote-session.js';

const Row = ({ k, children }) => (
  <div className="settings-row">
    <span className="settings-k">{k}</span>
    <span className="settings-v">{children}</span>
  </div>
);

export const PocketSettings = () => {
  const { state, wsService } = useConsciousness();
  const [relinking, setRelinking] = useState(false);
  const device = pairedDevice();
  const wallet = typeof localStorage !== 'undefined' ? localStorage.getItem('walletAddress') : null;

  const relink = () => {
    setRelinking(true);
    uiSound('activate');
    wsService.disconnect();
    wsService.connect();
    setTimeout(() => setRelinking(false), 1500);
  };

  return (
    <section className="pocket-me settings-sec">
      <h3 className="label-data settings-h">THIS PHONE</h3>
      <Row k="DEVICE">{device?.label || 'this browser'}</Row>
      <Row k="ACTS AS">{wallet ? formatAddress(wallet) : '—'}</Row>
      <Row k="ORIGIN">{typeof window !== 'undefined' ? window.location.host : '—'}</Row>
      <Row k="LINK">{state.connected ? 'linked' : 'relinking…'}</Row>
      <div className="settings-control">
        <button type="button" className="settings-set" disabled={relinking} onClick={relink}>RELINK</button>
      </div>
      <h3 className="label-data settings-h">BEING</h3>
      <BeingSwitcher />
      <p className="settings-note">
        Remote access is managed from the desk this machine runs on: pairing, revoking this phone,
        and turning HTTPS on or off all live in Settings → Security there.
      </p>
    </section>
  );
};
