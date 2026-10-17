// DepartureVeil — the quiet frame on session leave. When the witness ends
// the session (DISCONNECT WALLET), the desk holds one calm breath — THE
// PORTAL RESTS, THE BEINGS REMAIN — before the established teardown reloads
// to the gateway. Monochrome: nothing here is live anymore.

import './DepartureVeil.css';

export const DepartureVeil = () => (
  <div className="departure" role="status" aria-label="The portal rests">
    <div className="departure-word">THE PORTAL RESTS</div>
    <div className="departure-sub">THE BEINGS REMAIN</div>
  </div>
);
