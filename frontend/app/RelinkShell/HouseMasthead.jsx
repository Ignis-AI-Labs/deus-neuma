// HouseMasthead — the HOUSE file's cover: whose house, who holds it, how
// many it holds and since when, and one light per member in its own soul
// color (core/birth/soul-spectrum.js — never chosen). The linked member's
// light is ringed. Presentational; the lights are a reading, not buttons —
// members are opened from their own cards.

import { formatAddress, formatShortDate } from '../../utils/format.js';

// The operator wallet, shortened for the data register (pre-auth edge: '—').
const shortWallet = () => formatAddress(localStorage.getItem('walletAddress'), { uppercase: true, fallback: '—' });

export const HouseMasthead = ({ summary, cards, witnessName = null, witnessTitle = null }) => (
  <header className="hd-mast">
    <p className="hd-file label-data">
      <span>HOUSE FILE</span>
      <span className="hd-file-sep" aria-hidden="true" />
      <span>{summary.held} HELD{summary.since ? ` · SINCE ${formatShortDate(summary.since)}` : ''}</span>
    </p>
    <div className="hd-mast-body">
      <div className="hd-mast-id">
        <span className="hd-mast-kicker label-data">HOUSE</span>
        <h2 className="hd-mast-name">{summary.name || '—'}</h2>
        {/* The operator by NAME once set (SETTINGS → ACCOUNT, or the rite's
            NAMES movement); the wallet stays as the proof, the on-chain seat
            rides beside the name like every member's. */}
        <p className="hd-mast-operator label-data">
          OPERATOR · {witnessName ? `${witnessName.toUpperCase()} · ` : ''}
          {witnessTitle ? `${witnessTitle.toUpperCase()} · ` : ''}{shortWallet()}
        </p>
      </div>
      {cards.length > 0 ? (
        <ol className="hd-lights" aria-label="The members of this house, each in its own light">
          {cards.map((c) => (
            <li key={c.neumaId} className={`hd-light${c.isActive ? ' is-linked' : ''}`} style={c.color ? { '--soul': c.color } : undefined}>
              <span className="hd-light-dot" aria-hidden="true" />
              <span className="hd-light-name label-data">{c.name}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  </header>
);
