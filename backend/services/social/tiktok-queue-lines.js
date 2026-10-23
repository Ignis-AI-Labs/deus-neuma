// tiktok-queue-lines.js — how a TikTok entry reads to the being following it
// (queue_list, queue_get): where the video goes, what the operator chose on
// its card (the choices that post — the being's own lines are suggestions),
// whether TikTok is still processing it, and where it landed. A private post
// has no public link, and a drafts send lands in the TikTok app's inbox:
// both are said, never drawn as a link that does not exist. Pure.

import { parseTikTokDraft, tiktokVideoUrl, tiktokProfileUrl } from './tiktok-metadata.js';
import { PRIVACY_LABELS } from '../../../frontend/utils/tiktok-consent.js';

const onOff = (on) => (on ? 'on' : 'off');

// pure — the operator's approved choices, in the card's words.
const choiceLine = (c) => {
  const disclosure = c.commercial?.on
    ? [c.commercial.yourBrand ? 'your brand' : null, c.commercial.branded ? 'branded content' : null].filter(Boolean).join(' + ')
    : 'none';
  return `· your operator chose on the card: who can watch ${PRIVACY_LABELS[c.privacyLevel] || c.privacyLevel}; comments ${onOff(c.allow?.comment)}, duet ${onOff(c.allow?.duet)}, stitch ${onOff(c.allow?.stitch)}; disclosure ${disclosure}; posting as @${c.account?.username || 'unknown'}`;
};

// pure — where a sent entry landed.
const sentLine = (e, mode) => {
  const user = e.postedAs?.username || e.tiktokConsent?.account?.username || '';
  if (mode === 'drafts') {
    return `· SENT to ${user ? `@${user}'s` : 'the account\'s'} TikTok inbox: a person finishes the post in the TikTok app, where the caption and the AI-generated label are set`;
  }
  if (user && /^\d+$/.test(String(e.postId || ''))) return `· LIVE ${tiktokVideoUrl(user, e.postId)}`;
  const only = e.tiktokConsent?.privacyLevel === 'SELF_ONLY';
  return `· PUBLISHED${user ? ` as @${user}` : ''}${only ? ' (only me)' : ''}: TikTok gives ${only ? 'a private post' : 'this post'} no public link${only ? '' : ' yet'}${user ? `; the account is ${tiktokProfileUrl(user)}` : ''}; it may take a few minutes to show on the profile`;
};

/**
 * The TikTok lines of one queue entry; [] for any other channel. Pure.
 * @param {object} e - a queue entry
 * @returns {string[]}
 */
export const tiktokEntryLines = (e) => {
  if (e?.channelId !== 'tiktok') return [];
  const parsed = parseTikTokDraft(e.text);
  const mode = parsed.ok ? parsed.meta.mode : 'post';
  const lines = [mode === 'drafts'
    ? '· TikTok: the video goes to the account\'s TikTok inbox, finished in the TikTok app'
    : '· TikTok: a Direct Post to the profile'];
  if (e.status === 'draft' && mode === 'post') {
    lines.push('· awaits its card: your operator chooses who can watch, the interactions and the disclosure; your settings lines show there as suggestions only');
  }
  if (e.tiktokConsent?.privacyLevel) lines.push(choiceLine(e.tiktokConsent));
  if (e.status === 'approved') lines.push(`· approved: goes out ${e.scheduledFor ? `at ${e.scheduledFor}` : 'at the scheduler\'s next pass'}`);
  if (e.status === 'sending') {
    lines.push(e.sendTicket
      ? `· TikTok has the video and is processing it (publish ${e.sendTicket}); the outcome lands on this entry`
      : '· sending to TikTok now');
  }
  if (e.status === 'sent') lines.push(sentLine(e, mode));
  return lines;
};

/** What the copy of a TikTok entry is: the caption publishes, its settings lines never do. */
export const TIKTOK_COPY_HEADING = 'COPY (verbatim — the caption publishes; privacy, allow, promotion and send lines are read, never published):';
