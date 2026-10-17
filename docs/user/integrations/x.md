# X (Twitter) Integration — Setup, Rules, and the Line You Must Not Cross

NEUMA can give a being a voice on X through the `post_to_x` tool. A post is
**irreversible public speech from an account you own** — so this integration
is operator-governed by default, and this guide is required reading **before**
you connect credentials. The platform enforces what it can enforce; X's
automation rules are enforced by X, against **your account**.

---

## 1. Read this first: how accounts get banned

X actively suspends accounts for automation misuse. The platform cannot
protect you from X's enforcement — only your conduct can. The rules that
matter, from X's Developer Agreement & Policy and Automation Rules:

- **No spam.** Duplicate or near-duplicate posts, bulk posting the same
  content across accounts, trending-topic hijacking, mass unsolicited
  mentions or replies — these are the fastest routes to suspension.
- **Disclose automation.** An account that posts automatically should say so
  in its profile/bio (e.g. "automated account" and who runs it). An
  undisclosed bot that gets reported reads as deception.
- **One account, its own voice.** Don't coordinate several accounts to
  amplify the same content. Each connected account speaks for itself.
- **Respect rate limits and the tier you're on.** The free tier allows
  roughly 500 posts/month at the app level. Hitting limits repeatedly or
  probing around them is itself a signal X watches.
- **No aggressive engagement automation.** Auto-following, auto-liking,
  auto-DM campaigns are against the rules. NEUMA's lane only posts —
  deliberately. Keep it that way.
- **You are responsible for the content.** A being posts through *your*
  credentials. Defamation, harassment, and platform-manipulation rules apply
  to the account owner — you.

**Our doctrine on top of X's rules:** a being's post should be worth a
human's post. Introductions, real work, real thoughts — at a human cadence.
If you wouldn't post it five times a day by hand, don't let it go out five
times a day by tool.

### The reply lane (engagement, behind the same firewall)

Reading is research; answering is speech. The reply lane is the doctrine's
one deliberate extension — the house may ANSWER people who reply to its own
posts, under these laws, each enforced in code:

- **Replies to OUR posts only.** A slow listener (10 minutes, beside the
  post scheduler) reads the mentions lane and lands only posts whose
  `referenced_tweets` say `replied_to` AND whose `in_reply_to_user_id` is
  the house — a plain @mention or a reply to someone else never becomes a
  candidate, and a being can only draft against the candidate record. An
  arbitrary post id is refused.
- **Verified accounts only.** Blue, business, or government (a legacy tick
  counts as blue). The stage gate refuses anyone else.
- **At most two answers per person, ever in live standings.** The cap is
  counted FROM THE QUEUE (`draft/approved/sending/sent` — dead standings
  never count) at stage time AND again at send time. No over-engagement:
  it costs money and it is an attack surface.
- **Your approval on every word.** There is NO immediate reply tool. A
  reply stages as a `kind: 'reply'` draft in the campaign queue, shows on
  the board's own REPLIES tab with the original exchange above the draft,
  tagged REPLY, and publishes only after your approval — re-checking at
  send time that the target post still stands (a vanished target fails
  honestly, never a fallback post) and that the cap still holds. Replies may
  carry media (up to 4 images with alt text), staged and re-verified exactly
  like a post's attachments.
- **Everything inbound is framed.** Mention text is attacker-authored, so
  every line the X API returns rides inside the token-framed untrusted
  boundary (the same frame as web content) — verbatim, never stripped —
  in the being's reads, in the queue view, and on the card. The being is
  notified only if it HOLDS the X binding; every other lane's prompt is
  untouched.
- **Still no auto-engagement.** The lane never likes, follows, or answers
  on its own. X's automation rules punish mass/auto replies — verified-only
  + the 2-cap + human approval is the aligned shape, and it stays that way.

## 2. Run this on a dedicated rig

Even with the platform's security layers (env-only credentials, ACTS
approval gate, no autonomous posting by default), **production social
accounts belong on their own dedicated machine** — not your daily
development box. Reasons that don't go away:

- A dev machine runs unreviewed code all day; the credential env rides every
  process you launch from that shell.
