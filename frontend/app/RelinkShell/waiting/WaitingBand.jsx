// WaitingBand — the head of a platform window when this platform's decisions
// wait on the operator (#585, Design note, 2026-10-24, option a): ABOVE the console
// head, so a short window still shows them on arrival without a scroll. Each
// row says what, who asks and how long; APPROVE where the yes is one press
// with nothing hidden (bandMayApprove — the copy shown whole, no card of
// choices, no unseen image, no thread riding along), OPEN everywhere, which
// lands on the card itself (a TikTok post's choices live on its card).
//
// It reads the desk's one account (use-waiting.js), so it can never disagree
// with the tray's count. Calm (calm-gate.js): a new account offered while
// the person works this window waits until they leave it; the account that
// follows their own act (APPROVE here, a decision on the board below) lands
// at once.

import { useEffect, useRef, useState } from 'react';
import { uiSound } from '../../../services/ui-sound.js';
import { approveQueuePost } from '../../../services/social-channels-client.js';
import { useWaitingAccount } from './use-waiting.js';
import { requestWaitingJump } from './waiting-jump.js';
import { KIND_LABEL, bandMayApprove, bandRows, ofPlatform, waitedLabel, whoLabel } from './waiting-view.js';
import './Waiting.css';

// impure — the same yes the card's own APPROVE gives (QueueEntry.jsx): a reply
// IS its send, carrying the copy shown; its failed send is said here.
const approve = async (item) => {
  if (item.kind !== 'reply') return approveQueuePost(item.where.entryId);
  const res = await approveQueuePost(item.where.entryId, { textSeen: item.text });
  if (res?.outcome && !res.outcome.ok) throw new Error(res.outcome.detail || 'the send did not land');
  return res;
};

// How long after the person's own act the next account counts as its answer.
const OWN_ACT_MS = 4000;

/**
 * @param {{channelId: string, calm: {offer: Function, now: Function}, now: number,
 *   ownAct?: number, onDecided?: () => void, keep?: ?((item: object) => boolean)}} props
 *   ownAct — bumped by the window when the person decided something on its board
 *   keep — narrows the platform's rows further (MARKETING's account level: that account's posts only)
 */
export const WaitingBand = ({ channelId, calm, now, ownAct = 0, onDecided, keep = null }) => {
  const waiting = useWaitingAccount();
  const [shown, setShown] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const ownUntil = useRef(0);
  useEffect(() => { if (ownAct) ownUntil.current = Date.now() + OWN_ACT_MS; }, [ownAct]);
  const live = waiting?.account ? ofPlatform(waiting.account.items, channelId).filter((item) => !keep || keep(item)) : null;
  // Read through its key: a new array holding the same items is no news.
  const liveKey = live ? JSON.stringify(live) : null;
  const latest = useRef(live);
  latest.current = live;
  useEffect(() => {
    const items = latest.current;
    if (!items) return;
    const apply = () => setShown(items);
    if (Date.now() < ownUntil.current) calm.now('waiting', apply); else calm.offer('waiting', apply);
  }, [liveKey, calm]);

  if (!shown?.length) return null;
  const { shown: rows, more } = bandRows(shown);

  const decide = async (item) => {
    uiSound('activate');
    setBusy(item.id);
    setError(null);
    try {
      await approve(item);
    } catch (e) {
      setError(e.message);
    }
    ownUntil.current = Date.now() + OWN_ACT_MS;
    await Promise.all([waiting.refresh(), onDecided?.()]).catch(() => {});
    setBusy(null);
  };
  const open = (item) => { uiSound('open'); requestWaitingJump(item); };

  return (
    <section className="waiting-band" aria-label="decisions waiting on you on this platform">
      {/* The count said once (show-dont-tell finding 10); what it means rides the hover. */}
      <header className="waiting-band-h" title="the house needs your decision">
        <span className="waiting-chip-mark" aria-hidden="true" />
        <b>{shown.length}</b> WAITING ON YOU
      </header>
      <ul className="waiting-band-rows">
        {rows.map((item) => (
          <li key={item.id} className="waiting-band-row">
            <span className="waiting-row-kind">{KIND_LABEL[item.kind] || 'DECISION'}</span>
            <span className="waiting-band-text" data-own-words={item.text ? '' : undefined}>{item.text || item.title}</span>
            <span className="waiting-row-meta">{whoLabel(item)} · {waitedLabel(item.at, now)}</span>
            <span className="waiting-band-acts">
              {bandMayApprove(item) ? (
                <button type="button" className="waiting-band-go" disabled={Boolean(busy)} onClick={() => decide(item)}>
                  {busy === item.id ? 'APPROVING…' : item.kind === 'reply' ? 'APPROVE & SEND' : 'APPROVE'}
                </button>
              ) : null}
              <button type="button" className="waiting-band-open" onClick={() => open(item)}>OPEN</button>
            </span>
          </li>
        ))}
      </ul>
      {more ? (
        <button type="button" className="waiting-band-more" onClick={() => open(shown[rows.length])}>
          +{more} MORE — OPEN THE NEXT
        </button>
      ) : null}
      {error ? <p className="waiting-band-err" role="alert">{error}</p> : null}
    </section>
  );
};
