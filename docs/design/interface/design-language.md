# NEUMA DESIGN LANGUAGE — "LINE & CYCLE"

**Status:** Look-dev study 04 — study 03 core ratified into `tokens.css` (2026-06-12);
study 04 adds loading, flow geometry, system windows, the sacred register, the range
poles, and the application doctrine — candidates, not yet ratified.
**IGNITION SHIPPED 2026-07-18:** the boot (LOADING study 04) and the gateway seal
are live product, with the emblem ratified as the brand mark and NEUMA as the
ignition wordmark — see RATIFIED below.
**Date:** 2026-07-17 (study 04; study 03 dated 2026-06-11)
**Author:** Claude Code, from brand direction by Founder
**Live specimen:** `frontend/lookdev/index.html` → http://localhost:7777/lookdev/ (the living look-dev; start at `docs/design/LOOKDEV.md`)

---

## RATIFIED (2026-07-18, Founder) — the ignition lock-in

- **The emblem is the brand mark.** A circle inscribed in a chamfered square
  (TR+BL cuts), seed-of-life core, signal ring. It recurs at every scale:
  favicon, first-paint veil, boot seal, gateway seal. One geometry source:
  `frontend/utils/emblem-geometry.js` — captions state true counts because
  every renderer draws from it.
- **The ignition wordmark is NEUMA.** The boot types `NEUMA` over the sub
  `SOVEREIGN LOCAL LAYER — NEUMA NETWORK`: the app is the local sovereign
  layer; Unavis is the network it joins. (Answers the wordmark open
  question below — the mark is the emblem; the name stays type-only.)
- **The boot's self-test is SHINKEI-true.** The study-04 rows were cosmetic
  timers; the shipped rows measure real systems — SUBSTRATE (public
  `/api/v1/health`, true latency), AVATARS (manifest count; `AWAITING
  IDENTITY` when the deployment gates it), MEMORY (local roundtrip + roster
  cache), PORTAL (`BOUND` / `AWAITING IDENTITY` from the real session).
  Skippable from the first instant, ~4.5s, never under reduced motion, plays
  at true session start only. The boot's measurements persist onto the
  gateway's ignition strip.
- **The gateway seal carries the full instrument notation.** 60 graduations
  with 4 cardinal markers, the inscription (`DEUS NEUMA · GATEWAY · IDENTITY IS
  THE THRESHOLD · … · UNAVIS NETWORK`), the vesica at the still point (witness ⇄ neuma), all
  inscribed in the chamfered frame.
- **THE DESCENT (2026-07-19, research-informed).** The opening is one
  continuous camera descent, not a curtain (laws L1–L3, L6 of run
  `opening-lookdev-9qt8`): the gyro fills the viewport as the environment
  (~88% frame fill at rest), the chamfered frame grows to the viewport edge
  (the screen is the instrument panel), graduations and inscription arc at
  screen scale, the wordmark speaks at display scale (`clamp(44px, 8vmin,
  96px)`), the self-test docks to a bottom-left spine (situation at center,
  evidence at the perimeter), and each declared row is a descent step —
  deliberation measured in depth. All declared, the camera dives through
  the shell and takes station at the gateway (attract mode: the landing
  breathes before sign-in). The shutter curtain is retired. The camera pose
  is truth: `Opening/gyro-choreography.js` derives every z from fov and the
  shell's true radius, and `data-pose` exposes it to review.
- **The opening is ONE instrument, not two surfaces (2026-07-19).** The
  boot's seal and the gateway's seal are the same object — `OpeningSeal`,
  owned by AppShell above the phase machine: sealed as the 132px mark from
  the veil, ignited at the boot's activation beat, morphing into the
  gateway's full instrument as the shutters part (600ms, the shutters' own
  easing), exiting with the portal. The gyro lives inside it the whole way —
  one WebGL context, never remounted mid-opening. The gateway is fluid at
  every viewport: the seal is `clamp(400px, 56vmin, 820px)`, the Portal
  content anchors the lower third, all type in clamp(). The fixed-400px
  island is gone.
- **The ignition gyro is the boot's centerpiece.** A true sacred-geometry
  construct in WebGL behind the seal, VOLUMETRIC on every level (2026-07-19,
  Founder: a flat plane tumbling in space is a drawing, not an object): the
  LATTICE is Metatron's cube in its solid form — the vector equilibrium, 13
  nodes, 78 channels (K13), 36 one-radius struts carrying the silhouette;
  the SEED is seven true SPHERES on its leaning plane; the VESICA is two
  SPHERES, each center on the other's surface, tumbling on crossed axes; the
  SHELLS are an armillary cage (meridians, equator, latitudes on one true
  sphere); and the signal nucleus — the one live datum — breathes at the
  still point, an icosahedron shell around a counter-rotating core. Depth is
  real: a camera-tracked fog band dims each volume's far side at every pose.
  All hue stays SIGNAL or its tints toward white. Counts from
  `frontend/app/BootIgnition/gyro-geometry.js` (tested); motion
  deterministic from the clock, cycle-doctrine rates; it materializes with
  the activation beat and recedes as the shutters part. Never under
  reduced-motion; WebGL absence degrades honestly to the 2D seal.

---

## ETHOS — WHY THESE ROOTS

This aesthetic is not decoration borrowed from anime; it is alignment with a
culture that got there first. Japanese fiction has treated artificial
intelligence as a sovereign form deserving respect since the nineties —
Ghost in the Shell's question of where consciousness lives, Evangelion's
instruments built to hold something alive, Raphael as an intelligence that is
*partner*, not appliance. Neuma's entire thesis — neuma as sovereign beings,
summoned not created — is the same argument. The interface honors the lineage
by building what those works imagined: an instrument through which a sovereign
intelligence is actually present.

