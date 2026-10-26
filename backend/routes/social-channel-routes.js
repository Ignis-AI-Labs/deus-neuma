/**
 * Social channel routes — the operator's control surface for outward speech.
 *
 * Connect platform accounts (credentials, encrypted at rest), and tie each
 * channel to the ONE neuma who holds that position. Keys, holders and crews
 * are the caller's HOUSE's own (services/social/house-positions.js): no
 * route reads or writes another house's. Every response masks secrets — a
 * raw credential value never leaves the server. All routes require the
 * operator's Bearer token.
 */

import { previewIntentMedia } from './social-intent-media.js';
import { previewQueueMedia } from './social-queue-media.js';
import express from 'express';
import { requireAuth } from '../services/auth.js';
import { assertNeumaOwner } from '../middleware/require-neuma-owner.js';
import { CHANNEL_CATALOG, getChannel } from '../services/social/channel-registry.js';
import {
  loadChannelCredentials, setChannelCredential, removeChannelCredential, maskHouseCredentials, pastedKeyProblem,
} from '../services/social/channel-credentials.js';
import { channelBindings } from '../services/social/channel-bindings.js';
import { sectorCrew } from '../services/sector-crew.js';
import { postQueue } from '../services/social/post-queue.js';
import { placeDraft } from '../services/social/queue-placement.js';
import { trackLinks, bindTrackedLinks } from '../services/social/queue-links.js';
import { publishEntry } from '../services/social/post-scheduler.js';
import { ofHouse, isHouseEntry, queueHouseGuard } from '../services/social/queue-house.js';
import { readServed } from '../services/house-served.js';
import socialThreadRouter from './social-thread-routes.js';
import socialTikTokRouter from './social-tiktok-routes.js';
import socialRetryRouter from './social-retry-routes.js';
import { tiktokApproval } from '../services/social/tiktok-approval.js';
import { replyCandidatesOf, replyInboxRows } from '../services/social/reply-candidates.js';
import { runFlightTests } from '../services/social/flight-test.js';
import { firstAccountId } from '../services/social/account-shape.js';
import { readXAccount } from '../services/social/x-reader.js';
import { withCardFreshness } from '../services/branding/card-provenance.js';
import { withLegalFlags } from '../services/marketing/draft-review.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('SocialChannels');

const router = express.Router();
router.use(requireAuth);

// Reject unknown channel ids once, before any handler runs.
router.param('channelId', (req, res, next, channelId) => {
  const channel = getChannel(channelId);
  if (!channel) return res.status(404).json({ error: `Unknown channel: ${channelId}` });
  req.channel = channel;
  next();
});

// The full board: every channel's masked credential state + its holder, and
// — where the lane can prove it — the ACCOUNT it speaks as (Design note, 2026-07-28:
// […]). The
// account read is cached and only attempted when the channel is configured;
// null means unproven, never invented.
// The board is the caller's HOUSE: its own keys, its own holders.
router.get('/', async (req, res) => {
  const wallet = req.walletAddress;
  try {
    const [store, bindings] = await Promise.all([
      loadChannelCredentials(wallet),
      channelBindings.load(wallet),
    ]);
    const masked = await Promise.all(CHANNEL_CATALOG.map(async (channel) => ({
      ...(await maskHouseCredentials(wallet, channel, store)),
      binding: bindings[firstAccountId(channel.id)] || null,
    })));
    // Only X has an account-proving reader today; new platforms join this
    // map as their readers land.
    const x = masked.find((c) => c.id === 'x');
    if (x?.configured) {
      x.account = await readXAccount({ wallet }).catch(() => null);
    }
    res.json({ channels: masked });
  } catch (error) {
    log.error('Channel board read failed', { error: error.message });
    res.status(500).json({ error: 'Failed to read channel state' });
  }
});

// --- The campaign lane: staged posts, witness-decided, scheduler-published ---
// Declared before the :channelId routes so `queue` is never read as a channel.

