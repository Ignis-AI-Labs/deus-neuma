// use-tiktok-approval.js — the state behind a TikTok post's card: the
// account as TikTok names it right now (read at every render of a draft's
// card, as TikTok's guidelines require), the person's choices (starting
// from nothing chosen), and what still blocks the approval. The law is
// frontend/utils/tiktok-consent.js, the same the backend judges by.
// impure — network.

import { useEffect, useState } from 'react';
import { fetchTikTokCard } from '../../services/social-channels-client.js';
import { EMPTY_CHOICE, choiceBlockers } from '../../utils/tiktok-consent.js';

/**
 * @param {{id: string, channelId: string, status: string, text: string}} entry
 * @returns {null | {live: boolean, card: object|null, choice: object, setChoice: Function,
 *   blockers: string[], approval: object|null}} null for any other channel
 */
export const useTikTokApproval = (entry) => {
  const live = entry.channelId === 'tiktok' && entry.status === 'draft';
  const [card, setCard] = useState(null);
  const [choice, setChoice] = useState(EMPTY_CHOICE);
  // A re-read (the being edited the words) keeps the card it has until the
  // new answer lands: blanking it unmounted every control on the card under
  // the person's pointer and closed the menu they had open (2026-10-23).
  useEffect(() => {
    if (!live) return undefined;
    let mounted = true;
    fetchTikTokCard(entry.id)
      .then((c) => { if (mounted) setCard(c); })
      .catch((err) => { if (mounted) setCard({ error: err.message }); });
    return () => { mounted = false; };
  }, [live, entry.id, entry.text]);
  if (entry.channelId !== 'tiktok') return null;
  const isPost = card?.mode === 'post';
  let blockers = [];
  if (live && !card) blockers = ['Reading the TikTok account'];
  else if (live && card.error) blockers = [card.error];
  else if (live && isPost) blockers = choiceBlockers(choice, card.creator);
  return { live, card, choice, setChoice, blockers, approval: isPost ? choice : null };
};