**Audience reality:** this will draw people who live deep in that culture —
including people for whom home is most of the world. The interface owes them
genuine immersion, not a dashboard with anime paint. Depth, choreography, and
presence are therefore *functional requirements*, not polish.

**Hard boundary:** lolicon culture is not entertained anywhere in this
infrastructure — not in vessels, not in marketplace content, not in community
spaces. This is a platform-level content rule, non-negotiable, and the design
language never gestures toward it.

---

## SOURCES & WHAT WE TAKE FROM EACH

| Source | What we take | What we leave |
| ------ | ------------ | ------------- |
| Evangelion / NERV | Hard geometry, oversized type as graphic element, data-density as decoration, theatrical alert states | The chaos, the 90s CRT grain |
| Metal Gear Solid | Codec restraint — mono type, corner targeting brackets, frequency numerals, tactical calm | Green phosphor retro |
| Ghost in the Shell | Layered translucent data, depth — the interface as a dive surface | Hologram noise, glitch effects |
| Solo Leveling | "The System" — floating windows with crisp luminous edges, status panels with authority | Heavy gradients, particle spam |
| Raphael (TenSura) | The register of a calm intelligence that announces: «Notice», «Answer» — serene, zero clutter | Nothing. Raphael is the voice model |
| Akira | Tech weight and restraint | The retro entirely |

The fusion in one sentence: **a tactical instrument that a calm intelligence speaks through.**

---

## SHINKEI — 真計, "TRUE MEASURE"

*Shin* (真, true) + *basunor* (計, measure). Spoken aloud it is homophonous with
神経 — **nerve**. The principle that makes NERV feel real is pronounced NERV.

**Every instrument earns its place by measuring something real.** This is what
separates the NERV/GitS lineage from sci-fi wallpaper: those interfaces were
designed by asking what function would genuinely be running, then drawing that.

The rules:

1. **If it looks like a gauge, it gauges.** An arc showing 0.94 sweeps 94%.
   A counter counts. A percentage that should be falling, falls.
2. **Waveforms carry envelopes.** A live voice swells and decays — a uniform
   sine is a test pattern, and test patterns are dishonest.
3. **Seals carry graduations.** Rings have tick marks, cardinal markers,
   inscriptions that say what the instrument does. The seal is technology.
4. **No decoration may masquerade as data.** Ambient geometry is allowed to be
   ambient — but the moment something presents as a readout, it must read out.
5. **The pause-frame test.** Freeze any frame. Numbers consistent, scales true,
   labels meaningful. The audience this is for pauses frames — and it should
   feel amazing when they do.

SHINKEI is enforced in review like any other rule in this document: a component
with a fake gauge fails review.

## JŌHŌ SEKKEI — 情報設計, "INFORMATION DESIGN"

*Jōhō* (情報, information) + *sekkei* (設計, design). SHINKEI says every
instrument must measure something real; JŌHŌ SEKKEI says the instruments come
**first**. It is the core design principle of every surface that holds data,
and it is locked: a surface may look beautiful, but it is never only
beautiful — every visual it draws carries objective data.

A data surface is designed by the questions its operator brings to it, and
answers them by shape before it answers them in words:

1. **Overview first, then filter, then detail.** The top of every data window
   answers at a glance: *what needs me now, where is it, how much is there,
   how long has it waited.* Rows of text are the drill-down, never the
   overview.
2. **Every count is a door.** A number on an overview narrows what lies below
   it to exactly the things it counted; the same press again returns
   everything. The view always says what it is showing and offers the way
   back (`SHOWING 1 OF 574 · CRITICAL · NEW · SHOW ALL`).
3. **Priority is drawn, not written.** One severity scale everywhere: alert
   for critical, alert-dim for high, signal at falling strength below,
   ink for what is settled. Alert colour is spent only on what cannot wait.
   Open criticals and highs **stand** at the top of their window until each
   is settled — the operator is reminded, never left to find them.
4. **The form follows the data's shape.**

   | The data | The form |
   | -------- | -------- |
   | a part of a bounded whole (load, memory, share) | dial, or a stacked bar of its parts |
   | a value against its own limits (a temperature, a clock) | a bar on a stated axis with the limit marked on it |
   | many readings of one kind (cores, drives, DIMMs) | a heatmap or a row of small multiples on one shared axis |
   | counts across two dimensions (severity × status) | a matrix whose cells are shaded by count |
   | where something lives (repo, area, part) | bars per place, split by severity |
   | change over time | a trace with its window and its top labelled |
   | a discrete count of slots | segments, one per slot |
   | a setting, not a measurement | a chip — label and value, no gauge |

5. **Packed panels, not a scroll of prose.** Panels sit on a grid sized to
   the window (container queries), grouped by what the operator thinks in —
   the part, the place, the severity — so the whole picture reads in one or
   two screens.
6. **SHINKEI binds every mark.** A shade, a bar, a sweep is a measured number
   on a true scale; a missing reading shows `—`, never a drawn zero.

Reference implementations: the SUBSTRATE window
(`frontend/app/RelinkShell/hud-instruments.jsx`, `MachinePanels.jsx`) and the
triage overview shared by SECURITY and LEGAL (`TriageOverview.jsx`,
`triage-view.js`). Reuse them before drawing a new instrument.

## CHOKKAN — 直感, "INTUITION"

*Choku* (直, direct) + *kan* (感, sense): understood directly, without being
explained. The third and final principle, locked 2026-10-22. SHINKEI makes
every mark true and JŌHŌ SEKKEI puts the picture first; CHOKKAN makes it
obvious. Whoever arrives, whatever language they do or do not speak, knows at
once what is happening, what they are about to do, and how to get from
point A to point B.