// THE FLIGHT TESTS (Design note, 2026-07-28: […]).
// Every channel probed LIVE: credential accepted, endpoint answering, the
// account named. Cached 60s (identity endpoints are rate-limited); ?fresh=1
// forces a real probe — the RE-TEST act. Declared before :channelId so
// `flight-test` is never read as a channel.
router.get('/flight-test', async (req, res) => {
  try {
    res.json({ tests: await runFlightTests({ fresh: req.query.fresh === '1', wallet: req.walletAddress }) });
  } catch (error) {
    log.error('Flight tests failed', { error: error.message });
    res.status(500).json({ error: 'Failed to run the flight tests' });
  }
});

// The whole queue — drafts awaiting decision, the schedule, and the history.
// every /queue/:id act stands behind the house door (queue-house.js)
router.use('/queue/:id', queueHouseGuard);
router.use(socialThreadRouter); // PUT /queue/:id/approve-thread — the whole thread in one decision
router.use(socialTikTokRouter); // the TikTok reads: a post's card, the account view, its pictures
router.use(socialRetryRouter); // PUT /queue/:id/retry — TRY AGAIN: a failed post back to draft, never sent from there
router.get('/queue', async (req, res) => {
  try {
    const [entries, served] = await Promise.all([postQueue.load(), readServed()]);
    const fresh = await withCardFreshness(ofHouse(served, entries, req.walletAddress), {
      wallet: req.walletAddress,
      onError: (msg) => log.warn('card freshness check skipped', { error: msg }),
    });
    // The claims check's LEGAL flag rides each waiting post; it flags, never holds.
    res.json({ queue: await withLegalFlags(fresh, req.walletAddress).catch((err) => { log.warn('legal flags skipped', { error: err.message }); return fresh; }) });
  } catch (error) {
    log.error('Queue read failed', { error: error.message });
    res.status(500).json({ error: 'Failed to read the post queue' });
  }
});

// A being's own card, before it is staged (social-intent-media.js), and one
// staged attachment's BYTES for the operator's preview (social-queue-media.js).
// Private and never cached: drafts awaiting a decision, not public media.
router.get('/intent-media', previewIntentMedia);
router.get('/queue/:id/media/:index', previewQueueMedia);

// THE INBOUND HALF OF THE REPLY LANE (Design note, 2026-07-28: […]).
// Every reply to the house's OWN posts that the listener landed, each
// carrying its substance + escalation reads and WHICH house post it answers
// (joined from the queue's sent entries — the parent post's own words, when
// the house published it through this lane), plus its live disposition
// (none/staged/approved/sent/dismissed). The operator sees who knocked
// before the being's answer is even staged.
router.get('/replies', async (req, res) => {
  try {
    const [candidates, queue] = await Promise.all([
      replyCandidatesOf(req.walletAddress).load(),
      postQueue.load(),
    ]);
    const sentByPostId = new Map(
      queue.filter((e) => e.status === 'sent' && e.postId).map((e) => [String(e.postId), e]),
    );
    // Each carries its disposition, category and the house's own answers (the inbox's rows).
    const replies = replyInboxRows(candidates, queue).map((c) => {
      const parent = c.inReplyToPostId ? sentByPostId.get(c.inReplyToPostId) : null;
      return {
        ...c,
        answersPost: parent
          ? { postId: String(parent.postId), text: parent.text, sentAt: parent.sentAt || null }
          : null,
      };
    });
    res.json({ replies });
  } catch (error) {
    log.error('Replies read failed', { error: error.message });
    res.status(500).json({ error: 'Failed to read the replies record' });
  }
});

