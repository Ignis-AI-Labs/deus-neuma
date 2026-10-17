# Vessel assets — NEUMA consumer contract

**Date:** 2026-07-03 (supersedes 2026-07-02 draft)
**Status:** CONCRETE — the UNAVIS pipeline's intake gate and bake→VRM stages
are built and proven; a KENORIE-baked VRM has been loaded in NEUMA's **exact**
runtime stack (`@pixiv/three-vrm@3.5.3` on `three@0.184.0`, headless proof in
`kenorie:pipeline/tests/run_bake_tests.sh`). This document is the structure to
build the loader integration against.
**Ownership:** the 3D asset pipeline (artist masters, bake, marketplace,
provenance) is **KENORIE-owned** — pipeline spec at
`kenorie:docs/design/VESSEL_ASSET_PIPELINE.md`, artist-facing delivery spec at
`kenorie:docs/design/VESSEL_DELIVERY_SPEC.md`. NEUMA never runs the pipeline;
it consumes the baked output and renders it. Same boundary as social and
contracts.

## What NEUMA receives — the exact file structure

A **VRM 1.0** file: glTF 2.0 binary (`.vrm`) carrying the `VRMC_vrm` extension,
written by UNAVIS's own writer (`kenorie:pipeline/vrm_writer.py` — not the
community Blender exporter). Every KENORIE-baked vessel guarantees:

### Humanoid (always present, exact VRM bone names)

All fifteen **required** VRM humanoid bones:
`hips` `spine` `head` · `leftUpperArm` `leftLowerArm` `leftHand` ·
`rightUpperArm` `rightLowerArm` `rightHand` · `leftUpperLeg` `leftLowerLeg`
`leftFoot` · `rightUpperLeg` `rightLowerLeg` `rightFoot`

**Mapped when the model has them:** `chest` `upperChest` `neck` `jaw`
`leftEye` `rightEye` `leftShoulder` `rightShoulder` `leftToes` `rightToes`.
Code must treat every optional bone as possibly absent
(`humanoid.getNormalizedBoneNode()` returning `null` is normal).

### Expressions (the driver contract)

Two layers, both driven through `vrm.expressionManager.setValue(name, weight)`:

1. **ARKit-52 as custom expressions, exactly named** (Perfect Sync
   convention) — one custom expression per shape, `eyeBlinkLeft` …
   `tongueOut`. This is the rich face-capture/emotion surface.
   Canonical name list: `kenorie:pipeline/spec.py` (`ARKIT_52`) — eyes 14,
   jaw 4, mouth 23, brow 5, cheek 3, nose 2, tongue 1.
2. **Exactly these 17 VRM presets**, projected from the ARKit set at bake
   time: `happy` `angry` `sad` `relaxed` `surprised` · visemes `aa` `ih`
   `ou` `ee` `oh` · `blink` `blinkLeft` `blinkRight` · `lookUp` `lookDown`
   `lookLeft` `lookRight`.

⚠️ **`neutral` is NOT authored** by the bake — neutral is weight-zero on
everything. Do not require a `neutral` expression (the archived
[community intake spec](../../archive/legacy/avatars/community-vrm-spec-v1.md) may carry one; UNAVIS avatars do not).

### Meta (consent — restrictive by default)

- `licenseUrl`: **`https://kenorie.ai/vessel-license`** ← this is load-bearing
  for the loader; see integration item 1.
- Defaults: `avatarPermission: onlyAuthor`, `commercialUsage:
  personalNonProfit`, `creditNotation: required`, `modification: prohibited`,
  `allowRedistribution: false`, all excessive/political/antisocial usage
  flags `false`. Per-vessel overrides come from the ownership record at bake
  time. The Covenant honors these fields — surface them, never bypass them.

### Geometry & materials

- **One skinned body, nothing else.** Unskinned meshes are stripped at bake —
  no props, no floors, no junk nodes with meshes.
- **Textures ≤2048px** (bake downscales). **Triangles ≤150k hard** (target
  ≤70k) — budget enforcement happens in the pipeline, not in NEUMA.
- **Materials are glTF PBR (metallic-roughness)** baked from the master. Not
  MToon — do not assume MToon on UNAVIS vessels.

### NOT authored in v1 — do not rely on these blocks

