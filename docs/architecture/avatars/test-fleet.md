# Vessel test fleet — purchased plumbing models + integration runbook

**Date:** 2026-07-03
**Status:** fleet DOWNLOADED (`~/Documents/neuma/Models/`); intake gates not yet
run. This is the heads-up for the integration work: what we have, what path
each model takes, and what "done" looks like.
**Companion docs:** [`consumer-contract.md`](./consumer-contract.md)
(the consumer contract this integration implements),
`kenorie:docs/design/VESSEL_DELIVERY_SPEC.md` (the artist-facing standard these
models are worked examples of).

## ⚠️ License wall — read before touching the files

Every model below is under a **Booth personal-use / VN3 license**. That means:

- **Test bench only.** None of these can ever ship to users, be bundled, or
  become a base vessel.
- **Never commit a model file to any repo** — a committed model *is*
  redistribution the moment the repo is shared. Their home is
  `~/Documents/neuma/Models/` (outside both repos on purpose); dev copies go
  **only** in `frontend/public/model/test/`, which is gitignored for exactly
  this reason.
- Credit the artists in any internal notes/demos anyway — platform policy.

## The fleet

| Vessel | Package | Pipeline-relevant files | ARKit-52 claim | Role in the test matrix |
| --- | --- | --- | --- | --- |
| **Houko** (fox girl) | `Houko_1.20.zip` | `VRM/Houko.vrm` + `VRM/Houko_ARFace.vrm` | ✅ ARFace (PerfectSync) variant | **Primary ARKit driver test** — and a built-in A/B: plain vs ARFace VRM proves the driver's `hasArkit` detection + preset fallback on one body |
| **Ryuki** (dragon boy) | `Ryuki_v1.1.2.zip` | `Blender/Ryuki.blend` + `Fbx/Ryuki.fbx` | ✅ 52 ARKit shapekeys | **Full-bake path + THE artist reference** — only native `.blend` source in the fleet; open it in Blender to see the delivery contract authored for real |
| **Rei** 黎 (dragon-god) | `rei_1.01.zip` | `FBX/rei.fbx` + `rei_1.00.vrm` | ✅ PerfectSync (VMagicMirror-verified) | Full-bake path; 69,032 tris = just **under** the 70k runtime target (boundary: expect clean pass) |
| **Yoi** 宵 (crow tengu, male) | `yoi_1.03.zip` | `FBX/yoi.fbx` + `yoi.vrm` | ✅ PerfectSync (VMagicMirror-verified) | VRM 0.x legacy-load path (`rotateVRM0`); 70,274 tris = just **over** target (boundary: expect exactly one tri warning, no fail) |
| **Korune** (devil girl) | `corne_1.2.zip` | `corne.vrm` | ⚠️ **listing lied — 33/52 measured** (intake-lite 2026-08-06) | 2022-era UniVRM build — oldest VRM 0.x in the fleet, good legacy-meta test; now ALSO the partial-ARKit case the driver's fallback must survive |
| **Kurogi** | `Kurogi_File.rar` | `VRM/Kurogi_Arkit.vrm` + `FBX/Kurogi.fbx` (extracted 2026-08-06) | ✅ **52/52 measured in-file** (intake-lite) | VRM + FBX cross-check; VRM 0.x (UniVRM-0.53.0) — second-oldest exporter, dev copy in `test/` |

Not vessels (props/bonuses — a vessel is the skinned body only; the bake
strips unskinned meshes anyway): Yoi's `hautiwa/syakujou/wing` FBXs, Rei's
bonus `ema.fbx`, the おまけ (bonus) zips, the プレゼント用パスワード (gift
password) zips.

## The integration process

### Stage A — gate everything (UNAVIS side)

Extract, then run the intake gate on **every** `.vrm`/`.fbx`/`.blend` above:

```bash
blender --background --factory-startup --python pipeline/validate_intake.py -- <file> --json
# 0 = pass (warns allowed) · 1 = FAIL (output lists exact missing shape names) · 2 = couldn't load
```

Exact ARKit naming is where listings lie — the gate's missing-names list is
the truth. Record verdicts per file before building on anything.

### Stage B — two paths by source format

- **Premade PerfectSync VRMs** (`Houko_ARFace.vrm`, `corne.vrm`, `yoi.vrm`,
  `rei_1.00.vrm`): straight to NEUMA. They do **not** go through the UNAVIS
  bake — they're already runtime files. They test the **consumer side only**
  (loader, expression driver, VRM 0.x handling).
