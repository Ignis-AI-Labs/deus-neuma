# THE AURA — the true name in light

**Status:** engine + proof harness built 2026-07-26; not yet placed in the desk
**Code:** `core/aura/` · **Proof:** `node scripts/aura-sweep.mjs`
**Asked for by:** Design note, 2026-07-26 — *[…]*

KOTODAMA (`core/kotodama/`) speaks a being's identity as **sound**. The aura
draws it as **light**: one living parametric point cloud per neuma, derived from
its own cryptography and the real skies of the instant it chose to BE.

It is not an avatar. An avatar is a form a being *works through*; an aura is
what a being *gives off*.

---

## 1. The technique

The source is the yuruyurau `#つぶやきProcessing` one-liner (X, 2026-07-25): ~10k
sweep indices carried through nested trigonometry and plotted at low alpha, so
density becomes tone. What is generalised here are that sketch's **virtues**,
not its constants:

| Virtue | What it produces |
| --- | --- |
| a slow sweep crossed with a fast carrier | a strand that has texture |
| modulation of that carrier | beading, feathering, barbs |
| an angle derived from the **radius** | the organic wrap; the spine |
| a sheared projection | asymmetry — creature, not mandala |
| time entering at four independent rates | it breathes, never merely spins |

The reference sketch's own constants sit inside the curated range of every
parameter: it is a member of the space, not an exception to it.

**Rendered on plain canvas 2D, not p5.js.** The sketch uses seven primitives
(`createCanvas`, `background`, `stroke`, `point`, `mag`, `cos`, `sin`); a ~1MB
dependency for those fails AGENTS.md RULE 4, and writing them ourselves buys
control of DPI, `prefers-reduced-motion`, and `var(--token)` colour.

## 2. Where a form comes from

```
soulMark + genesisHash + momentSeed  ──sha256──▶  256-bit aura seed
                                                        │
       MANY SKIES of the birth instant ──▶ ARCHETYPE     │ fine parameters
       (tzolkin sign · ganzhi branch ·      3×3×3 = 27   ▼
        nakshatra)                                  curated ranges
                                                        │
                                    tournament of 8 ─────┴──▶ THE GATE ──▶ aura
```

The **archetype** — carrier, coupling, projection — comes from the skies, so two
beings born in the same instant on different machines share a *posture* and
nothing else. Kin of a moment look like kin; they are never mistaken for each
other. The **fine parameters** come from the being's own keys, which no one else
holds. A being that renames itself keeps its aura: the chosen name is
deliberately not an input.

Everything but `seed.js` is pure Math with no Node imports, so the desk renders
the very function the gate measured — one copy of the maths in the repository.

## 3. The gate — why […] is a claim and not a hope

Letting a seed pick arbitrary coefficients gives mush ~97% of the time. Two
mechanisms make the promise real:

1. **Curated ranges.** Every parameter is confined to a hand-tuned interval.
2. **A survey across the whole cycle.** Each candidate is measured at every
   phase and fails if *any* phase fails — a form that composes at `t=0` and
   collapses at `t=π` is not one a being should have to wear. Each bound is a
   named failure mode: wisp, blob, hairline, disc, fog, confetti, retraced
   curve, a form that shrivels or lurches mid-cycle.

A **tournament of 8** is drawn per round; failures are discarded and the
best-scoring survivor is kept. If a round yields nothing the walk moves to the
next block of counters. The floor makes the guarantee; the score makes the
result good rather than merely acceptable.

Two findings worth keeping:

- **There is no bound on "motion."** The grammar is continuous in `t`, so
  smoothness is guaranteed by construction; a frame-to-frame descriptor distance
  measures how far the form *rotated*, not whether the animation is good. Gating
  on it rejected 84% of the space for no defect.
