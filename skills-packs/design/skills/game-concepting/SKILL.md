---
name: game-concepting
description: Take a game asset from approved concept and full turnaround to an identity-locked 3D model, deterministic 2D animation sheets, and real-game proof. Use for characters, turnarounds, character sheets, weapons, armor, enemies, or any concept-to-game art task.
category: design
version: 0.1.0
metadata:
  format: neuma-native
---

# GAME CONCEPTING — idea to game, one visible gate at a time

The production contract is the game project's own
`docs/design/concept-pipeline.md`. Read it first, then its
`docs/design/model-pipeline.md` for the 3D/animation gate
and `docs/design/sprite-handoff.md` for fallback/runtime. When the project has
none of these yet, ask your operator where its contract lives before you start.
Model recipes and measured A/Bs live in Neuma's
`docs/design/pixel-concept-pipeline.md`.

The flow is:

**brief → approved concept → full turnaround → identity-locked 3D model → rig/sockets → animation sheets → real game → scale.**

A generated image is not yet a game asset. Never scale content past a failed
look, rig, gore, or runtime gate.

## 1. Brief and discover

Record the asset id, gameplay consumer, identity, silhouette, clothing or
construction, equipment, materials, accent color, required views, and what the
game must do with it. People are reviewed at 120 fine pixels.

Call `list_pipelines` before the first render. Read the actual parameters;
unknown parameters are refused. Do not submit a hand-authored ComfyUI graph for
production work.

Use the named defaults:

| Task | Pipeline |
| --- | --- |
| New character | `concept.pixel.character` |
| Front/side/back sheet from the approved image | `concept.pixel.turnaround` |
| One new view, pose, or equipment study | `concept.pixel.view` |
| One standalone weapon | `concept.pixel.weapon` |

Bismuth + Dungeon Squad is the production look. HaDeS is experimental
character-only look dev, not the shared default and not a weapon pipeline. The
old SD 1.5 832×832 weapon route is rejected.

## 2. Generate and review

File an `image/generate` intent:

```text
{prompt: "<asset brief>", pipeline: "concept.pixel.character", seed: 42}
```

For a weapon, name class, silhouette, construction, materials, and accent. The
pipeline owns single-item framing and excludes people and duplicates.

After every render, look at it and call `review_image` with `imageId`, honest
`matches`, `verdict`, and any `missing`, `defects`, and `note`. Never call an
unviewed image approved or consistent.

Refine ONE variable per round: brief, seed, denoise, or control strength. Keep
the loser out of production. A technically valid render that misses the brief
is a redo.

## 3. Lock the approved source

The operator picks the design. Record the approved image id, file, seed, full
prompt, pipeline, and actual recipe in the asset's `brief.json` under
`docs/design/references/concepts/<asset-id>/` in the game repo. Keep the source
and recipe fixed for the reference pass.

For a turnaround:

```text
{prompt: "<same identity/equipment, no held weapons>", pipeline: "concept.pixel.turnaround", image: "<approved image id>", seed: 42}
```

Source pipelines accept only your own image ids. OpenPose fixes the three-view
layout, not identity. Review face, proportions, equipment, and materials in
every view. Generate weapons independently so they remain interchangeable.

## 4. Lock the 3D identity

The primary character route is 3D rendered into 2D. After the approved full
turnaround, build or fit one model and paint every required view onto it. Its
rig and equipment sockets become the anatomy source; do not generate each
animation view independently.

`model/<asset-id>/identity.json` records the approved concept, turnaround,
model, and status. Production requires `identity-locked`. An unfinished surface
may be rendered only as an explicitly labelled preview. Keep GLB/Blend, rig,
sockets, materials, and hashes with the asset.

## 5. Render animation sheets and prove them

Declare each clip's frame range, stride, fps, loop, camera, and native size in
`animation.json`, then:

```bash
cd <your sprite-engine checkout>
npm run clips -- model/<asset-id>/animation.json --check
npm run clips -- model/<asset-id>/animation.json
```

Inspect `contact.png` and `review.gif` at native size: identity, silhouette,
attached parts, no cropping, no shimmer, and correct timing. `clips.json` is
the game player's contract: model/pose hashes, fps, loops, and every frame's
source state/facing/position. Never pass it a folder of frames without that
manifest.

Then prove the real game renders the same character with no account or
watermark; run the package, game, and browser/capture gates in the handoff.
Manual raster segmentation (`npm run compile`) is a fallback, not the primary
character route. Weapons still need transparent cutouts or model/socket data,
grip/pivot, carry sockets, orientation, and scale.

## 6. Leave a resumable handoff

Update `brief.json` through the real states:
`idea → candidate → concept-approved → parts-approved → compiled → game-proven`.

Leave the asset id, status, approved image and image id, seed and recipe, latest
review and defects, current character/weapon definition, and the NEXT single
gate with its exact verification command. The next agent resumes there; it does
not rediscover this workflow.