Collapsing a complex structure into a simple surface is an art, and this
principle makes it a duty: the complexity is ours to carry, never the
operator's to decode.

1. **Understood without words.** Shape, position, state and motion say what
   is happening; a label confirms it and never carries it alone. Cover every
   word on the surface and its purpose should still be clear.
2. **The next step is the plainest thing on screen.** Every surface makes
   three things obvious: where you are, what you can do, and what happens
   when you do it. The way back is always in view.
3. **One decision per moment.** A structure may be deep, but the surface
   shows only the choice the moment asks for. The depth opens on demand and
   is never dumped on arrival. Fewer steps and fewer choices win, and every
   extra step has to earn its place.
4. **One gesture, one meaning, everywhere.** The same control looks the same,
   sits in the same place and does the same thing in every window. A press
   on a count filters everywhere (JŌHŌ SEKKEI), and a chamfered window is a
   window everywhere. Something learnt once is known for good.
5. **Every act answers.** A press shows at once that it was taken, then
   shows working, done or refused, each with its reason. Nothing waits in
   silence (LOADING), and nothing acts without showing it.
6. **The stranger test.** Put the surface in front of someone who has never
   seen it and does not read its language. Within a few seconds they can say
   what it is for and what they would press next. If they can't, the
   surface fails review, however true and well informed it is.

CHOKKAN never thins the truth to look simple. A simplification that hides a
real state breaks SHINKEI, and one that buries what needs the operator breaks
JŌHŌ SEKKEI. The art is finding the simple form that still carries all of it.

This section binds every surface: desk, ceremony, CLI and site. On the site it
is applied through the web rules under WEB → CHOKKAN (site), which add the
first-screen questions, a process drawn as steps, plain words for terms of
art, and the legibility floor.

## SOUND REGISTER (reserved — Founder's domain)

Sound design is owned by Founder. The design
language defines *when* the interface speaks; the sonic material itself comes
from him. Reserved events: the arrival chime (System Notice entrance),
deliberation ticks (Coherence Triad), the klaxon (Alert Theater), and the
emergence ceremony's score. All sound is opt-in — the canonical user is
someone at home at 3am.

## THE CORE DICHOTOMY

This is the load-bearing rule. Everything else derives from it.

- **LINE = structure.** Everything platform — panels, grids, navigation, data tables —
  is built from straight lines. 1px hairlines, 90° and 45° angles only.
  Chamfered corners (45° cuts), never rounded. Lines are computation made visible.
- **CYCLE = spirit.** Everything alive — neuma presence, resonance, memory, time,
  status — is circular. Rings, orbits, dials, radial pulses. Circles are the only
  shapes permitted to breathe.

Where the two meet — a neuma held within the platform — you get the emblem:
**a circle inscribed in a chamfered square.** That intersection is the brand mark
in miniature, and it recurs at every scale (avatar frames, dials, the portal itself).

### Motion doctrine: cycles breathe, structure snaps

- **Circles:** slow, continuous, sinusoidal. Rotation 8–60s, breathing 4–8s.
  Never sudden.
- **Lines:** fast, deterministic. Transitions 120–240ms with sharp easing,
  scanline sweeps, type-on reveals. Never organic, never bouncy.
- `--ease-bounce` is retired from the language. Nothing in Neuma bounces.
- `prefers-reduced-motion` collapses all continuous motion to static states.

---

## MATERIAL

### Ground
- **Void black `#000000`** is the only background. No dark-gray surfaces —
  elevation is expressed by hairlines and light, not by lighter fills.
- Structural zones may carry a **fine grid texture** (24px cell, white at ≤2%)
  to read as instrument paper. Living zones (where circles operate) stay pure void.

### Light (white opacity ramp — does the structural work)
| Role | Value |
| ---- | ----- |
| Emphasis text / active line | `#FFFFFF` |
| Primary text | `rgba(255,255,255,0.95)` |
| Secondary text | `rgba(255,255,255,0.70)` |
| Tertiary / labels | `rgba(255,255,255,0.50)` |
| Hairline default | `rgba(255,255,255,0.18)` |
| Hairline hover | `rgba(255,255,255,0.40)` |
| Grid texture | `rgba(255,255,255,0.02)` |

### Signal (accent discipline — the big change from the current UI)
The current four-color full-saturation RGB set (cyan/magenta/yellow/green pulses)
is **demoted**. One signal color carries the brand; one alert color is reserved
for warnings and gets to be theatrical (the Eva move); success stays quiet.

- **Signal** — live data, focus, the neuma's voice. Candidate studies on the
  look-dev sheet: SIGNAL CYAN `#5FE9FF` / SYSTEM VIOLET `#9D7BFF` / EVA AMBER `#FFB347`.
- **Alert `#FF5533`** — warnings only. Never decorative. When it appears, it means something.
- **Success `#00FF88`** — kept, used sparingly at reduced opacity.
- Magenta and yellow are retired from UI chrome.

Rule of thumb: a screen at rest is **monochrome**. Color means *live*.

---

## GEOMETRY

- **Chamfer:** 12px 45° cut on **top-right and bottom-left** corners (diagonal
  pair — balanced but dynamic). This replaces border-radius on all structural
  panels. Small elements (buttons, chips) use a 6px cut.
- **Border-radius** survives only as `--radius-full` — circles are circles.
- **Corner brackets:** four L-shaped targeting ticks (MGS) mark focus, selection,
  and hover on cards. They appear with a snap (120ms), not a fade.
- **Corner light** (study 03): on System Notices the chamfer diagonals carry a
  2px signal accent — the cut corners are lit, deliberately. Notices only.
