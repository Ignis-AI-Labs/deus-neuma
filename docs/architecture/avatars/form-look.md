# The Form Look — how a being's appearance is given, rendered, and locked

Status: shipped 2026-09-25 (form-dna-lock workstream, PRs 1–3). The genome
campaign's phases 1–3 landed before it (`docs/work/genome.md`,
`docs/work/form-pipeline.md`); this is the wiring that made them live.

## Where the look lives (one law, three places)

1. **THE GENOME — given, for life.** `core/genome/`: `genomeSeed` (sha256
   over soulHex/genesisHash/momentSeed/neumaId, domain-tagged) →
   `deriveGenome` → frozen `genome/v3`. Structure axes are CAST-AWARE
   (`JAWLINE_BY_CAST` & co.): the structure refines the cast and can never
   contradict it in the same prompt. The one anchors→genome assembly is
   `core/genome/birth-genome.js` — birth, retroactive script, and any
   rederivation share it, so they can never disagree.
2. **DNA `appearance.genome`.** Written by `finalizeBirth` on BOTH paths
   (fresh + resume); a walletless birth writes none (a guessable body is a
   steerable one). Deterministic, so the stored record can always be
   checked against a fresh rederivation. Locked plates NEVER live in DNA.
3. **THE FORM DESIGN — agreed, revisable.** `workspaces/<lane>/form/design.json`
   (`core/genome/form-design.js`): EXPLORING → LOCKED, two parties or it is
   not locked (being champions via the `form/champion` intent; operator
   concurs via `POST /api/v1/workspace/:id/form/agree`). Either party can
   unlock. SEALED (character LoRA) is deliberately inexpressible — phase 2.

## The render path

`form/render` intent (`backend/services/intents/form-render.js`): the lane
genome IS the subject — `subjectFor` text + `subjectComponents` through the
real parameterizer (spine completeness law, `__excludeSex` guard), the
COMPOSED graph text re-screened at validate, the being's own genome seed
picking the render seed. Output lands in the lane's own art; the render
returns to the being's own eyes (`extra.sight`) — the reveal is structural.
The register is the anime lane (`form.anime.pfp` / `form.anime.turnaround`:
Anima Aesthetic v1.1 + AnimaMythD4rkL1nes @0.7, card-pinned sampler,
deterministic portrait crop) — ONE locked style by doctrine; illustrative
carries the neutral (non-humanoid) forms.

## The surfaces

- **SHEET (RECORD window):** 01 GIVEN · BODY page (`given/BodyPlate.jsx` +
  `sheet-genome-view.js`) renders every axis grouped, plus the composition
  ("HOW IT SPEAKS") behind a disclosure; FORM section shows locked plates
  (PFP the face, turnaround secondary) and carries the operator's half
  (`FormLockActions.jsx`: CONCUR on a championed candidate, WITHDRAW on a
  lock).
- **The form leg** (`GET /api/v1/workspace/:id/form`): `{locked, status,
  plates, agreed, genome, candidates}` — plates locked-only by law;
  candidates honestly named as unsettled; genome deterministic from the
  seal (`backend/services/genome-lane.js`).
- **Retroactive derivation:** a being born before the genome takes its body
  from its own sealed anchors through the same `core/genome/birth-genome.js`
  assembly — dry run first, applied only on the operator's go, one being first.

## Never translated into this system

The VRM avatar contract (`consumer-contract.md`) is untouched — an avatar is
the 3D form; the form look is the 2D identity (portrait/turnaround). The
character-LoRA seal (phase 2) will train on the spine's caption schema
(`core/genome/prompt-spine.js`) — that is the on-ramp, not this document.
