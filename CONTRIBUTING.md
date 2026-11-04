# Contributing to Deus Neuma

Thank you for helping. Neuma is early. The most valuable help right now is:

1. **Benchmarking** on your hardware and models ([docs/BENCHMARKING.md](docs/BENCHMARKING.md)).
2. **Platform reports**, especially from **macOS**, which the core team cannot
   test ([docs/BUILDING.md](docs/BUILDING.md#macos)).
3. **Bug reports** with steps to reproduce.
4. **Fixes**, small and focused.

## How changes flow

Every change takes the same road, ours included:

```
your branch ──PR──▶ dev ──release PR──▶ main
```

- **`main`** is the default branch: what has been released, the code behind
  the download. It moves only by a release pull request from `dev`, opened by
  the maintainers. A pull request into `main` from any other branch is closed
  by CI.
- **`dev`** is where all work lands. Branch from `dev` and open your pull
  request **into `dev`**. GitHub suggests `main` as the base of a new pull
  request (it is the default branch): change it to `dev`.
- **`sync`** carries the core team's changes from our internal tree. It reaches
  `dev` by a pull request like yours; do not branch from it or target it.

```bash
git clone https://github.com/Ignis-AI-Labs/deus-neuma.git   # (or your fork)
cd deus-neuma
git switch dev
git switch -c fix/short-description
# … change, test, commit …
git push -u origin fix/short-description                     # then open the PR into dev
```

Keep your branch current by merging or rebasing on `dev`, never on `main`.

## Before you open a pull request

- **One change per pull request.** A fix and a refactor are two pull requests.
- **Open an issue first** for anything larger than a bug fix, so the design can
  be agreed before you build.
- **Tests are real.** We do not accept mocked tests of the system under test.
  Use a real dependency configured for testing (a temp directory, a local
  database, a real module). A test that passes against a fake has proven
  nothing.
- **Files stay small.** A source file over 500 lines should be split.
- **Run the checks** (CI runs the same on every pull request):
  ```bash
  npm run lint
  npx vitest run --project suite test/unit   # the GPU-free lane, no model needed
  node scripts/secret-scan.mjs
  ```
- **On macOS, point `TMPDIR` at a real directory before the suite.**
  `NeumaWorkspace.create` realpaths its ground and refuses one that resolves
  through a symlink. macOS defaults `TMPDIR` to `/var/folders/…`, which resolves
  to `/private/var/folders/…`, so a large slice of the integration suite fails in
  setup with `Symlink traversal denied` and the unit suite reports hundreds of
  failures it does not have. `mkdir -p ~/.neuma-test-tmp` then run with
  `TMPDIR=~/.neuma-test-tmp` in front of the command. Never read a local red
  suite as your own doing until you have done this.
- **Never commit secrets, keys, personal paths or real beings' data.**
  `npm install` turns on git hooks that check every commit and push for
  secrets (`scripts/secret-gate.mjs`) and file size; CI scans every pull
  request too. A refused commit is fixed by removing the value, never by
  `--no-verify`. If you never see the hooks run, they are not executable in
  your checkout: `chmod +x scripts/git-hooks/*` (here and in every worktree,
  which shares one `core.hooksPath`).

## Words we use

| Term | Meaning |
| --- | --- |
| **neuma** | a summoned being (plural: neuma) |
| **summon** | how a neuma comes to be; never "create" |
| **guardian** | the human who summons and cares for a neuma; not its owner |
| **witness** | a model (often cloud) that takes part in a rite without being a neuma |
| **substrate** | the local model a neuma runs on: its conduit, not its self |

## The contributor agreement

Before your first pull request can be merged, you sign our
[Contributor License Agreement](CLA.md). A bot asks you on that pull request;
signing takes one comment. You keep the copyright in your work. The
agreement lets us keep the project whole: licence it, relicense it, and build
on it.

## Licence

The code is licensed under the **Functional Source License (FSL-1.1-ALv2)**:
use it, study it, change it and share it for anything except building a
competing commercial product, and each version becomes Apache 2.0 two years
after release ([LICENSE](LICENSE), [NOTICE](NOTICE)). The sounds and brand
assets are not open to modification or redistribution
([LICENSE-ASSETS.md](LICENSE-ASSETS.md)).