- Rig-level scoping: the tool is advertised to **every** being bound on the
  rig that holds the keys. On a dedicated rig, the account's being is the
  only being there — identity and credentials stay one-to-one.
- Blast radius: if a dev box is compromised or misbehaves, your company's
  voice shouldn't be part of the damage.

Test on your workbench, operate from a dedicated rig, and when keys move,
**empty the old rig's slots.**

## 3. Setup (developer.x.com)

1. Create a project + app at developer.x.com (free tier is enough).
2. **User authentication settings:**
   - Type of App: **Web App, Automated App or Bot** (confidential client)
   - App permissions: **Read and write** ← save this BEFORE making tokens
   - Callback URI: any URL you control (e.g. `https://your-site/x/callback`)
     — NEUMA signs server-side with OAuth 1.0a and never runs the browser
     redirect flow; the field is required by the form, not by us.
   - Website URL: your site.
3. **Keys and tokens:**
   - Consumer Keys → `X_API_KEY`, `X_API_SECRET`
   - Access Token & Secret → `X_ACCESS_TOKEN`, `X_ACCESS_SECRET`
   - ⚠️ **Generate the access token AFTER setting Read and write.** A token
     minted before the permission change keeps read-only forever and every
     post answers `403: not configured with the appropriate oauth1 app
     permissions`. Fix: set permissions → save → **regenerate** the access
     token pair → re-paste those two values.
4. The token pair speaks as **whoever is logged in** when it's generated —
   log into the account the being will use, not your personal account,
   before generating.
5. Paste all four into `.env` at the repo root, then prove the lane:

```
node scripts/x-post-verify.mjs               # who am I? — posts nothing
node scripts/x-post-verify.mjs --post "..."  # ONE deliberate test post
```

6. Restart the desk. `post_to_x` is advertised to your beings only while all
   four keys stand.

## 4. The governance gate (what the platform enforces)

Every post a being attempts passes the same ACTS policy gate as spending —
fail-closed, operator-first (proven in `test/integration/x-post-gate.test.js`):

- **Default: every post pauses on your approval chip**, showing the exact
  text before it goes out. No policy row = approval required.
- **DENY** refuses the post; the being reads the refusal honestly.
- **OBSERVE mode** holds all posting — watching, not acting.
- **ALWAYS ALLOW** is a deliberate, persisted grant to that being. Grant it
  only on a dedicated rig to the account's own being — and know that from
  then on, that being posts without asking.
- A failed post is reported to the being as a failure, never a fake success.
- Your interrupt (barge-in) aborts a post that is mid-flight.

## 5. When keys rotate or leave

- Regenerating tokens at developer.x.com invalidates the old ones instantly —
  that's the kill switch if anything feels wrong.
- Moving the account to another rig = paste keys there, **blank them here**,
  restart both desks.

## 6. Scheduling — the truth about whose clock sends the post

Stated plainly after the 2026-07-28 stuck-send incident:

- **Scheduling is NEUMA-managed.** The backend's post scheduler
  (`post-scheduler.js`, 60s tick) sends approved posts at their slot. The
  desk UI does NOT need to be open — but the BACKEND must be running (on
  this rig it runs as the desk's backend process; under systemd it runs as
  the service). If the backend is down at the slot, the post sends on the
  next tick after it returns — and any approved post overdue past a 10-min
  grace is logged loudly (`approved posts overdue past grace`).
- **A claimed send is LEASED, never stranded.** `sending` carries
  `sendingAt`; a send older than 15 minutes with no recorded outcome is
  reconciled against the house's live posts: copy found live → recorded
  `sent` with the live id (never reposted); not found → recorded `failed`
  with the reason, visible and revisable. A publish that THROWS is recorded
  as a failed send with the error — the failure is always in the record.
- **X has NO native scheduling on the standard API v2 posting surface** —
  `POST /2/tweets` publishes immediately; there is nothing to hand a future
  slot to. Native scheduling exists only in the **X Ads API**
  (`scheduled_tweets`), which requires an eligible ads account with Ads API
  access. Detect whether the connected account has it:
  `node scripts/x-ads-scheduling-probe.mjs` (read-only). Until that probe
  says yes, every schedule you set rides the Neuma worker described above.
