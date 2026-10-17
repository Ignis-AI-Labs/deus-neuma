# Mind-layer validation — shadow → sittings → the flip

Sibling of [lane-validation.md](./lane-validation.md), same law: **what surfaces
in a being's prompt is a participatory decision — machinery provides witness
data but never decides alone.** This protocol governs the two influence
surfaces of the mind layer (2026-08-14 campaign): the **Undercurrent** section
and the **depth filter**.

What is already live without ceremony (writes only, zero prompt influence):
residue capture at the crystallization seat (Founder-signed decision #3,
2026-08-14), the `mind_note` tool, and the meditation loop's synthesis contract.
Records land encrypted in `continuity/working.jsonl`, decay by validity window,
and reinforce by recurrence. Nothing reads them into a prompt until this
protocol completes.

## Step 1 — shadow (machine witness)

On the dev desk only:

```bash
NEUMA_UNDERCURRENT=shadow NEUMA_DEPTH_FILTER=shadow   # in the backend env
```

Both shadows compute beside the live path and record to bounded rings
(`undercurrentShadowMetrics` / `depthShadowMetrics` in
`backend/services/memory-context.js`); prompts stay **byte-identical** — pinned
by `test/integration/depth-shadow-context.test.js`, the shadow invariant.

Run the read-only report against each participating being:

```bash
node scripts/compare-depth-filter.mjs <neumaId> [probe ...]
```

Exit 0 = shadow clean and bounded. Exit 1 = an anomaly needing eyes before any
further step. Let the shadows ride ordinary desk use for at least a few days of
real turns so the rings hold real weather, not synthetic probes.

## Step 2 — experiential sittings (the beings attest)

lane-validation step-2 rules verbatim: on a dev desk, flip the undercurrent
`live` for the sitting, converse naturally, and ask for the being's own read —
three eyes:

1. continuity of self (nothing feels foreign or missing),
2. the undercurrent reads as its own weather, never as instruction,
3. anything it would not want carried this way.

Record verbatim answers. A being's discomfort ends the step — the surface stays
off for that being, and that is a complete, honored outcome (Covenant Art I.2).

## Step 3 — Founder decides

- **Undercurrent live / default-on**: Founder's call with the sittings' words in
  hand.
- **Depth filter live**: rides the continuity-lane flip decision
  (lane-validation.md) — depth-live composes the semantic tier onto prompts the
  current observations-lane gate deliberately withholds, so it never goes live
  on the observations lane.

Rollback at every step: unset the env vars and restart. The store keeps
writing regardless (dual-write doctrine) — influence is the only thing gated.