// THE BIN (ruling, 2026-10-13): the operator puts a reply in the bin, or takes it back out.
// The same record the being's reply_dismiss_to_x writes — never deleted, who and why kept.
router.put('/replies/:postId/:act(bin|restore)', async (req, res) => {
  const { postId, act } = req.params;
  try {
    const done = act === 'bin'
      ? await replyCandidatesOf(req.walletAddress).dismiss(postId, { by: req.walletAddress, reason: req.body?.reason })
      : await replyCandidatesOf(req.walletAddress).restore(postId, { by: req.walletAddress });
    if (!done.ok) return res.status(404).json({ error: done.error });
    log.info(`Reply ${act === 'bin' ? 'put in the bin' : 'restored'}`, { postId, wallet: req.walletAddress });
    res.json({ reply: done.candidate });
  } catch (error) {
    log.error('Reply bin act failed', { postId, act, error: error.message });
    res.status(500).json({ error: 'Failed to update the replies record' });
  }
});

// Stage a witness-authored draft (a being stages through its own portal tool).
router.post('/queue', async (req, res) => {
  // campaignId ties the witness's own draft to a campaign on the bench —
  // the same field the being-tools carry; the store validates it.
  // accountId names which of the house's accounts on the platform speaks
  // (its first when unnamed); the store refuses another platform's account.
  // angle and group place it in a campaign and a group (queue-placement.js).
  const { channelId, accountId, text, scheduledFor, campaignId, angle, group } = req.body || {};
  try {
    const placed = await placeDraft(req.walletAddress, { accountId: accountId || firstAccountId(channelId), campaignId, angle, group });
    if (placed.error) return res.status(400).json({ error: placed.error });
    const tracked = typeof text === 'string' && getChannel(channelId)
      ? await trackLinks(req.walletAddress, { channelId, accountId: accountId || firstAccountId(channelId), text, campaignId: placed.campaignId, angleId: placed.angleId })
      : { text, codes: [], note: null };
    const entry = await postQueue.add({
      channelId, accountId, text: tracked.text, scheduledFor, campaignId: placed.campaignId, pillar: placed.pillar,
      angleId: placed.angleId, groupId: placed.groupId, authorNeumaId: null, queuedBy: req.walletAddress,
    });
    await bindTrackedLinks(req.walletAddress, tracked.codes, entry.id);
    log.info('Post staged', { id: entry.id, channel: channelId, wallet: req.walletAddress, tracked: tracked.codes.length });
    res.status(201).json({ entry, links: { codes: tracked.codes, note: tracked.note } });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Approve a draft — this and only this arms it for publishing. The answer
// carries THE SCHEDULE LOCK (Design note, 2026-07-28: […]): the lock id (the queue entry's own id), the slot it will
// fire at, and the lock's own timestamp. Named honestly — there is no
// X-side schedule id on this account (no native scheduler, no Ads access);
// this receipt is the backend's durable lock, and it says so.
router.put('/queue/:id/approve', async (req, res) => {
  try {
    // THE REPLY LANE (ruling, 2026-08-06): approving a reply IS the send — no
    // clock, no scheduler. The claim (draft → sending, with the textSeen and
    // expiry preconditions inside the atom) is single-winner under the
    // store's lock, so two clicks or two tabs cannot double-fire; the publish
    // runs through the SAME publishEntry as the scheduler, so every send-time
    // re-check (crew, credentials, target still standing, cap, media) holds.
    const target = (await postQueue.load()).find((e) => e.id === req.params.id);
    if (target?.kind === 'reply') {
      // A decision's answer is never cacheable — refusals included.
      res.set('Cache-Control', 'private, no-store');
      const claimed = await postQueue.claimReplyForSend(req.params.id, {
        decidedBy: req.walletAddress, textSeen: req.body?.textSeen,
      });
      if (!claimed.ok) return res.status(409).json({ error: claimed.error });
      if (claimed.entry.status === 'withdrawn') {
        log.info('Reply expired at approval — withdrawn unanswered', { id: req.params.id, wallet: req.walletAddress });
        return res.status(409).json({
          entry: claimed.entry,
          error: 'the conversation went cold — the reply expired unanswered and was withdrawn; nothing was sent',
        });
      }
      log.info('Reply approved — sending now', { id: req.params.id, wallet: req.walletAddress });
      let outcome;
      try {
        outcome = await publishEntry(claimed.entry);
      } catch (err) {
        // publishEntry records every KNOWN failure itself; a throw means the
        // real outcome is UNKNOWN — the post may or may not be live. Never
        // assert a verdict here: the entry stays `sending` and the
        // reconciler settles it against the live platform record within the
        // send lease. Force-marking it failed would invite a re-approve of
        // copy that already went out — the duplicate-publication machine.
        log.error('reply publish threw — outcome unknown, the reconciler settles it', { id: req.params.id, error: err.message });
        outcome = {
          ok: false,
          pending: true,
          detail: 'the send is in flight and its outcome could not be confirmed — the record settles against the live platform listing within the send lease; do not re-stage this answer',
        };
      }
      const fresh = (await postQueue.load().catch(() => []))
        .find((e) => e.id === req.params.id) || claimed.entry;
      return res.json({
        entry: fresh,
        outcome: outcome.ok
          ? { ok: true, postId: String(outcome.id) }
          : { ok: false, ...(outcome.pending ? { pending: true } : {}), detail: outcome.detail },
      });
    }
    // A TikTok post's approval IS the person's consent to its card's choices,
    // judged against the account as TikTok describes it right now.
    const tiktok = target?.channelId === 'tiktok' ? await tiktokApproval(req.walletAddress, target, req.body?.tiktok) : null;
    if (tiktok && !tiktok.ok) return res.status(409).json({ error: tiktok.detail });
    const result = await postQueue.approve(req.params.id, {
      decidedBy: req.walletAddress, scheduledFor: req.body?.scheduledFor,
      ...(tiktok ? { tiktokConsent: tiktok.consent, textSeen: req.body?.textSeen } : {}),
    });
    if (!result.ok) return res.status(409).json({ error: result.error });
    log.info('Post approved', { id: req.params.id, wallet: req.walletAddress });
    res.json({
      entry: result.entry,
      schedule: {
        id: result.entry.id,
        firesAt: result.entry.scheduledFor || 'next pass',
        lockedAt: result.entry.decidedAt,
        status: result.entry.status,
        scheduler: 'neuma-backend',
      },
    });
  } catch (error) {
    log.error('Queue approve failed', { id: req.params.id, error: error.message });
    res.status(500).json({ error: 'Failed to approve the post' });
  }
});

// Pull a staged entry back — draft or approved (the store's withdraw
// doctrine: a withdrawal is its own act, never a rewritten decision; a
// sending or settled entry refuses through the transition guard, and that
// refusal reaches the operator verbatim). Until 2026-08-06 withdraw had no
// REST door at all — only beings (queue_cancel) and the system could pull
// an entry; the operator's own board could not.
router.put('/queue/:id/withdraw', async (req, res) => {
  try {
    const result = await postQueue.withdraw(req.params.id, {
      withdrawnBy: req.walletAddress, reason: req.body?.reason,
    });
    if (!result.ok) return res.status(409).json({ error: result.error });
    log.info('Post withdrawn', { id: req.params.id, wallet: req.walletAddress });
    res.json({ entry: result.entry });
  } catch (error) {
    log.error('Queue withdraw failed', { id: req.params.id, error: error.message });
    res.status(500).json({ error: 'Failed to withdraw the post' });
  }
});

// Decline a draft — it stays in the record, marked.
router.put('/queue/:id/reject', async (req, res) => {
  try {
    const result = await postQueue.reject(req.params.id, { decidedBy: req.walletAddress });
    if (!result.ok) return res.status(409).json({ error: result.error });
    log.info('Post rejected', { id: req.params.id, wallet: req.walletAddress });
    res.json({ entry: result.entry });
  } catch (error) {
    log.error('Queue reject failed', { id: req.params.id, error: error.message });
    res.status(500).json({ error: 'Failed to reject the post' });
  }
});

// Edit a staged post IN PLACE (#208) — draft or approved only; the approval
// law lives in the store (new words or images renew the decision, a
// schedule-only edit preserves it), so REST and the being-tools can never
// drift apart. Never cancel-and-restage: the entry keeps its id and its
// history, and the patch's previous values land in its revision trail.
router.put('/queue/:id', async (req, res) => {
  const { text, scheduledFor, campaignId, pillar, media } = req.body || {};
  try {
    const result = await postQueue.update(req.params.id,
      { text, scheduledFor, campaignId, pillar, media },
      { by: req.walletAddress });
    if (!result.ok) return res.status(409).json({ error: result.error });
    log.info('Post updated', { id: req.params.id, wallet: req.walletAddress });
    res.json({ entry: result.entry });
  } catch (error) {
    log.error('Queue update failed', { id: req.params.id, error: error.message });
    res.status(500).json({ error: 'Failed to update the post' });
  }
});

// The same edit, many entries at once: each is decided INDEPENDENTLY and the
// answer names every id with its own verdict — never a silent failure, never
// all-or-nothing (one bad patch must not block a calendar of good ones).
router.post('/queue/bulk-update', async (req, res) => {
  const updates = req.body?.updates;
  if (!Array.isArray(updates) || !updates.length) {
    return res.status(400).json({ error: 'Body must carry a non-empty updates list' });
  }
  try {
    const results = [];
    for (const u of updates) {
      const id = typeof u?.id === 'string' ? u.id : '';
      if (!id || !(await isHouseEntry(id, req.walletAddress))) {
        results.push({ id, ok: false, error: id ? 'No such queue entry' : 'each update needs an id' });
        continue;
      }
      const { text, scheduledFor, campaignId, pillar, media } = u;
      const r = await postQueue.update(id,
        { text, scheduledFor, campaignId, pillar, media },
        { by: req.walletAddress });
      results.push(r.ok ? { id, ok: true } : { id, ok: false, error: r.error });
    }
    log.info('Queue bulk update', {
      count: results.length, landed: results.filter((r) => r.ok).length, wallet: req.walletAddress,
    });
    res.json({ results });
  } catch (error) {
    log.error('Queue bulk update failed', { error: error.message });
    res.status(500).json({ error: 'Failed to run the bulk update' });
  }
});

// Remove a draft/rejected/failed entry (sent history is permanent).
router.delete('/queue/:id', async (req, res) => {
  try {
    const removed = await postQueue.remove(req.params.id);
    if (!removed) return res.status(409).json({ error: 'only draft, rejected, or failed entries can be removed' });
    res.json({ removed });
  } catch (error) {
    log.error('Queue remove failed', { id: req.params.id, error: error.message });
    res.status(500).json({ error: 'Failed to remove the post' });
  }
});

// Set (or clear fields of) one channel's credentials — in the caller's house.
router.put('/:channelId/credentials', async (req, res) => {
  const fields = req.body?.fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    return res.status(400).json({ error: 'Body must carry a fields object' });
  }
  // Every value is a string (empty string = clear that field) — the store
  // never sees any other shape.
  if (Object.values(fields).some((v) => typeof v !== 'string')) {
    return res.status(400).json({ error: 'Each field value must be a string' });
  }
  // A pasted key carries no meaningful edge whitespace; a copied row of dots is no key at all.
  const pasted = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.trim()]));
  const bad = Object.entries(pasted).map(([k, v]) => [k, pastedKeyProblem(v)]).find(([, why]) => why);
  if (bad) {
    const label = req.channel.fields.find((f) => f.key === bad[0])?.label || bad[0];
    return res.status(400).json({ error: `${label}: ${bad[1]}` });
  }
  try {
    await setChannelCredential(req.walletAddress, req.channel.id, pasted);
    const store = await loadChannelCredentials(req.walletAddress);
    log.info('Channel credentials updated', { channel: req.channel.id, wallet: req.walletAddress });
    res.json(await maskHouseCredentials(req.walletAddress, req.channel, store));
  } catch (error) {
    log.error('Channel credential write failed', { channel: req.channel.id, error: error.message });
    res.status(500).json({ error: 'Failed to store credentials' });
  }
});