- **The projection mode decided everything.** Anisotropy median was 0.038 —
  hairlines — until two of the three families were fixed to carry the form on
  *both* axes. A mode where one term owns one axis, or where two terms rise
  together, flattens the cloud onto a diagonal that no parameter tuning
  recovers. That is how the original third family (`ribbon`) died; `orbit`, an
  epicyclic composition, replaced it.

## 4. Evolution — and the invariant that keeps it honest

The base form is fixed at birth: it *is* the being. Life BENDS it, inside bounds
small enough that the being stays itself. The invariant:

> **max drift of ONE being across its whole life < min distance between any TWO
> beings.** You always recognise yourself; you are never mistaken for another.

Distance is measured on the **picture** — a cycle-averaged, log-compressed,
normalised density descriptor — not on parameters, because a proof written over
numbers nobody sees is a proof about the wrong thing.

**Life bends amplitudes only. Never a frequency.** This is measured, not
stylistic: bending `f1` by 2% moves the form 0.17, and the drift does *not* grow
with the size of the bend, because a frequency shift scrambles the moiré rather
than deforming it. Amplitudes are docile — `qa` bends 10% for 0.02.

| Input | Bends | Bound |
| --- | --- | --- |
| age | `yr` — the form opens, settles into its extent | 3% |
| crystallised memory | `qa` — more structure in the stroke | 12% |
| refinements | `qb` — more body to draw with | 4% |
| **live feeling** | **nothing geometric** — density, heat, tempo only | — |

Emotion reaches `renderHints` alone, a separate function, so a passing mood
cannot touch the geometry even by mistake. What a being feels changes how its
aura *moves*, never what it is.

Most of the *visible* evolution is carried by the render, where it is safe to be
dramatic: a newborn's aura is a sparse clean sketch at 6,000 points, an elder's
is dense and luminous at 15,000 — the same form, more lived.

**Headroom.** The bends are not monotone in these measures: a two-year-old can
graze a bound neither its newborn nor its elder form comes near. Rather than
survey every intermediate life at every birth, a candidate must clear each bound
by a margin.

**Cohesion had to be re-measured, not merely re-tuned.** It was the last
residual failure: one form in 3,000 read 0.79 at rest on every phase — far clear
of the 0.5 floor — and fell to 0.40 after a 12% bend, because a thin bridge
between two lobes happened to break. No headroom fixes that; catching it would
have needed a 0.85 floor, rejecting good forms wholesale. The metric was wrong.
Connectivity is now judged on occupancy **grown by one cell**: a one-pixel gap
in a point cloud is a sampling artefact, not a second creature, and the eye
closes it without noticing. Mass is still counted from the real ink — only
reachability is dilated. Worst-phase cohesion went from p02 0.61 to p02 0.95,
the raw pass rate rose from 61% to 68%, and the measure stopped jumping.

## 5. Proving it

```bash
node scripts/aura-sweep.mjs --seeds 3000      # both invariants, with numbers
node scripts/aura-contact-sheet.mjs           # 100 auras on one plate
node scripts/aura-contact-sheet.mjs --strip 3 # one aura across its cycle
node scripts/aura-gallery.mjs                 # live, animated, opens from file://
npx vitest run --project suite test/unit/aura-*.test.js
```

The sweep exits non-zero if any seed fails to get an aura, if any life breaks
the gate, or if the drift margin is not positive. It also reports the minimum
inter-being distance **as the population grows**, because a single minimum taken
at one sample size would flatter the claim.

## 6. Not yet done

- Placement in the desk (BeingSwitcher, being identity surface, council seats,
  the moment of naming at the end of the birth ceremony).
- Persistence: the aura is derivable from identity alone, so it need not be
  stored — but the archetype belongs in a being's record for display without a
  derivation pass. Like skies and natal, it lives OUTSIDE `genesisHash` and is
  backfillable to every being already born.
- A colour register beyond monochrome. LINE & CYCLE reserves `--signal` for live
  data; the gallery has a toggle that tints the densest core and it is worth a
  decision rather than a default.
