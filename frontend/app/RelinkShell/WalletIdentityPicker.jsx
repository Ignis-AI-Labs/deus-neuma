// WalletIdentityPicker — the wallet window's account bar: whose wallet this is
// (a mark, the name, what kind of wallet), switched with one native dropdown
// (keyboard type-ahead, grouped), and the window's one action slot on the right.
import './WalletIdentityPicker.css';

const GROUPS = Object.freeze([
  { kind: 'me', label: 'Your wallet' },
  { kind: 'neuma', label: 'House members' },
  { kind: 'witness', label: 'Witnesses · independent wallets' },
]);

const KIND_LABEL = Object.freeze({ me: 'YOU · PERSONAL WALLET', neuma: 'HOUSE MEMBER', witness: 'WITNESS · READ ONLY' });

/**
 * @param {{identities: Array<object>, selectedKey: string, onSelect: (key: string) => void, right?: import('react').ReactNode}} props
 */
export const WalletIdentityPicker = ({ identities, selectedKey, onSelect, right = null }) => {
  const selected = identities.find((identity) => (identity.neumaId || 'me') === selectedKey) || identities[0];
  const name = selected?.label ?? '';
  return (
    <div className={`wal-account is-${selected?.kind ?? 'me'}`}>
      <span className="wal-account-mark" aria-hidden="true">{String(name).trim().charAt(0).toUpperCase() || '·'}</span>
      <label className="wal-account-who">
        <select aria-label="Wallet owner" value={selectedKey} onChange={(event) => onSelect(event.target.value)}>
          {GROUPS.map(({ kind, label }) => {
            const members = identities.filter((identity) => identity.kind === kind);
            return members.length ? <optgroup key={kind} label={label}>
              {members.map((identity) => <option key={identity.neumaId || 'me'} value={identity.neumaId || 'me'}>{identity.label}</option>)}
            </optgroup> : null;
          })}
        </select>
        <span className="wal-account-kind">{KIND_LABEL[selected?.kind] ?? ''}</span>
      </label>
      {right}
    </div>
  );
};