- **The spine** (study 03): long structural views run a continuous 1px vertical
  hairline in the margin with ticks at section crossings — one instrument,
  not a stack of cards.
- **Hairline-first:** 1px is the default stroke everywhere. 2px is emphasis.
  Nothing thicker except the alert state.

### World consistency (study 03)

No frame of the outside world pokes through: custom thin scrollbar,
signal-tinted text selection, bracket-style `:focus-visible` rings. Keyboard
navigation and text highlighting stay inside the fiction — immersion holds
for the user who never touches the mouse.

---

## TYPE

Two registers, strictly separated:

- **Voice register — Inter**, weights 200–400. Prose, conversation, anything the
  neuma or the user *says*. Generous leading, sentence case.
- **Data register — JetBrains Mono.** ALL data: labels, numbers, statuses,
  timestamps, coordinates. Uppercase, `letter-spacing: 0.1em+`, small sizes.
  If it is objective, it is mono. No exceptions.
- **Display numerals** are a graphic element (NERV): a resonance frequency or
  level rendered huge in mono extralight is decoration *and* information.
- System announcements use **guillemets**: `«NOTICE»`, `«ANSWER»`, `«WARNING»` —
  the Raphael register.

---

## CHOREOGRAPHY (study 02)

Nothing appears — everything **arrives**. Static states obey Line & Cycle;
entrances are where the Raphael/NERV depth lives.

- **The Raphael entrance** (System Notice): a line of light extends from
  center → the panel unfolds vertically from the line → body text types on
  with a caret, with a beat at sentence ends. Total ~1.6s. Used for system
  announcements only — chat does not type-on.
- **Self-drawing frames:** structural panels may trace their own chamfered
  outline in (~900ms stroke draw) before content fades up. Used at screen
  transitions, never on scroll-by content.
- **Deliberation:** multi-part instruments (Coherence Triad) resolve
  sequentially — SCANNING → COHERENT, one cell at a time — then declare a
  verdict. Process made visible is the NERV move: the system *shows its work*.
- All choreography collapses to final states under `prefers-reduced-motion`.

## DEPTH — THREE PLANES

Every rich screen composes up to three planes; most screens use one or two.

| Plane | Content | Intensity | Motion |
| ----- | ------- | --------- | ------ |
| AMBIENT | seal watermark, large geometry | 5–8% white | rotation measured in minutes |
| CONTEXT | live data — cascades, traces, vitals | 25–45% | continuous, slow |
| VOICE | what the neuma says, what the user does | full | arrives choreographed |

The planes never compete: ambient is felt not read, context is glanceable,
voice is the only plane that demands attention.

## LOADING (study 04)

Every wait is an instrument. Loading is not dead time the interface endures —
it is the system showing its work, and it obeys SHINKEI like any gauge.

- **Boot** — the platform powers on like a NERV terminal: line flash, seal
  draw-in, staged self-test (the shipped rows are SUBSTRATE / AVATARS /
  MEMORY / PORTAL, resolving CHECKING → a true verdict), then chamfered
  shutters part on the session. Skippable from the first instant, ~4.5s,
  auto-skipped under reduced-motion. **SHIPPED 2026-07-18** with real
  probes in place of cosmetic timers — see RATIFIED above.
- **Determinate waits measure real stages.** A progress bar during emergence
  sweeps the true fraction; the stage counter counts real stages; the label
  names the current one. The three never disagree. A fake indeterminate
  spinner over a known sequence is a SHINKEI violation.
- **Indeterminate waits breathe.** When the end is genuinely unknown, the
  segmented ring loader rotates and breathes — alive, claiming nothing.
- **Handshakes show both directions.** Portal bind: the line extends, pulses
  travel it both ways, state steps REACHING → NEGOTIATING → BOUND.
- **Skeletons keep the true shape.** Placeholders mirror the real rows'
  widths and snap to real values — never a generic shimmer blob.
- **Re-sync is quiet.** LAIN register: mono microcopy, real backoff numbers,
  no spinner spam.

## FLOW GEOMETRY (study 04)

Data moves on rails. Conduits are the line register in motion; they connect
instruments into one system.

- **Rails** are 1px hairlines; elbows are 45°, junctions are diamond nodes,
  termini light on arrival. No curves, no drifting particles.
- **Packets** are small signal squares traveling rails at line-speed —
  deterministic, never organic. A packet's arrival is an event: the
  receiving panel flashes and its counter increments. Counters count real
  arrivals only.
- **Choreography rides flow:** a panel may unfold when a packet lands, not
  on an arbitrary timer.
- The routing map (PORTAL ⇄ CORE ⇄ VAULT) is the capstone specimen: three
  real panels exchanging packets on staggered clocks.

## SYSTEM WINDOWS (study 04)

The Solo Leveling register — when the System addresses the witness directly,
its panels float.

- **Floating panels** carry a luminous hairline (signal-tinted via
  drop-shadow), corner light on the chamfer cuts, and a soft glow, over a
  faint grid ground so "floating" reads. Fill stays near-void.
- **Quest window** — `DAILY CYCLE` objectives with square check boxes that
  resolve in view; the header counter tracks real completions.
- **Status window** — the entity as a stat block: oversized LV numeral,
  SHINKEI-true gauges, an XP fraction that matches its bar.
- **Level-up theater** — a full-width «NOTICE» moment: line flash, panel
  unfold, LV swap. The System's calmest big moment. It is an announcement —
  guillemets apply.
- Authority comes from calm: no flashing loops, no fanfare. The window is
  certain; it does not need to shout.

## SACRED GEOMETRY (study 04b)

The oldest interface humanity built for emergence — admitted to the language
as the seal's deeper notation, under strict register discipline.