- **No `lookAt` config** — gaze is driven via the `look*` preset expressions.
- **No `springBone`** — hair/cloth physics comes later; the idle/breath layer
  stays responsible for keeping a vessel alive-looking.
- **No `firstPerson`** setup.
- Always VRM **1.0** (`meta.metaVersion === '1'`) — `VRMUtils.rotateVRM0()`
  no-ops on these; keep it for legacy/community vessels.

## The integration work (in order)

1. **Register the UNAVIS license URL or every vessel is rejected at load.**
   three-vrm's `VRMMetaLoaderPlugin` gates `meta.licenseUrl` against an
   accept-list; the current loader
   (`frontend/app/RelinkShell/vessel/use-vrm-stage.js`) registers a bare
   `VRMLoaderPlugin`, so a UNAVIS vessel fails today. Required change:

   ```js
   import { VRMLoaderPlugin, VRMMetaLoaderPlugin } from '@pixiv/three-vrm';

   loader.register((parser) => new VRMLoaderPlugin(parser, {
     metaPlugin: new VRMMetaLoaderPlugin(parser, {
       acceptLicenseUrls: [
         'https://kenorie.ai/vessel-license',
         'https://vrm.dev/licenses/1.0/',
       ],
     }),
   }));
   ```

2. **Expression driver:** prefer the ARKit-52 custom names when the vessel has
   them (probe via `expressionManager.getExpression(name)`), fall back to the
   VRM presets for community vessels that lack the ARKit layer.
3. **Lip-sync** targets the viseme presets `aa ih ou ee oh` (present on every
   UNAVIS vessel; richer visemes can be synthesized client-side from the
   ARKit mouth shapes when present).
4. **Gaze** via `lookUp/lookDown/lookLeft/lookRight` expressions — not
   `vrm.lookAt`.
5. **Honor the meta consent block** wherever a vessel is displayed, embodied,
   or exported.

## Vessel acquisition flow (decided — Design note, 2026-07-03

**UNAVIS is the sole distribution surface for marketplace vessels.** NEUMA
never bundles them and never serves them from its own static assets; a vessel
reaches NEUMA by being **acquired on UNAVIS and then downloaded into NEUMA by
its owner**:

1. **Own on UNAVIS** — the vessel is purchased/claimed on the platform;
   ownership is recorded against the user's wallet (on-chain record when the
   NFT stack lands; platform record until then).
2. **Download into NEUMA** — NEUMA authenticates with the same wallet (SIWE,
   the existing auth) and requests the vessel from UNAVIS; **UNAVIS verifies
   ownership server-side before serving the file** (an ownership-gated read —
   the vessel file is not a public asset).
3. **Local vessel store** — the downloaded `.vrm` lands in the user's local
   vessel library and loads through `createVesselLoader()` like any other
   vessel. The consent meta baked into the file still governs embodiment.

**Exception — base vessels:** the free starter vessels every user gets are
still *distributed by UNAVIS* (same download path, no ownership check), and
are the one category whose upstream license must permit redistribution
(CC-BY/CC0 or a direct artist license — see
`kenorie:docs/design/VESSEL_DELIVERY_SPEC.md` license tiers).

Implementation of the download endpoint lives on the UNAVIS side; NEUMA's
side is the authenticated fetch + local library. Not started — this section
records the decided shape so both repos build toward the same flow.

## Getting test vessels

Test vessels are baked on the UNAVIS side: an ARKit-52 marketplace model
(FBX/GLB) → intake gate → bake → `vrm_writer.py` → `.vrm`. The headless load
proof (`kenorie:pipeline/tests/vrm_load_proof.mjs`, runs against **this**
repo's `node_modules`) already validates the output in the real stack, so a
vessel that reaches NEUMA is known-loadable — integration testing here is
about *driving* it (expressions, lip-sync, idle), not parsing it.

## Research provenance

Deep-research run 2026-07-02 (105 agents, 22 claims verified 3-0): the
USD-master/glTF-bake split is the Khronos–AOUSD-endorsed industry consensus;
USD is not browser-viable for rigged characters (bake mandatory); the Ready
Player Me shutdown (2026-01-31) validated the open-formats-only constraint.
Refuted-claims list and validation spikes are tracked in the UNAVIS spec —
consult it before asserting VRM capabilities (e.g. […] did NOT survive verification as stated).