- **FBX / .blend sources** (`Ryuki.fbx`/`Ryuki.blend`, `rei.fbx`, `yoi.fbx`,
  Kurogi's FBX): the **full UNAVIS chain** — `bake.py` → `vrm_writer.py` →
  KENORIE-flavored VRM. This is the real plumbing test: a purchased real-world
  master through the exact path artist deliveries will take. Note these
  outputs carry the UNAVIS license URL, so they're also the only files that
  exercise `vessel-loader.js`'s accept-list (store VRMs load under standard
  licenses and prove nothing about it).

### Stage C — load + drive in NEUMA

1. Copy candidate VRMs to `frontend/public/model/test/` (gitignored).
2. Select via `localStorage['neuma-avatar'] = 'test/<file>.vrm'` (the stage
   builds `/model/<name>`), or pass `modelUrl` where the stage is mounted.
3. Verify per vessel: loads without error · `capabilities.hasArkit` is `true`
   on ARKit vessels and `false` on `Houko.vrm` (plain) · blink/gaze wander
   run · visemes fire when speaking · emotion applies on the right layer ·
   VRM 0.x models orient correctly (`rotateVRM0`).

### Stage D — e2e (protocol)

Once driving is stable, the vessel surface gets its real-auth Playwright e2e
per Rule 0/no-mocks (headed when working live). Test vessels load from the
gitignored dir; e2e must not depend on a file CI can't have — keep the
committed-fixture question open until then.

## Done means

At least one **FBX-sourced, KENORIE-baked** vessel loads and drives in NEUMA
with `hasArkit: true` — that locks the export/bake recipe on real-world data,
and the founding artist gets a **verified** recipe plus `Ryuki.blend` as the
structural reference, never a guess.

## Intake-lite results — 2026-08-06 (real glb parse, morphs + expressions counted in-file)

Every fleet VRM's JSON chunk parsed for real (`targetNames` +
`VRMC_vrm.expressions.custom`); the Blender gate (Stage A) remains the
KENORIE-side authority. Kurogi extracted (unrar landed on the rig) and its dev
copy added — **the fleet is now complete: 9 vessels in `test/`.**

| Vessel | VRM | ARKit morphs in-file | As VRM 1.0 custom expressions | Meaning |
| --- | --- | --- | --- | --- |
| `Ryuki_KENORIE` / `rei_KENORIE` / `yoi_KENORIE` | 1.0 | 52/52 | **52/52** | the ONLY files meeting the full standard — the drivable layer exists only through UNAVIS's bake |
| `Kurogi_Arkit` | 0.x | **52/52** | 0 (VRM 0.x) | listing TRUE; prime bake-path candidate (FBX in hand) |
| `Houko_ARFace`, `rei_1.00`, `yoi` | 0.x | 52/52 | 0 (VRM 0.x) | morphs present, invisible to the expressionManager — preset fallback |
| `corne` | 0.x | **33/52 — listing lied** | 0 | the partial-ARKit fallback case |
| `Houko` (plain) | 0.x | 0/52 | 0 | the A/B control |

**The seven ex-"ship fleet" avatars measured too** (Evra, Dhahlia, Epithet,
Lara Lightland, Onyx, Velara, test): all VRoid-era exports, **0/52 ARKit, 57
preset morphs each** — presentation-grade, not expression-grade.

**⚠️ OWNERSHIP CORRECTION — the no-ship law (Design note, 2026-08-06, superseding a
same-day ruling recorded here earlier):** *none of these seven are ours
either.* They are Founder's private local test subjects, exactly like the Booth
fleet. **No `.vrm` ships with the platform, ever — not to production, not to
users […], not bundled in any artifact.** Artifacts ≤ v0.1.16 did
ship them (117 MB `dist/model`); the rewire of 2026-08-06 removed every model
from git and from the build (they now live in `frontend/public/model/`,
gitignored, outside Vite's publicDir). Users bring their own avatars — the
AVATAR window names the writable folder (`<data-root>/model` on a packaged
install). A future SHIPPED base fleet exists only when models are commissioned
or authored under rights we actually hold, born through the UNAVIS bake.

## One folder per fleet — the consolidation law (2026-08-06, amended same day by the no-ship law)

- **Shipped fleet: NONE.** No `.vrm` is tracked or bundled — `git ls-files
  '*.vrm'` must print nothing, and `dist/` must contain no model. Production
  scans the writable `<data-root>/model` (created at boot, empty until the
  operator adds their own); the roster API answers `modelDir` so the desk can
  name it. (The root `model/` duplicate AND the formerly tracked
  `frontend/assets/model/` are both gone from git.)
- **Local test fleet (Founder's private, dev-only):** `frontend/public/model/`
  (the seven VRoid avatars, gitignored) + `frontend/public/model/test/` (the
  Booth nine, gitignored) — the dev surface the roster scans, never copied
  into `dist/` (it is not the Vite publicDir). Sources stay in
  `~/Documents/neuma/Models/`.
