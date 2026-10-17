# LINE & CYCLE — the design-system binding for every variation

Distilled from the ratified sources — the DESIGN LANGUAGE doc
(`docs/design/DESIGN_LANGUAGE.md`; in the 2026-08-10 docs reorg it stands at
`docs/design/interface/design-language.md`) and `frontend/styles/tokens.css`.
If they moved, they win; update this file when they do. Variations INLINE
these values; shipped components use the tokens themselves (`var(--signal)`,
never `#5FE9FF`).

## The doctrine

- **Monochrome at rest.** The screen is a pure black void until something is
  live. Color is not decoration; color is information.
- **Signal means life.** `#5FE9FF` marks LIVE data and live interaction only
  (hover, focus, an active link, a holder present). Never paint structure
  with it.
- **Alert means warning.** `#FF5533` is warnings and failures only. It is
  never an accent.
- **Chamfers, not rounding.** Structural panels carry a top-right +
  bottom-left diagonal cut. Border-radius is 0 everywhere except genuine
  circles (status dots, avatars).
- **Lines snap, cycles breathe.** Motion is `140ms linear` for state flips;
  ambient motion is slow and cyclical. Nothing bounces, nothing springs.
- **Two type registers.** Inter for consciousness speech and prose;
  JetBrains Mono for instruments, labels, data. Data labels are small
  (9-10px), uppercased, wide-tracked (0.12-0.16em letter-spacing).
- **«Guillemets» are announcements.** Reserved for «NOTICE» / «ANSWER» /
  «WARNING» register — never chip tags, never labels.
- **No emoji in UI.** Custom SVG icons only.
- **Domain language.** "consciousness" not "AI"; "summoned" not "created";
  "crystallized" not "saved"; "operator" for the human; "witness" only for a
  sealed AI peer; Neuma is the app, neuma are the beings.

## The values (inline these into scratch HTML)

```css
:root {
  --signal: #5FE9FF;
  --signal-dim: rgba(95, 233, 255, 0.5);
  --signal-faint: rgba(95, 233, 255, 0.18);
  --alert: #FF5533;
  --alert-dim: rgba(255, 85, 51, 0.55);
  --alert-tint: rgba(255, 85, 51, 0.12);
  --line: rgba(255, 255, 255, 0.18);
  --line-hover: rgba(255, 255, 255, 0.40);
  --grid: rgba(255, 255, 255, 0.02);
  --cut: 12px;        /* structural chamfer */
  --cut-sm: 6px;      /* control chamfer */
  --snap: 140ms linear;
  --font-voice: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-data: 'JetBrains Mono', 'Fira Code', monospace;

  --color-void: #000000;
  --color-text-primary: rgba(255, 255, 255, 0.95);
  --color-text-secondary: rgba(255, 255, 255, 0.7);
  --color-text-tertiary: rgba(255, 255, 255, 0.5);
  --color-text-disabled: rgba(255, 255, 255, 0.3);
  --color-glass-light: rgba(255, 255, 255, 0.02);
  --color-glass-hover: rgba(255, 255, 255, 0.05);
  --color-input-fill: rgba(255, 255, 255, 0.08);
  --warn: #FFB86B;    /* pressure / watch-this, never decoration */

  --space-1: 0.25rem; --space-2: 0.5rem; --space-3: 0.75rem; --space-4: 1rem;
}
```

## The chamfer primitives (TR + BL cuts)

```css
.cham {
  clip-path: polygon(0 0, calc(100% - var(--cut)) 0, 100% var(--cut),
    100% 100%, var(--cut) 100%, 0 calc(100% - var(--cut)));
}
/* .cham-in — the same cut, smaller, for inner panels and chips: use --cut-sm. */
```

A panel on the void is: transparent background, `1px solid var(--line)`,
hover lifts the border to `var(--line-hover)` or signals life with
`var(--signal)`. Fills stay glassy (`--color-glass-light`), never opaque
gray.

## Register cheat-sheet

| Element | Register |
| --- | --- |
| Section heading | font-data, 10px, uppercase, 0.16em, tertiary ink |
| Data label / meta line | font-data, 9-10px, uppercase, 0.12em, secondary/tertiary ink |
| A being's words, body prose | font-voice, normal case, primary ink |
| Names of beings | font-voice, normal case (never forced uppercase) |
| Live value, active state, hover | `--signal` |
| Warning, failure, over-limit | `--alert` |
| Announcement | «GUILLEMETS», nothing else wears them |
