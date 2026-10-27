// PlatformRow — every platform, always in view under MARKETING's tabs
// (platform-row.js): its own logo and one mark for how its accounts at this
// level stand; its name, its standing and its count on hover and to a screen
// reader — the logo says which (SHOW, DON'T
// TELL), so the row costs the tab no words. A press opens it.
//
// LockedKeys — the house's keys file can't be opened: said once, plainly,
// with UNLOCK (the key it was sealed with) and the door to its Channel keys,
// at every level of the window.

import { BrandMark } from '../brand-marks.jsx';
import { DoorButton } from '../doors/DoorButton.jsx';
import { UnlockKeys } from '../accounts/UnlockKeys.jsx';
import { ROW_MARK } from './platform-row.js';

/**
 * @param {{row: ReadonlyArray<object>, onOpen: (account: {channelId: string, accountId: ?string}) => void}} props
 */
export const PlatformRow = ({ row, onOpen }) => (
  <nav className="mkt-platforms" aria-label="Platforms" data-mkt-platforms>
    {row.map((p) => (
      <button key={p.channelId} type="button" className={`mkt-platform is-${p.state}`} data-platform={p.channelId} data-platform-state={p.state}
        title={p.title} aria-label={p.title} onClick={() => onOpen({ channelId: p.channelId, accountId: p.accountId })}>
        <BrandMark id={p.channelId} />
        <i className="mkt-platform-mark" aria-hidden="true">{ROW_MARK[p.state].glyph}</i>
      </button>
    ))}
  </nav>
);

/** @param {{locked: {why: string}, onUnlocked?: () => void}} props */
export const LockedKeys = ({ locked, onUnlocked }) => (
  <p className="mkt-locked" role="alert" data-mkt-locked title={`${locked.why}. Every platform stays here; posts hold until the file opens.`}>
    <i aria-hidden="true">▲</i>
    <span>KEYS LOCKED</span>
    <UnlockKeys onUnlocked={onUnlocked} />
    <DoorButton door={{ kind: 'keys' }} label="CHANNEL KEYS" />
  </p>
);