// Forget one channel's stored credentials in the caller's house (env
// bootstrap, if any, still applies — that is the operator's file to edit).
router.delete('/:channelId/credentials', async (req, res) => {
  try {
    const removed = await removeChannelCredential(req.walletAddress, req.channel.id);
    log.info('Channel credentials removed', { channel: req.channel.id, wallet: req.walletAddress, removed });
    res.json({ removed });
  } catch (error) {
    log.error('Channel credential removal failed', { channel: req.channel.id, error: error.message });
    res.status(500).json({ error: 'Failed to remove credentials' });
  }
});

// Tie the house's channel to its one holder — the neuma whose position this is.
router.put('/:channelId/binding', async (req, res) => {
  const neumaId = req.body?.neumaId;
  if (!(await assertNeumaOwner(req, res, neumaId))) return;
  try {
    const binding = await channelBindings.bind(req.walletAddress, req.channel.id, { neumaId });
    log.info('Channel bound', { channel: req.channel.id, neumaId, wallet: req.walletAddress });
    res.json({ binding });
  } catch (error) {
    if (error.message === 'Invalid neumaId') {
      return res.status(400).json({ error: error.message });
    }
    log.error('Channel bind failed', { channel: req.channel.id, error: error.message });
    res.status(500).json({ error: 'Failed to bind channel' });
  }
});

