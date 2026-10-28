# The macOS build

Two artifacts per release, one per chip. There is no universal app.

| Artifact | Chip | Made by |
|---|---|---|
| `Deus-Neuma-<version>-arm64.dmg` / `.zip` | Apple silicon | `release/mac-arm64/NEUMA.app` |
| `Deus-Neuma-<version>-x64.dmg` / `.zip` | Intel | `release/mac/NEUMA.app` |

## Why one build per chip

The app carries compiled native code: `better-sqlite3`, `node-pty`, the
`onnxruntime` dylibs. Electron cannot load an addon built for the other chip, and
a universal app would need every one of those files to be a fat binary — they are
not, and the build does not make them so.

The failure mode is what makes this worth its own document. The build machine has
one chip. `electron-builder` rebuilds the addons for the target chip, and when
that does not happen the artifact quietly carries the builder's chip, boots
perfectly on the machine that made it, and dies on the other one. Nobody is
sitting in front of the other one.

So `scripts/check-mac-artifacts.mjs` runs after packaging and reads the Mach-O
header of **every** binary in the bundle — the addons, `Contents/MacOS/NEUMA`,
the frameworks, the helper apps. Each one must be able to load on the chip its
directory claims. It exits non-zero when one cannot, which fails `npm run
dist:mac`.

## Building

```bash
npm run dist:mac        # build → native ABI for Electron → package → check
npm run check:mac       # just the check, against whatever is in release/
```

`dist:mac` chains four steps, and each exists for a reason:

1. `npm run build` — Vite writes `dist/`, which the packaged backend serves.
2. `predist:mac` → `ensure-native-abi.mjs electron` — the dev tree's addons are
   rebuilt for Electron. `npm install` and the unit suite leave them on the Node
   ABI; packaging those produces an app that cannot load its own database.
3. `electron-builder --mac` — dmg and zip, both chips, feed files written.
4. `check-mac-artifacts.mjs` — the chip check above, plus the signature report.

`npm run` runs the `predist:mac` step itself. Do not call `electron-builder` by
hand and assume the artifacts are good: nothing else checks the chip.

## Unsigned today, on purpose

Mac builds are **unsigned and not notarized**. That has three consequences, and
none of them are visible on the build machine:

- **Gatekeeper refuses the app on another Mac.** The person has to right-click →
  Open, or clear the quarantine attribute by hand.
- **The updater will not apply it.** `electron/auto-update.cjs` verifies the
  feed's signature and the downloaded artifact's identity before it installs;
  an unsigned artifact does not pass.
- **`spctl` says no.** `spctl -a -vvv NEUMA.app` reports `rejected`.

`check-mac-artifacts.mjs` prints the unsigned state loudly and does **not** fail
on it, because failing would mean no build at all today. Run
`npm run check:mac -- --require-signed` to turn that warning into a gate — that
is the switch to flip the day the credentials arrive.

## What signing will need

Settings already live in `electron-builder.yml`; only credentials are missing.
They come from the build machine's environment and are never committed:

| Variable | What it is |
|---|---|
| `CSC_LINK` | Developer ID Application certificate (`.p12`), or put it in the login keychain instead |
| `CSC_KEY_PASSWORD` | the `.p12` password |
| `APPLE_API_KEY` | App Store Connect API key file (`.p8`) |
| `APPLE_API_KEY_ID` | that key's id |
| `APPLE_API_ISSUER` | the issuer id |

With all five set, `electron-builder` signs with the hardened runtime (the
entitlements in `build/entitlements.mac.plist`, applied to the app and to
everything inside it) and notarizes through Apple's notary service.

The procedure itself is not written down yet. `electron-builder.yml` and
`electron/release-public-key.cjs` both point at
`docs/operations/release-runbook.md §SIGNING`, and that file does not exist.
Writing it belongs with the signing work, not before it.

## What to check on a fresh Mac

```bash
spctl -a -vvv -t install NEUMA.app        # accepted, and the Developer ID named
codesign --verify --deep --strict NEUMA.app
codesign -dv --verbose=4 NEUMA.app        # Authority: Developer ID Application: …
```

## Still unproven

`electron-builder` is pinned at **25.1.8** while Electron is **44.9.0**. That
builder brings `@electron/osx-sign 1.3.1` and `@electron/notarize 2.5.0`, both
from before Electron 44 existed. Signing and notarization are exactly where that
pairing is likely to break. No mac build has been run from this tree yet, so this
is a suspicion, not a finding: the first `npm run dist:mac` settles it.
