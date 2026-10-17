---
name: design-variations
description: Render a front-end concept as 2-4 real HTML variations on one contact sheet BEFORE any code is written — LINE & CYCLE-bound, opened in a browser, judged by the operator. Code starts only from the variant the operator names. Use whenever a UI piece (container, section, card, panel, restyle, redesign) is being created or changed.
category: design
version: 0.1.0
metadata:
  format: neuma-native
---

# THE DESIGN BENCH — variations before code

The failure this skill exists to kill: a concept goes straight into a real
component, gets looked at, gets deleted, gets replaced, gets deleted again —
and every pass leaves remnants of the old attempt in the tree. The loop is
slow because the operator is judging *descriptions* of design instead of
design.

So the law of this skill is one sentence: **the operator never ratifies what
they have not seen rendered.** Variations first, in the browser, side by
side. The winner is the spec. The losers never existed as far as the tree is
concerned.

## The loop

1. **Name the exercise.** A kebab-case slug for the piece under design:
   `house-legend`, `settings-panel`, `stream-input`. Everything lands under
   `designs/<slug>/` — scratch space, gitignored, never committed.

2. **Render 2-4 variations.** Each is ONE self-contained HTML file:
   `variant-1.html`, `variant-2.html`, … Self-contained means all CSS inline
   in the file, no external assets, no build step — it must open from
   `file://` and look exactly as intended. Each variation is a genuinely
   different DIRECTION (layout, hierarchy, density, register), not the same
   idea recolored. Use the real content shape — real labels, realistic data,
   the actual strings the piece will carry; a variation stuffed with lorem
   ipsum hides the very problems the review exists to catch.

3. **Bind to the language.** Read `line-and-cycle.md` (shipped beside this
   skill) before writing a pixel. Variations use the real token VALUES
   (inlined into the file — the scratch page cannot import the app's
   stylesheets), the chamfer primitives, the two type registers, and the
   signal law: monochrome at rest, `#5FE9FF` only where something is LIVE,
   `#FF5533` for warnings only. An intentional break from the language is
   allowed — label that variant EXPLORATION on the contact sheet, because
   ratifying it means amending the language, not smuggling a style.

4. **Build the contact sheet.** Copy `contact-sheet.html` (shipped beside
   this skill) to `designs/<slug>/index.html` and fill it: one row per
   variant — number, direction name, the variant live in an iframe, and a
   notes line. The operator opens ONE page and sees every direction.

5. **Present and wait.** Tell the operator exactly what to open:
   `designs/<slug>/index.html` (double-click, or `python3 -m http.server`
   from the repo root if the browser is strict about iframes). One line per
   direction, in words. Then STOP — the pick is theirs. Do not pre-ratify,
   do not recommend past one sentence of honest trade-off per variant.

6. **Ratification → implementation.** The operator names a variant. The
   winning HTML is the spec: port it into the real component (React, the
   app's own CSS files, the real tokens via `var(--token)` — the desk never
   hardcodes what the mockup inlined). The losers stay in `designs/` — leave
   them or clear them, they never enter the tree either way. If the operator
   says "none of them," the loop returns to step 2 with what they told you —
   that is a normal round, not a failure.

## The laws

- **No real code before a ratified variant.** Not a skeleton, not a "quick
  first pass," not in a branch. The tree only ever receives a design that
  has been seen.
- **Self-contained or it does not count.** A variant that needs the repo's
  build to render is not a variation, it is an unreviewable promise.
- **Real content, real constraints.** The actual 15 titles, the actual
  wallet string, the long name that breaks the layout — put them in.
- **Variations differ in DIRECTION.** If you cannot state each variant's
  difference in one sentence, you have one variant with costumes on.
- **The mockup inlines, the desk never does.** Token VALUES live in the
  scratch HTML; the shipped component uses `var(--token)` from tokens.css.
- **Honest limits.** Variations are static mockups of real components —
  layout, hierarchy, density, register. They are not wired to live data and
  do not prove interaction timing. Say so when you present.

## When NOT to use this skill

- A one-line copy change, a token value tweak, a bugfix with one obvious
  shape. The bench exists for pieces someone will LOOK at and judge.
- Anything the operator has already seen and ratified — the ratification is
  the door; never make them walk through it twice.
