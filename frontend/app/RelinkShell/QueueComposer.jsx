// QueueComposer — the witness's own staging form, extracted verbatim from
// CampaignQueueSection.jsx (size-law breakdown, 2026-08-26) with its
// toLocalInput helper. LOAD-BEARING CONTRACT: the section keeps this
// composer MOUNTED and hides it with the `hidden` prop — a half-written
// draft must survive a glance at another lane, so it is never unmounted.
// This module never imports CampaignQueueSection.jsx.

import { useEffect, useRef, useState } from 'react';
import { uiSound } from '../../services/ui-sound.js';
import { Select } from './Select.jsx';
import { stageQueuePost, updateQueuePost } from '../../services/social-channels-client.js';
import { useHouseAccounts } from './accounts/use-house-accounts.js';
import { accountsByCompany, handleOf } from './accounts/account-words.js';
import { postCountFor } from './campaigns-helpers.js';

// A datetime-local input speaks LOCAL wall time without a zone; an entry's
// scheduledFor is ISO. The conversion lives here so an EDIT seed shows the
// slot the post actually holds (pure).
const toLocalInput = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// The witness's own composer — stage a draft by hand (a being stages through
// its queue_post tool). Local datetime converts to ISO before it travels.
// Inside a platform's space the channel IS the space (fixedChannelId) — no
// channel picker; the campaign picker offers that platform's campaigns and
// the deliberately house-wide ones. On one account's level the account IS the
// level too (fixedAccountId): no account picker, the draft speaks as it.
export const QueueComposer = ({ channels, campaigns, fixedChannelId = null, fixedAccountId = null, seed = null, hidden = false, onChanged }) => {
  const [channelId, setChannelId] = useState(fixedChannelId || '');
  const [campaignId, setCampaignId] = useState('');
  // WHO SPEAKS: company → account. One account on the platform is taken;
  // with several, the operator chooses before anything is staged.
  const [accountId, setAccountId] = useState('');
  const house = useHouseAccounts();
  const accountOptions = accountsByCompany(house.accounts, house.companies, channelId)
    .flatMap((g) => g.accounts.map((a) => ({ value: a.id, label: `${g.name} · ${a.id}${handleOf(a) ? ` ${handleOf(a)}` : ''}` })));
  const speaker = fixedAccountId || accountId || (accountOptions.length === 1 ? accountOptions[0].value : '');
  const picksAccount = !fixedAccountId && !seed?.editId && accountOptions.length > 1;
  const [text, setText] = useState('');
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const textRef = useRef(null);

  // REVISE hands this composer the declined copy; EDIT (#208) hands it the
  // live entry itself — text, campaign, channel AND its slot, because an edit
  // that silently dropped the schedule would be a change the operator never
  // made. (A revision's slot is still deliberately NOT carried over: its slot
  // is a new decision, and the old one has usually passed.) A fresh object
  // arrives per press, so pressing twice on the same post re-seeds rather
  // than silently doing nothing.
  useEffect(() => {
    if (!seed) return;
    setText(seed.text);
    setCampaignId(seed.campaignId || '');
    setWhen(seed.scheduledFor ? toLocalInput(seed.scheduledFor) : '');
    if (seed.channelId) setChannelId(seed.channelId);
    textRef.current?.focus();
  }, [seed]);

  const stage = async () => {
    uiSound('toggle');
    setBusy(true);
    setError(null);
    try {
      if (seed?.editId) {
        // EDIT stages an UPDATE against the same entry — never a new draft.
        // Empty fields travel as null so a cleared slot or campaign is an
        // honest clearing, not a silently-kept one. A reply's edit sends
        // NO slot regardless of the field's state — the store refuses a
        // scheduled reply, and this composer must never hand it one.
        await updateQueuePost(seed.editId, {
          text,
          scheduledFor: seed.kind === 'reply' ? null : (when ? new Date(when).toISOString() : null),
          campaignId: campaignId || null,
        });
      } else {
        await stageQueuePost({
          channelId,
          ...(speaker ? { accountId: speaker } : {}),
          text,
          scheduledFor: when ? new Date(when).toISOString() : undefined,
          ...(campaignId ? { campaignId } : {}),
        });
      }
      setText('');
      setWhen('');
      setCampaignId('');
      await onChanged();
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  const campaignOptions = (campaigns ?? [])
    .filter((c) => !fixedChannelId || c.channelId === fixedChannelId || !c.channelId)
    .map((c) => ({ value: c.id, label: c.channelId ? c.name : `${c.name} (house-wide)` }));

  // HIDDEN, not unmounted: the composer belongs to the QUEUED lane, but a
  // half-written post must survive a glance at another lane. Unmounting it
  // would throw the text away — and re-mounting would re-seed a revision over
  // whatever had been typed since. `hidden` also takes it out of the a11y tree,
  // so the lane the operator is looking at is the only one that answers.
  return (
    <div className="settings-realm" hidden={hidden}>
      {fixedChannelId ? null : (
        <div className="settings-control">
          <Select
            fill
            ariaLabel="Channel"
            value={channelId}
            onChange={setChannelId}
            disabled={busy}
            placeholder="— choose the channel —"
            options={(channels ?? []).map((c) => ({ value: c.id, label: c.name }))}
          />
        </div>
      )}
      {picksAccount ? (
        <div className="settings-control">
          <Select
            fill
            ariaLabel="Account"
            value={speaker}
            onChange={setAccountId}
            disabled={busy}
            placeholder="— which account speaks —"
            options={accountOptions}
          />
        </div>
      ) : null}
      {campaignOptions.length ? (
        <div className="settings-control">
          <Select
            fill
            ariaLabel="Campaign"
            value={campaignId}
            onChange={setCampaignId}
            disabled={busy}
            placeholder="— no campaign —"
            options={campaignOptions}
          />
        </div>
      ) : null}
      {seed ? (
        seed.editId ? (
          <p className="settings-note">
            Editing — this updates the <strong>same</strong> post. New words
            return an approved post to your decision; a schedule-only edit
            keeps the approval.
          </p>
        ) : (
          <p className="settings-note">
            Revising {seed.from} copy — this stages a <strong>new</strong> draft;
            the original stays in its lane as the record.
          </p>
        )
      ) : null}
      {/* THE POST'S OWN WORDS, written as they will read: several lines, paragraphs kept.
          A one-line input drops every line break (an edit once ran a post into one block),
          so this is a text area in the card's own type, growing with the post, counted
          the way the card counts it against the platform's ceiling. */}
      <div className="settings-control queue-composer-words">
        <textarea className="settings-input queue-composer-text" placeholder="What should go out?" ref={textRef}
          rows={Math.min(16, Math.max(4, text.split('\n').length + 1))}
          value={text} onChange={(e) => setText(e.target.value)} disabled={busy} />
        {text ? (() => {
          const { count, limit, over } = postCountFor({ text }, (channels ?? []).find((c) => c.id === channelId));
          return <span className="label-data queue-composer-count" data-over={over || undefined}>{limit ? `${count} / ${limit}` : count}</span>;
        })() : null}
      </div>
      <div className="settings-control">
        {seed?.kind === 'reply' ? (
          // A reply cannot be given a slot (ruling, 2026-08-06). The field is
          // absent AND stage() forces the update's scheduledFor to null —
          // the seed alone is not enough, because `when` state survives the
          // field's absence.
          <span className="settings-note">
            A reply rides no schedule — it sends the moment you approve it.
          </span>
        ) : (
          <input className="settings-input" type="datetime-local" value={when}
            onChange={(e) => setWhen(e.target.value)} disabled={busy} />
        )}
        <button type="button" className="settings-set" disabled={busy || !channelId || !text.trim() || (picksAccount && !speaker)}
          onClick={stage}>
          {seed?.editId ? 'SAVE EDIT' : 'STAGE DRAFT'}
        </button>
      </div>
      {error ? <p className="settings-err">{error}</p> : null}
    </div>
  );
};