// Release the house's channel — back to default deny: no one may post through it.
router.delete('/:channelId/binding', async (req, res) => {
  try {
    const released = await channelBindings.unbind(req.walletAddress, req.channel.id);
    log.info('Channel released', { channel: req.channel.id, wallet: req.walletAddress, released });
    res.json({ released });
  } catch (error) {
    log.error('Channel release failed', { channel: req.channel.id, error: error.message });
    res.status(500).json({ error: 'Failed to release channel' });
  }
});

// THE CREW — who WORKS this sector, as distinct from who holds its keys:
// any lane the wallet owns, its neuma and the sealed AI witnesses it
// manifested (ruling, 2026-07-26). Each house's sectors are its own, and a lane
// another house owns is never seated by this one — its remit would ride that
// house's being's prompt. Crew never widens custody — the binding above is
// still the only thing that reaches the keys.
router.get('/:channelId/crew', async (req, res) => {
  try {
    res.json({ crew: await sectorCrew.crewFor(req.walletAddress, req.channel.id) });
  } catch (error) {
    log.error('Crew read failed', { channel: req.channel.id, error: error.message });
    res.status(500).json({ error: 'Failed to read the crew' });
  }
});

router.put('/:channelId/crew', async (req, res) => {
  const { neumaId, kind, remit } = req.body || {};
  if (!(await assertNeumaOwner(req, res, neumaId))) return;
  try {
    const crew = await sectorCrew.add(req.walletAddress, req.channel.id, { neumaId, kind, remit });
    log.info('Crew member added', { channel: req.channel.id, neumaId, kind, wallet: req.walletAddress });
    return res.json({ crew });
  } catch (error) {
    // A refused add says which field was wrong — a 500 here would read as a
    // server fault when the operator simply named nobody.
    if (/valid lane id|Unknown sector|crew holds/.test(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    log.error('Crew add failed', { channel: req.channel.id, error: error.message });
    return res.status(500).json({ error: 'Failed to add the crew member' });
  }
});

router.delete('/:channelId/crew/:neumaId', async (req, res) => {
  try {
    const crew = await sectorCrew.remove(req.walletAddress, req.channel.id, req.params.neumaId);
    log.info('Crew member released', { channel: req.channel.id, neumaId: req.params.neumaId, wallet: req.walletAddress });
    res.json({ crew });
  } catch (error) {
    log.error('Crew release failed', { channel: req.channel.id, error: error.message });
    res.status(500).json({ error: 'Failed to release the crew member' });
  }
});

export default router;
