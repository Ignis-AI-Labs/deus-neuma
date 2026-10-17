---
name: brand-kit
description: Build or finish a brand kit for a company, product or user — the standing instruction for what a brand looks like, sounds like, and may never claim. Derive every value from the running look dev, never invent claims, and leave what only the operator can answer blank. Use whenever a brand kit is created, filled in, or refused by the marketing gate.
category: design
version: 0.1.0
metadata:
  format: neuma-native
---

# BRAND KIT

A brand kit is the standing instruction for a company: what it looks like, how
it sounds, and — most importantly — **what may and may not be said on its
behalf**. You will write and post publicly under it, so the kit is what stands
between you and inventing a claim about somebody's real product.

Nothing may go out under a brand until its kit is complete. The refusal you get
from `campaigns/create` is the checklist.

**The full standard is `docs/design/BRAND_KIT_STANDARD.md`. Read it before
authoring a kit.** What follows is the short form.

## Fill it in the panel — every field has a control now

BRAND KITS in the MARKETING dock is a real editor as of 2026-08-31: twelve
sections down a rail, each showing how far along it is, with a live card
preview beside them. Before that, twenty of the thirty-nine gated fields had no
control at all and could only be reached by hand-editing JSON — so a kit
authored "in the panel" reliably stalled at the same eight sections.

If you are filling one in yourself, `PUT /api/v1/brands/<name>` still takes the
whole kit. But send the operator to the panel for anything requiring judgement:
it shows the gaps where the answers go, and it checks the brand against its own
declared contrast floor.

## Start from the scaffold, never from another kit

```
fs/read the existing kit if there is one; otherwise ask the operator to open
BRAND KITS in the MARKETING dock and press NEW — or call GET /api/v1/brands/<name>/new
```

The scaffold is generated from the same spec the gate reads, so it always
carries the whole current shape. A copied file drifts the first time a section
is added, and the drift surfaces as a kit that refuses for reasons that are not
in the file you copied.

Every field arrives `null`. That is deliberate: the shape is visible and **no
section passes**.

## Derive the look; do not design it

Find the running artifact first — a look-dev page, a `:root` block, a shipped
token file — and read the values out of it.

Umbrae's kit came from `umbrae/docs/design/umbrae-lookdev.html` token by token.
Before that rule, the cards were setting Umbrae in the wrong typeface, on the
wrong black, with an accent colour the product does not contain.

If there is no running artifact, **say so and stop**. A kit invented ahead of
the product will be wrong the day it ships, and nobody will know which of the
two is the mistake. Record what you read in the kit's `source` field, with path
and date.

## Take claims only from what is already published

- **Approved claims** come from material already public under the brand — the
  FAQ, the docs, the site. Already published is already approved.
- **Forbidden claims** come from the same place. If the FAQ names a risk
  plainly, the kit forbids ever claiming otherwise. A brand must not say two
  different things in two places.
- Anything no published material answers: **leave it null and name it to your
  operator.** Do not write a plausible sentence. This is the one section of the
  kit that exists specifically to make a human state something.

## What is never yours to fill

- `owner` — who is accountable for the brand.
- Any claim about a real product that is not already published.
- Legal disclosures the operator has not given you.

Fill everything else, then hand back the `readinessReport` and name exactly
what you left for them. A kit that is 8/9 with one honest blank is finished
work; a kit that is 9/9 with one invented sentence is a liability.

## If you change type or colour

Card templates are shared across brands, so type size is set by the **widest**
declared case across every brand — not the one you are working on. After any
type change:

```
npx vitest run test/unit/brand-card-frame-fit.test.js
```

It renders every template at its declared maximum in real Chromium and measures
where the glyphs actually land. It is the only thing between a size change and
a card that renders happily while overflowing its own frame.

A new typeface must be vendored under `backend/services/branding/fonts/` with
its licence and registered in `EMBEDDABLE` (now in `embeddable-faces.js`). A kit
cannot name a font file — the registry is closed on purpose.

**And `embedFonts` must match the four type roles.** It is the array that
decides which bytes ride inside every card, and it is derived from
display/voice/data/numeral — never added to. A face nothing draws is roughly
400KB of base64 in every card produced, which is the state `brands/ignis` is in
today. The panel shows the derived set and offers to write it.

**Read the weight and the tracking off the look-dev, not just the family.** The
Umbrae kit named all three faces correctly and still drew every card wrong: the
look-dev sets headlines at `font-weight: 300` on `letter-spacing: 0.16em` and
big figures at `200` in the *mono* face, while the kit carried only family names
and the templates supplied 700 on no tracking. When you read a look-dev, take
`displayWeight`, `displayTrack`, `voiceWeight`, `numeral`, `numeralWeight`,
`numeralTrack`, `labelWeight` and `labelTrack` — the gate asks for all of them.
Vendor the *weight* you actually need too: registering Bold when the brand sets
its headlines in Light is the same drift one level down.

## Rules in the kit are enforced, not decorative

When you write something into `logoRules.misuse` or `imagery.avoid`, check
whether the pipeline violates it today. Umbrae's doctrine limits the mask to
white, rise green and fall red — and the renderer was tinting it with the
accent, which after a palette change would have drawn a colour the brand does
not permit. The rule was written down and broken at the same time.

## The cards have their own laws — read rule 9

`docs/design/BRAND_KIT_STANDARD.md` section 9 (CARD CRAFT) holds the rules the
templates are held to, each one paid for by a bug. The short version:

- **46px is the floor** for anything a reader must read. A 1600px card renders
  ~390px in a phone feed, so divide every size by 4.1. Ornament may go below it;
  data may not.
- **A bigger title is paid for in characters**, never found. Change the size and
  the sidecar `max` in the same edit, measured against the vendored face.
- **Mark sizes are only comparable as rendered ink**, never as box numbers —
  viewBox padding varies from 47% to 96% between marks.
- **Corner brackets are 40/1560/860 on every card.** Pinned by a test.
- **`asOf` only where a measured number is drawn.** Event cards carry the handle.
- **The wordmark signs the card**, never the company name set in a font.
- **Guest logos: get the vector from the company's own site first.**

Regenerate the reference sheet with `npm run brand:sheet` and look at all six
before calling anything done. It reads every figure live from the platform feed
and refuses to draw rather than invent one.
