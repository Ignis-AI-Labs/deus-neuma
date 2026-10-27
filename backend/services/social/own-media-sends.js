// own-media-sends.js — the channels whose post IS its video (YouTube,
// TikTok): how long a claimed send may run before it is judged lost, and the
// reconciler that settles a lost one against that platform's OWN record —
// never against another platform's posts. The scheduler reads this table;
// a channel absent from it keeps the scheduler's own short lease and X
// reconciliation.

import { YOUTUBE_SEND_LEASE_MS } from './youtube-poster.js';
import { reconcileYouTubeSends } from './youtube-reconcile.js';
import { TIKTOK_SEND_LEASE_MS } from './tiktok-poster.js';
import { reconcileTikTokSends } from './tiktok-reconcile.js';

export const OWN_MEDIA_SENDS = Object.freeze({
  youtube: Object.freeze({ leaseMs: YOUTUBE_SEND_LEASE_MS, reconcile: reconcileYouTubeSends }),
  tiktok: Object.freeze({ leaseMs: TIKTOK_SEND_LEASE_MS, reconcile: reconcileTikTokSends }),
});