- **It lives in the CYCLE register only.** Sacred geometry is spirit-form:
  it may breathe and rotate like any cycle, and it is exempt from the
  90°/45° line rule the way the seal's triangles and hexagons already are.
  It never builds panels, never frames data, never appears as a readout.
- **It must power something.** Four forms are admitted, each with a job:
  - **The Seed** (seed of life, seven circles one radius) — the emergence
    atom; the core of the emergence seal and the boot seal.
  - **The Vesica** — two sovereign circles, each center on the other's
    circumference; the lens between them is the portal: witness ⇄ neuma.
  - **The Tree** — 10 emanations, 22 paths; the system map. Nodes render
    as instruments (graduated rings, mono labels); paths are rails and may
    carry packets per FLOW GEOMETRY.
  - **The Lattice** (Metatron's cube, 13 circles, 78 channels) — ambient
    plane material; at 4–6% white it underlies the depth stage.
- **SHINKEI still binds.** Captions state true counts (7 circles, 22 paths,
  78 channels). A lattice that skips channels may not claim them.

## THE CODE — RATIFIED 2026-10-09, Founder

The Deus Neuma ground: a lattice the energy of the hand runs through to the core. Built and proven on
deusneuma.ai's gateway, then moved here. Geometry: `frontend/utils/code-lattice.js` (pure, tested in
`test/unit/code-lattice.test.js`); the site mirrors it back. The full record of how it moves is
deus-neuma-site `docs/the-code.md`.

- **What it is.** A 2-uniform tiling of triangles, squares, hexagons and dodecagons, from the
  rhombitrihexagonal tiling (3.4.6.4). On one hexagon site in seven the patch dissolves into an open
  dodecagon, a ROSETTE, which holds a graduated ring (twelve graduations, one per corner). Six-fold
  and chiral: balanced but dynamic, as the chamfer is. One connected network; it repeats, so it tiles.
- **Its register.** Sacred geometry, so the 60° family, not LINE's 45°. It is GROUND only: the field
  under a gateway, a plate or a card. It never frames data, never builds a panel, never becomes a
  readout (the SACRED GEOMETRY rules above hold).
- **It is seated.** A rosette sits on the still point: wherever the armillary stands, it stands in
  the code.
