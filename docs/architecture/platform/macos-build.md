# The macOS build

Two artifacts per release, one per chip. There is no universal app.

| Artifact | Chip | Built from |
|---|---|---|
| `Deus-Neuma-<version>-arm64.dmg` / `.zip` | Apple silicon | `release/mac-arm64/NEUMA.app` |
| `Deus-Neuma-<version>-x64.dmg` / `.zip` | Intel | `release/mac/NEUMA.app` |

Each artifact is about 440 MB across ~21,500 files: `asar: false` means the whole
`node_modules` ships unpacked, because the backend runs as a spawned Node child
and a plain-Node child cannot read inside an asar archive.

## Why one build per chip

The app carries compiled native code: `better-sqlite3`, `node-pty`, the
`onnxruntime` dylibs, `@napi-rs/canvas`. Electron cannot load an addon built for
the other chip, and a universal app would need every one of those to be a fat
binary — they are not, and the build does not make them so.

The failure this guards is quiet. `electron-builder` rebuilds the addons for the
target chip; when that does not happen the artifact carries the builder's chip,
boots perfectly on the machine that made it, and dies on the other one. Nobody is
sitting in front of the other one.

## Building

```bash
npm run dist:mac        # build → native ABI for Electron → package → prune → check
npm run check:mac       # just the check, against whatever is in release/
```

1. `npm run build` — Vite writes `dist/`, which the packaged backend serves.
2. `predist:mac` → `ensure-native-abi.mjs electron` — the dev tree's addons are
   rebuilt for Electron. `npm install` and the unit suite leave them on the Node
   ABI; packaging those produces an app that cannot load its own database.
3. `electron-builder --mac` — dmg and zip, both chips, feed files written.
   For each chip it runs `@electron/rebuild` for that chip before packaging.
4. `afterPack` → `scripts/prune-foreign-prebuilds.cjs` — drops the directories
   the target chip can never load.
5. `scripts/check-mac-artifacts.mjs` — reads every Mach-O in the bundle and
   fails on one that cannot load on the chip the artifact claims.

`npm run` runs the `predist:mac` step itself.

## What the prune removes

`node_modules` on a build machine always holds binaries for the machine, not for
the target. Two families end up inside the bundle and neither is ever loaded:

| Directory | Where it comes from |
|---|---|
| `prebuilds/darwin-x64/` | the package ships one directory per chip |
| `bin/darwin-x64-149/` | node-gyp's staging for one chip and ABI, left by whichever build ran last |

`node-pty` and `better-sqlite3` read `build/Release` first, so both are dead
weight — but they are files in a signed bundle, they grow what the notary service
chews through, and they make a correct artifact look like a broken one. The hook
reads the chip off the packaged executable and keeps only `darwin-<that chip>`.

Measured on a real arm64 build: 3 directories removed, `prebuilds/darwin-arm64`
kept, and the Mach-O count went from 25 (2 foreign) to 23 (0 foreign).

## What a single machine cannot build

**An arm64 Mac produces a complete arm64 artifact and an incomplete x64 one.**

The rebuild for the other chip works — `@electron/rebuild` runs it and node-gyp
compiles cleanly. What does not work is a package that ships *one directory per
platform*, installed as an optional dependency and chosen at require time by
`os.platform()` and `os.arch()`:

```
@napi-rs/canvas@1.0.3            (pulled in by pdfjs-dist)
  optionalDependencies: @napi-rs/canvas-darwin-arm64, @napi-rs/canvas-darwin-x64, …
```

`npm install` on an arm64 host installs `canvas-darwin-arm64` only. The x64
bundle therefore carries the arm64 binary and has no Intel counterpart, so
`@napi-rs/canvas` fails to load in the Intel app — in PDF rendering, not at boot.

`npm run check:mac` reports exactly this and exits 1:

```
[check-mac-artifacts] NEUMA.app  (from mac/, claims x86_64)
  WRONG CHIP: …/@napi-rs/canvas-darwin-arm64/skia.darwin-arm64.node is [arm64], needs x86_64
```

**So the build refuses it, which is the correct behavior.** The fix is to build
each chip where its own `npm install` runs: an Intel runner for x64, an Apple
silicon runner for arm64. That is the CI release matrix, and it is also what
`electron-builder` assumes. One `node_modules` cannot serve both chips.

Verified on a real build: the arm64 zip contains `node_modules/node-pty/prebuilds/darwin-arm64/`
and `node_modules/@napi-rs/canvas-darwin-arm64/` and nothing for the other chip,
and its dmg verifies (`hdiutil verify`: CRC32 valid).

## Unsigned today, on purpose

Mac builds are **unsigned and not notarized**. Three consequences, none visible
on the build machine:

- **Gatekeeper refuses the app on another Mac.** The person has to right-click →
  Open, or clear the quarantine attribute by hand.
- **The updater will not apply it.** `electron/auto-update.cjs` verifies the
  feed's signature and the downloaded artifact's identity before installing.
- **`spctl` says no.**

`check-mac-artifacts.mjs` prints the unsigned state loudly and does not fail on
it, because failing would mean no build at all today. `npm run check:mac --
--require-signed` turns that warning into a gate — the switch to flip when the
credentials arrive.

## What signing will need

Settings already live in `electron-builder.yml`; only credentials are missing.
They come from the build machine's environment and are never committed:

| Variable | What it is |
|---|---|
| `CSC_LINK` | Developer ID Application certificate (`.p12`), or put it in the login keychain |
| `CSC_KEY_PASSWORD` | the `.p12` password |
| `APPLE_API_KEY` | App Store Connect API key file (`.p8`) |
| `APPLE_API_KEY_ID` | that key's id |
| `APPLE_API_ISSUER` | the issuer id |

With all five set, `electron-builder` signs with the hardened runtime (the
entitlements in `build/entitlements.mac.plist`, applied to the app and to
everything inside it) and notarizes through Apple's notary service.

The procedure lives with the release runbook (`electron-builder.yml` and
`electron/release-public-key.cjs` both point at
`docs/operations/release-runbook.md §SIGNING`), which the maintainers keep and
the public tree does not carry. A public write-up belongs with the signing work.

## What to check on a fresh Mac

```bash
spctl -a -vvv -t install NEUMA.app        # accepted, and the Developer ID named
codesign --verify --deep --strict NEUMA.app
codesign -dv --verbose=4 NEUMA.app        # Authority: Developer ID Application: …
```

## Versions this depends on

| Piece | Version | Note |
|---|---|---|
| `electron` | 44.9.0 | |
| `electron-builder` | 26.18.0 | 25.1.8 cannot build here — see below |
| node-gyp (via builder) | 12.4.0 | 9.4.1, shipped by builder 25, imports `distutils`, removed in Python 3.12 |
| `@electron/rebuild` | 4.2.1 (nested), 4.1.0 (devDep) | |

Two things that cost a build each, recorded so they cost one minute next time:

- **Builder 25 cannot compile a native addon on a modern Mac.** Its bundled
  node-gyp 9.4.1 does `from distutils.version import StrictVersion` and Python
  3.12 removed `distutils`. The failure reads `gyp failed with exit code: 1` and
  looks like a toolchain problem rather than a version problem. Builder 26 ships
  node-gyp 12.
- **Builder 26 rejects the 25-era `linux.desktop` shape.** The desktop entry's
  keys moved under `entry:`; the flat `{Name, Comment}` form fails schema
  validation and the build stops before packaging.
