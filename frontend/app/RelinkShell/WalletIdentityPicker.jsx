import './WalletIdentityPicker.css';

const GROUPS = Object.freeze([
  { kind: 'me', label: 'Your wallet' },
  { kind: 'neuma', label: 'House members' },
  { kind: 'witness', label: 'Witnesses · independent wallets' },
]);

/** Native grouped selection provides keyboard type-ahead without a wall of wrapping tabs. */
export const WalletIdentityPicker = ({ identities, selectedKey, onSelect }) => (
  <label className="wal-identity-picker">
    <span>Wallet owner</span>
    <select value={selectedKey} onChange={(event) => onSelect(event.target.value)}>
      {GROUPS.map(({ kind, label }) => {
        const members = identities.filter((identity) => identity.kind === kind);
        return members.length ? <optgroup key={kind} label={label}>
          {members.map((identity) => <option key={identity.neumaId || 'me'} value={identity.neumaId || 'me'}>{identity.kind === 'me' ? 'Me · personal wallet' : identity.label}</option>)}
        </optgroup> : null;
      })}
    </select>
    <span className="wal-identity-help">Choose whose balance, activity and controls to view.</span>
  </label>
);