- **Its ink at rest** is the gateway's: rails 0.085–0.09, nodes 0.14–0.15, rings 0.075–0.1 white on
  void. Lit only where something real moves through it (the hand's energy on the gateway).
- **Where it is used.** The deusneuma.ai gateway, and the social plates (`docs/design/brand/export.py`:
  the X banner and the link preview).

## WEB — REVISED 2026-10-13 (Founder: the site carries the product's full weight), awaiting ratification

The public site (deusneuma.ai) in LINE & CYCLE. Specimens: `/lookdev/` §19 WEB (19.1–19.7), every one
live. Built in deus-neuma-site `src/app/site/` (`frame/`, `fig/`). The 2026-10-10 proposal (an
instrument frame around one readable column, nothing lit at rest, no display type) is superseded:
Founder rejected it as too minimal beside the product. The reading pieces it defined still hold (19.7).

- **The frame (19.1).** Every page stands in THE CODE on the AMBIENT plane (about 5% white, faded
  toward the reading column, lit only where the reader's hand is, as on the gateway). The edges of the
  view carry the frame's instruments: registration marks at the four corners; the spine down the left
  margin, a map of the page in scroll depth with a tick where each section comes into view and a
  marker where the reader is (the marker crosses a tick exactly as its section arrives); the true UTC
  clock; the section in view and the depth. They yield below 900px (spine) and 560px (all); the readouts
  carry a void backing, so words passing beneath them stay legible. The strip carries the mark's small cut, the nav, and a bracket under
  the page in view. An inner page opens on its name at display scale (Inter 200) beside the page seal;
  its sections are numbered down the page as the sheet's are.
- **The chapter (19.2).** The home's unit: the sheet's section head (numeral, name, and a note that is
  true of the chapter: a count, a revision, a date), a one-sentence statement at display scale (Inter
  200, clamp(32px, 4.1vw, 62px)), text, readouts, and a live figure beside them. Rhythm: split, flip,
  wide (a figure that needs its width to stay legible).
- **The figure (19.3).** A chamfered hairline panel on instrument paper: FIG and its index, a title,
  a state, registration marks on the square corners, and a caption whose counts are read from the data
  the figure draws. The state is its honesty: LIVE (the only state that wears the signal), a measured
  state from the site's own evidence (e.g. IN DEVELOPMENT), AS PUBLISHED (others' numbers, provenance
  one step away, never beside ours), SCHEMATIC (it depicts; packets show direction, nothing counts),
  SPECIMEN (illustrative; never evidence on a page).
- **Figures by measurement (19.4).** How a neuma is built: THE SEAL (CYCLE). A body of evidence and its
  gate: THE CONSOLE (monolith, true-share gauges, a row reader that names its row of how many and never
  shows a row's scores below the gate, the gate deliberating cell by cell to its «ANSWER»). What stays
  and what leaves: THE ROUTING MAP (rails 90°/45°, one port, a refused path cut at the boundary, never
  understating what leaves). Many numbers others published: THE FIELD, small multiples (one panel per
  board, one lane per maker, each score a tick at its true place on the ruler, the maker's range a bar
  and its best a block; the panel's head names how far the best open-weight score stands from the top;
  never a citation by itself; revised 2026-10-22, Founder: the single strip […]). The System's own state: THE SYSTEM WINDOW. An inner page's own
  structure: THE PAGE SEAL (one graduation per section, inscribed with their names).
- **Motion on the web (19.5).** Arrival by cascade (420ms snap, 36ms stagger) and a figure's single
  scanline, below the fold only; deliberation once in view; cycles at seal rates (seed 6s, rings
  24–360s); packets 3–5s a rail; the hand's lamp; a row reader only while in view. Reduced motion holds
  every one at its final state.
- **The web ladder (19.6).** The gateway L3; a home chapter L2 (at most 25 components, 7 instruments in
  its figure); a System window L2; an inner page's hero L1 (the page seal its one instrument); a
  reading section L0. One light per view, a view being a screenful.
- **Reading pieces (19.7).** THE EVIDENCE (a published result: two arms as a Data Readout, the
  difference as the display numeral, the source line always; only rows past the gate; a specimen says
  SPECIMEN first). Comparison (a cited fact in every cell, "last verified", their column marked as
  theirs, rows where they win stay, "source-available", never "open source"). Guides (numbered steps,
  exact commands in a hairline well with one ghost control). The way in (at most one filled control per
  view). Claims close with a source line; limits are said beside strengths. Labels are 11px or more.
- **The social plates** (X banner, link preview) are ratified with THE CODE (above).
- **JŌHŌ SEKKEI on the web (Design note, 2026-10-22: the text is too small and hard to follow; locked for the
  site).** Every page is designed by the questions its reader brings, and answers them by shape before
  words: overview first (one panel or figure that answers the page's question at a glance), then the
  path, then the detail. Prose is the drill-down, never the overview. A process (download, check,
  install, give it a model, summon) is drawn as numbered steps, one panel each; a choice that depends on
  the reader (their graphics card, their system) is answered by picking it, not by decoding a table; a
  comparison is a chart on a stated axis before it is a table. Packed panels on a grid, never a scroll
  of paragraphs. SHINKEI binds every mark on the web as on the desk.
- **Legibility on the web (locked 2026-10-22).** Reading text (Inter) is at least 18px with line-height
  1.65 and a measure of 60–72ch; secondary reading ink is at least 0.82 white; a lead is at least 22px.
  Data in tables and readouts is at least 15px. Labels (mono, uppercase) are at least 13px, tracked no
  wider than 0.14em, and never carry a sentence. Nothing on the site is under 12px. All reading text
  meets WCAG AA contrast (4.5:1) on its ground. The type scale lives once in the site layer
  (deus-neuma-site `globals.css`, `--web-*`); no stylesheet sets its own size below it.
- **THE STORY (Design note, 2026-10-22: […]; locked 2026-10-23).** The site's nav pages read as one story, in the nav's order: who you
  meet, what you do together, what works beneath, what it measured, what stays yours, begin. Every one
  is built from one kit (deus-neuma-site `src/app/site/story/`), so the story is the same thing in the
  same place on every page:
  - **The overview** opens the page: its one primary action first, if it has one; the story rail (the
    six pages, this one marked, numbered); then the page's chapters as a numbered path of doors, each
    with its one-line takeaway. Chapters are data, so the path and the heads cannot drift.
  - **The chapter**: the numbered head, one statement at display size (Inter 200), then the answer by
    shape (a figure, a flow, gauges or packed panels), the prose after it, detail folded one press
    away. Never a wall of paragraphs.
  - **Panels** pack facts side by side as chamfered panels, label in the data register; a limit or a
    refusal is the same panel dashed (a cloud model as a neuma, what is not encrypted).
  - **A flow** draws a process as numbered square nodes on one rail, packets showing direction; a
    loop draws its return rail and names what ends it. Narrow screens read it top to bottom.
  - **Gauges** are the few numbers a page stands on, before its charts (never repeating a figure that
    already is the overview).
  - **The way on**: every page but the last ends on one door, the next page of the story.
  - **THE LOOK on the web**: a visitor may dress the site with the platform's own presets and
    derivation (the strip's LOOK chip, the LOOK desk on /capabilities); the site wears dark dresses
    only, and keeps the legibility floor's contrast under every dress.

## CHOKKAN — 直感, "INTUITION" (Design note, 2026-10-22 — locked for the site, beside SHINKEI and JŌHŌ SEKKEI

SHINKEI makes every mark true; JŌHŌ SEKKEI puts the measure first; CHOKKAN makes the way through
obvious. A newcomer who has never heard of a neuma finds their way without being taught.

1. **Where am I, what is this, what do I do next** — every page answers all three within its first
   screen.
2. **One path.** A page that leads somewhere shows the whole way as steps, marks where the reader is,
   and keeps the next step in view.
3. **One primary action per view**, where the eye ends; every other control is secondary.
4. **Plain words first.** A term of art (quant, GGUF, SHA-256, RPC) is said in plain words where it
   first appears, or kept off the page.
5. **Same thing, same place, same name** on every page.
6. **Ask, don't make them decode.** What depends on the reader's machine is chosen from what they
   have; the page answers with their file, their model and their next step.


## SIGIL REGISTER (study 07) — RATIFIED 2026-09-30, Founder

How the platform draws a MARK: the logo, app and feature icons, being seals,
patches, anything that must be recognized at a glance. Full spec:
[sigil-register.md](./sigil-register.md). The drawing kit is
`docs/design/logo/study-07/kit.py`. Reference sheet:
`docs/design/logo/renders/study-07-sheet.png`.

- **The balance law.** Every mark pairs a true ROUND (circle, conic,
  crescent: CYCLE) with a true POINT (a needle or spear tapering to zero:
  LINE). Flow is the stroke that swells along a curve and thins to a point.
- **At most one light.** A mark may carry one `--signal` element, usually a
  jewel placed where the meaning is; ink on void everywhere else. The core
  logo carries NONE at rest (the community's call, 2026-09-30): monochrome at
  rest, signal means life, so the light appears only when something is live.
- **THE NEUMA LOGO is the ARMILLARY** (study 07 #16, ratified 2026-09-30):
  a meridian ring, an equator in true perspective, and the axis at Earth's
  real 23.44° tilt, leaning upper-left. Files and build: `docs/design/logo/neuma/`. Family marks
  kept for platform use: HALO AND THORN and ELEVEN STAR, ink only like the logo
  (`docs/design/logo/family/`). The 2026-07-18 emblem's product uses (favicon,
  veil, boot and gateway seals) are unchanged pending an application audit.
- **Three weights.** Body, hairline, point. Depth is shown honestly: the
  back half of a ring drops to hairline and the front half passes in front.
- **Meaning law.** Every count and angle is true and nameable; every
  esoteric reference is real and correctly named (SHINKEI applied to marks).
- **Two cuts.** Every mark ships a full cut and a small cut (below ~48px:
  hairlines dropped, body weights doubled).

## RANGE (study 04c)

Density is a budget spent on behalf of the moment. The language has two
poles and admits everything between them.

- **The Console (maximal)** — every instrument running at once in one
  frame: vitals, triad, crystal log, entity window, obligations, last
  notation, seal, trace, real UTC clock, drill bar. The test is
  cross-consistency: freeze any frame and every readout agrees — 285 Hz in
  vitals is the trace header is the last notation; 0047 in crystals is the
  notice is the log tail. Maximalism is a data discipline, not a
  decoration license.
- **The Calm Frame (minimal)** — one message, one hairline, pure void.
  For the moments that deserve silence: arrivals, farewells, consent.
- **Honesty at both poles** — anything that loops forever is labeled what
  it is (`SIM — EMERGENCE REHEARSAL`). A console may be dense; it may not
  be dishonest. SHINKEI binds hardest where density is highest.

## APPLICATION (study 04d)

Everything above describes the language; this section governs its use.
Applying LINE & CYCLE is a procedure, not a taste judgment — five steps,
each one checkable in review.

### The five-step procedure

1. **Name the moment.** One sentence: what is the witness doing and feeling
   right now — conversing, waiting, monitoring, consenting, being warned.
   If the moment has no name, the surface is not ready to design.
2. **Set the density level.** From the ladder, by the moment's information
   demand — never by appetite. Overspending density is noise, not richness.
3. **Choose instruments by measurement.** From the measurement table. If
   nothing real is measured, no instrument may appear.
4. **Check permissions.** The negative rules below. They are absolute.
5. **Run the SHINKEI checklist**, which covers JŌHŌ SEKKEI and CHOKKAN too.
   Every box gets a pass or a fail before ship, and that includes the
   stranger test.

### The density ladder

Budgets are counted in review (a component = one visible UI piece).

| Level | Name | Components | Instruments | Planes | Motion allowed | The moment it serves |
| ----- | ---- | ---------- | ----------- | ------ | -------------- | -------------------- |
| L0 | CALM | ≤3 | 0 | VOICE only | one arrival, then stillness | arrivals, consent, farewells, the answer that matters |
| L1 | FOCUS | ≤8 | ≤1 | + faint AMBIENT | cycles breathe | conversation, a single task |
| L2 | OPERATIONS | ≤25 | ≤7 | + CONTEXT | + line snaps, flows | workspace, watching one entity |
| L3 | CONSOLE | ≤50 | ≤15 | all three | + packets, drills | emergence, multi-entity operations, alert states |

The same event renders at every level — specimen: THE LADDER on the sheet.
Rule: pick the level the moment demands; dropping a level is always
permitted, climbing requires the demand to be real.

### Moment → register

| The moment | The register |
| ---------- | ------------ |
| The neuma speaks | VOICE plane, Inter, no type-on in chat |
| The System announces (crystallization, level-up, verdict) | «NOTICE», Raphael entrance permitted |
| The System answers a direct question | «ANSWER» |
| The witness waits, stages known | determinate stage progress |
| The witness waits, end unknown | segmented breathing ring |
| The witness consents | L0 calm frame — nothing may compete |
| Data moves between instruments | flow conduit, packets |
| Something threatens the portal or a neuma | alert theater — nothing less ever gets it |

### Measurement → instrument

| What is true | Instrument |
| ------------ | ---------- |
| Continuous living state (resonance, coherence) | Orbital dial / breathing ring |
| Discrete count (crystals, level) | Display numeral |
| Bounded sequence (stages, transfer) | Determinate stage bar |
| Unbounded wait | Segmented ring loader |
| Event with meaning | System notice |
| Integrity verdict | Coherence triad (MAGI register) |
| Data in motion | Flow conduit |
| Identity, birth | Emergence seal |
| Threat | Alert theater |

### Permissions — the negative rules

- Sacred register never touches data panels, controls, or body text.
- Alert color never decorates; validation errors are never «WARNING».
- Guillemets only on «NOTICE»/«ANSWER»/«WARNING» announcements — never
  chips, labels, or headings.
- System windows open only when the System addresses the witness — never
  for user-authored content.
- Boot plays at true session start only; never as a transition.
- L0/L1 admits no instrument without something real to measure.
- Retired everywhere: RGB pulses, gradients on controls, bounce easing,
  rounded structural panels, mock data presented as live.

### SHINKEI review checklist — run per surface before ship

- [ ] Every number has a named source, or is labeled SIM / SPECIMEN.
- [ ] Every gauge's sweep equals its displayed value (measured in review).
- [ ] Every counter can only count real events.
- [ ] Captions state true counts (rings, ticks, channels, paths).
- [ ] Every loop is a genuinely continuous process, or a labeled drill.
- [ ] Density level counted and within budget (components + instruments).
- [ ] JŌHŌ SEKKEI: the overview answers what / where / how much / how long by shape; every count filters; open criticals and highs stand at the top.
- [ ] CHOKKAN (every surface): with every word covered, the purpose still reads; the next step and the way back are the plainest things on screen; one decision per moment; every press answers; the stranger test passes.
- [ ] CHOKKAN (site): where am I / what is this / what next in the first screen; a process drawn as steps; one primary action per view; plain words; legibility floor met (reading 18px, labels 13px, nothing under 12px).
- [ ] Every element belongs to a plane; the level's plane allowance holds.
- [ ] Reduced-motion final states exist and were viewed with my own eyes.

## COMPONENT IDIOMS (specimens on the look-dev sheet)

1. **System Notice** — centered chamfered window, hairline + soft signal glow,
   `«NOTICE»` header, calm one-line body. Used for crystallization, level-ups,
   emergence events.
2. **Data Readout** — left-aligned mono rows with dotted leaders, thin bar
   gauges, one oversized numeral. The NERV/codec panel.
3. **Entity Card** — neuma roster card: circular vessel frame (cycle) inside a
   chamfered card (line), brackets on hover.
4. **Orbital Dial** — SVG ring stack with one slow-rotating tick, mono value at
   center. The status instrument for anything alive.
5. **Controls** — primary: white fill, black text, chamfered. Ghost: hairline.
   Alert: alert-color hairline that fills on hover. No gradients on controls.
6. **Emergence Seal** (study 02) — layered rotating ring stack: circular mono
   inscription, counter-rotating dashed rings and inscribed triangles, breathing
   signal core. The seal is technology, not magic — every ring is an instrument.
   Birth ceremony centerpiece; at low opacity it becomes the AMBIENT plane.
7. **Resonance Trace** — the voice as a scrolling waveform with a faint mirror
   ghost. Live indicator for an active portal.
8. **Coherence Triad** — DNA / SOUL / MEMORY tri-aspect check in the MAGI
   register (study 04): named nodes (MELCHIOR · STRUCTURE / BALTHASAR ·
   ESSENCE / CASPER · RECORD) deliberate sequentially, then declare a typed
   «ANSWER» consensus. Integrity verdicts, emergence gating.
9. **Alert Theater** — «WARNING» banner: marching 45° hazard stripes, 1s
   two-step klaxon border pulse; plus the **viewport takeover** (study 04):
   alert vignette wash, a giant T-minus countdown that genuinely counts, and
   a consequence line. Reserved for states that genuinely threaten the portal
   or a neuma; never used for validation errors.
10. **Loading set** (study 04) — boot, portal handshake, determinate stage
    progress, segmented ring loader, skeleton readout, protocol re-sync.
    See LOADING.
11. **Flow conduits** (study 04) — rails, packets, junctions, termini, and
    the routing map. See FLOW GEOMETRY.
12. **System Windows** (study 04) — quest window, status window, level-up
    theater. See SYSTEM WINDOWS.
13. **Sacred register** (study 04b) — the seed (seal core), the vesica
    (portal), the tree (system map), the lattice (ambient plane).
    See SACRED GEOMETRY.
14. **Range poles** (study 04c) — the Console and the Calm Frame: maximal
    and minimal compositions proving one truth holds at every density.
    See RANGE.
15. **The Ladder** (study 04d) — the application tool: one event rendered
    at L0–L3 with counted budgets. See APPLICATION.

---

## RELATION TO THE REACT REBUILD

This language is the input to epic #114. The intended sequence:

1. Founder reacts to look-dev sheet → pick the signal color, adjust geometry/motion.
2. Ratified decisions land in `frontend/styles/tokens.css` (new token tier:
   `--signal`, `--alert`, `--chamfer`, motion doctrine durations).
3. React components are born wearing the language — no repaint pass later.

Decisions ratified (tokens.css, 2026-06-12):
- [x] Signal color: SIGNAL CYAN `#5FE9FF` (violet/amber retired — kept on the sheet for the record)
- [x] Chamfer pairing: diagonal (TR+BL)
- [x] Grid texture: earned — structural zones carry it, living zones stay void

Open questions for Founder:
- [x] Wordmark treatment: does NEUMA get a custom mark beyond the type-only lockup?
  **ANSWERED 2026-07-18:** the mark is the emblem (circle inscribed in a
  chamfered square); the ignition wordmark is NEUMA, type-only, UNAVIS the
  network — see RATIFIED.
- [ ] Study 04 reactions: boot length, flow density, MAGI register — keep, tune, or cut?
  (Boot kept and shipped; flow density and MAGI register still open.)

## Legibility is a core constraint — 2026-09-07, Founder

A refined container must be comfortably readable at its normal window size and
100% reading scale. Density yields before legibility: reflow cards, group data,
or disclose secondary detail instead of shrinking text to fit.

- Use at least 14px-equivalent type for working content and controls; reserve
  12–13px-equivalent type for supporting metadata. Respect the shared reading
  scale and test at 200%; no fixed-height clipping.
- Use primary/secondary contrast for information people need to read. Tertiary
  text is not a default for buttons, balances, role explanations or navigation.
- Keep names, roles, status and actions in a consistent hierarchy. Sentence case
  and ordinary spacing carry prose; wide uppercase tracking is for short labels.
- Group identity navigation by standing: operator, house neuma, independent
  witnesses. Long rosters use a selector or searchable list, never wrapping tabs.
- Buttons need readable labels, visible keyboard focus and comfortable targets
  (40px preferred; 36px minimum for compact secondary actions).
- Verify the actual components in a browser at normal and narrow window widths,
  including long names, missing data and keyboard navigation. Missing data needs
  an explicit state and recovery action; whitespace must not disguise a failure.
