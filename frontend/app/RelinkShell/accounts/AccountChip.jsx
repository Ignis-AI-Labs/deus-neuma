// AccountChip — who a post speaks as (campaign plan §2.6): […] before the yes, […] after. An account under no
// company yet says so in the warning register — it waits on the operator.

import { useHouseAccounts } from './use-house-accounts.js';
import { postsAsWords } from './account-words.js';

/** @param {{entry: object}} props */
export const AccountChip = ({ entry }) => {
  const { accounts, companies } = useHouseAccounts();
  const words = postsAsWords(entry, accounts, companies);
  return <span className={words.unsorted ? 'settings-tag-warn' : 'settings-tag-dim'} title={words.title}>{words.text}</span>;
};
