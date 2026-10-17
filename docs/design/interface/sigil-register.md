# THE SIGIL REGISTER — the mark language of LINE & CYCLE

**Status:** RATIFIED into the platform look-dev as the ecosystem's mark aesthetic
(Design note, 2026-09-30: […] / […]). Summarized in design-language.md § SIGIL REGISTER.
The Neuma logo is the ARMILLARY (below); this document locks the language it and
every sibling mark are drawn in.
**Parent:** [design-language.md](./design-language.md) (LINE & CYCLE, SHINKEI)
**Reference sheets:** `docs/design/logo/renders/study-07-sheet.png`, `study-07b-sheet.png`,
`study-06b-sheet.png` (the Void Crown)
**Reference implementation:** `docs/design/logo/study-07/kit.py` — every primitive
below is a function there; new marks import it rather than redraw it.

> The taste, in Founder's words: […] Sharp, refined, articulate; esoteric but never
> vague; sophisticated, never corporate.

---

## THE BALANCE LAW

Every mark pairs a **round body** with a **true point**. Neither alone is a sigil.

- **Round** = CYCLE: a true circle, a conic, a crescent, an arc. Rounds are exact
  geometry, never freehand wobble.
- **Sharp** = LINE: a needle, a spear, a cusp, a jewel. Points taper to a true
  zero width. A blunted point is a mistake.
- **Flow** is the passage between them: a stroke that swells along a curve and
  thins to a point (`ribbon` / `brush`).

## AT MOST ONE LIGHT

A mark may carry **one** signal element: `--signal` `#5FE9FF`, almost always a
jewel (a diamond, 0.7 width:height), placed where the meaning is (the open
seat, the point of focus, the thing that is alive). Everything else is ink
`#EDEDED` on void `#000`.

**The core logo carries no light at rest** (community feedback, adopted by Founder
2026-09-30: […]). Monochrome at rest, signal means life:
the logo's light is something the platform *does* (a live state, a motion
beat), never something the mark *has*.

## THE NEUMA LOGO — THE ARMILLARY (ratified 2026-09-30)

A meridian ring (the whole), an equator seen in true perspective (its back half
a hairline behind, its front half a solid band in front), and one axis of steel
through the center at **23.44°, Earth's real axial tilt**, leaning upper-left,
reaching past both poles to true points, with a solid core at the still point.
(The lean was mirrored on 2026-09-30, after the trademark knockout found that
xAI's ring-and-slash mark leans upper-right. The magnitude is unchanged, and
Earth's tilt is true drawn either way.) It combines sky and
Earth, instrument and heavens, science and the sacred in one object.

- Built from one geometry by `docs/design/logo/neuma/build.py`: full and small
  cuts, ink and black versions, lockup and wordmark (Inter Light, tracked .42em,
  outlined so the files stand alone). Sheet: `docs/design/logo/renders/neuma-mark-sheet.png`.
- **Family marks kept for platform use:** HALO AND THORN and ELEVEN STAR
  (`docs/design/logo/family/`). Like the logo, they are **ink only**: Founder removed their cyan
  jewels on 2026-09-30 ([…]).
  The register still allows one light per mark, but the platform's own marks rest without it.

## THE PRIMITIVES (100-unit canvas)

| Primitive | Form | Weight |
| --- | --- | --- |
| `ring` | a true circle, stroked | 1.6–1.9 (body) |
| `hair` | a hairline — horizon, axis, generating circle | 0.5–0.8, may drop to 50–70% opacity |
| `needle` | flat root → true point | root 1.6–5 |
| `spear` | a lens of steel, sharp both ends, widest at 0.35 | 1.8–15 |
| `ribbon` / `brush` | variable-width stroke along a curve | swells to ~4, ends at 0 |
| crescent | a disc minus an offset disc (mask) | — |
| `diamond` | the jewel; ink for stations, signal for the one light | 1.3–3.6 |
| `disc` (void) | a black cut that isolates the light from ink around it | — |

**Three weights, never more:** body (solid), hairline, point. Depth may be shown
honestly — the back half of a ring in perspective drops to hairline, the front
half passes before the blade with a void gap (study 07 `04-halo-and-thorn`,
`16-armillary`).

## THE MEANING LAW (SHINKEI, applied to marks)

- **Every count and angle is true and can be named.** Eleven stations because
  the Emanon architecture has eleven functions; the armillary axis at 23.44°
  because that is Earth's tilt; the bindu's triangles because upward is Shiva
  and downward is Shakti. No number is decorative.
- **Every esoteric reference is real and correctly named** — Keter, the corona,
  the ankh as the breath of life, the alchemists' Mercury as spirit. If we
  cannot cite it, we do not draw it.
- **Inspiration, never imitation.** The register sits in the lineage Founder draws
  from (the insignia, crests and instrument marks of the works he cites) without
  borrowing a single mark, term or signature visual from them.

## COMPOSITION

- **Axis.** Vertical symmetry is the default; the light sits on the axis or at a
  meaningful station. Asymmetry must carry meaning (the armillary's tilt).
- **Small-size cut.** Below ~48px, drop hairlines and double the body weights
  (study 06 `f-void-crown-small`). A mark ships with both cuts.
- **Organization plate** (study 05/06): code line (JetBrains Mono, tracked) ·
  wordmark **Inter 300, letter-spacing .42em** · hairline rule · katakana +
  descriptor · motto (**ANIMA NON MACHINA** for Neuma) · registration corners ·
  hatch bar.
- **Unit patch:** double ring, rim text on a path, the mark at the center.

## WHAT IT IS NOT

Spikes that read as threat (study 05's first crown); letterforms; generic
sparkles or stars (study 07 `06-astroid`, `13-lens-star`); eye clichés; anything
that reads as a gauge unless it truly gauges.
