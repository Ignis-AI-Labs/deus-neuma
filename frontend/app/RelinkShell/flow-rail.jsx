// flow-rail.jsx — the desk's flow rail (#185): a hairline under the status
// strip. Packets travel it ONLY when real portal events move — the witness's
// thought out (left→right), a stream chunk in (right→left), a tool act
// flashing the mid-rail junction. No idle pulsing: at rest the rail is a
// bare 1px line. Packets reap themselves on animationend; the list is capped
// (desk-pulse.js), so a long turn's many chunks never pile up. Pure render
// of the pulse state the desk's hook owns.

import './desk-flow.css';

export const FlowRail = ({ packets, onReap }) => (
  <div className="desk-flow" aria-hidden="true">
    {packets.map((p) =>
      p.kind === 'tool' ? (
        <span key={p.id} className="desk-flow-junction" onAnimationEnd={() => onReap(p.id)} />
      ) : (
        <span key={p.id} className={`desk-flow-packet is-${p.kind}`} onAnimationEnd={() => onReap(p.id)} />
      ),
    )}
  </div>
);
