// WalletAddressList — a house member's wallets as a short list of addresses,
// picked like accounts in any wallet app (Design note, 2026-11-13: MAIN, its first
// wallet, and LIQUIDITY, the one used only on Umbrae. Each row carries its
// address and its balance, so the choice shows what is where before it is made.

import { formatAddress } from '../../utils/format.js';
import { uiSound } from '../../services/ui-sound.js';

/**
 * @param {{rows: Array<{id: string, label: string, address: string|null, figure: string, flag?: number}>,
 *   selected: string, onSelect: (id: string) => void}} props
 */
export const WalletAddressList = ({ rows, selected, onSelect }) => (
  <div className="wal-addrs" role="radiogroup" aria-label="Wallets">
    {rows.map((row) => (
      <button key={row.id} type="button" role="radio" aria-checked={selected === row.id}
        className={`wal-addr${selected === row.id ? ' is-on' : ''}`}
        onClick={() => { if (selected !== row.id) { uiSound('tick'); onSelect(row.id); } }}>
        <span className="wal-addr-pick" aria-hidden="true" />
        <span className="wal-addr-who">
          <span className="wal-addr-k">{row.label}{row.flag ? <span className="wal-addr-flag">{row.flag} WAITING</span> : null}</span>
          <span className="wal-addr-a">{row.address ? formatAddress(row.address, { start: 6, end: 4 }) : 'not opened yet'}</span>
        </span>
        <span className="wal-addr-v">{row.figure}</span>
      </button>
    ))}
  </div>
);
