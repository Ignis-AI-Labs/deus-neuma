// AccountMark — who an account is, by sight (show-dont-tell audit, pattern 2):
// its platform's own mark and its handle (else its number on the platform),
// with its company, platform and id on hover — one mark wherever the desk
// names an account, in place of a sentence or a printed code. An account
// under no company yet stands in the warning register: it waits on the
// operator. `note` adds a fact to the hover (a campaign sub's staging).
//
// ONE MARK, ONE MEANING (slice 6): on the desk the mark is the door to its
// account — MARKETING's account level for a public platform, the platform's
// own window for COMMUNITY's. Off the desk it is only the mark.

import { uiSound } from '../../../services/ui-sound.js';
import { useWindows } from '../../windowing/use-windows.js';
import { isMarketingPlatform } from '../../windowing/retired-windows.js';
import { openDoor } from '../doors/open-door.js';
import { useHouseAccounts } from './use-house-accounts.js';
import { accountMarkWords, entryAccountId } from './account-words.js';
import { BrandMark } from '../brand-marks.jsx';
import './account-mark.css';

// pure — where the mark opens: the account level, else the platform's own window when the desk has one.
const doorOf = (channelId, accountId, registry) => {
  if (isMarketingPlatform(channelId)) return { kind: 'account', channelId, accountId };
  return registry && Object.hasOwn(registry, channelId) ? { kind: 'app', app: channelId } : null;
};

/**
 * @param {{entry?: object, accountId?: string, note?: string, handle?: ?string, door?: boolean}} props
 *   a queue entry, or an account id; `handle` — the account's handle as the caller already knows it;
 *   `door` false where the mark stands on its own account's level (a door onto where you are is none)
 */
export const AccountMark = ({ entry, accountId, note, handle = null, door: isDoor = true }) => {
  const { accounts, companies } = useHouseAccounts();
  const windows = useWindows();
  const id = entry ? entryAccountId(entry) : accountId;
  const w = accountMarkWords({ accountId: id, channelId: entry?.channelId, postedAs: entry?.postedAs?.username || handle || undefined }, accounts, companies);
  const title = note ? `${w.title} · ${note}` : w.title;
  const door = isDoor && windows?.dispatch ? doorOf(w.channelId, id, windows.registry) : null;
  const cls = `acm${w.unsorted ? ' is-unsorted' : ''}`;
  const inner = (
    <>
      <BrandMark id={w.channelId} />
      <span className="acm-name">{w.text}</span>
    </>
  );
  if (!door) return <span className={cls} data-account-mark={id} title={title}>{inner}</span>;
  return (
    <button type="button" className={`${cls} is-door`} data-account-mark={id} title={`${title} · open the account`}
      onClick={(e) => { e.stopPropagation(); uiSound('open'); openDoor(door, windows); }}>
      {inner}
    </button>
  );
};
