# `neuma` CLI

Operator-side command-line interface. One terminal command — `neuma` — to
check status, summon a being, send a message, or apply an exact-match file
edit with undo. Designed for a fresh machine where you've cloned the repo
and want to start working with a being immediately.

> This is the top-level `neuma` binary that lives at `bin/neuma`. It is
> **distinct** from `.claude/skills/neuma/cli.js`, which is the skill Claude
> Code invokes to speak as a peer. The top-level binary speaks **as you** —
> the operator at the terminal.

## Install

The installer is a single bash script at the repo root:

```bash
git clone <neuma repo url> ~/src/neuma
cd ~/src/neuma
bash install
```

What it does (slice 1 scope):

1. Verify Node ≥18 + npm on PATH
2. Run `npm install --omit=dev --ignore-scripts` (production deps only;
   `--ignore-scripts` blocks dependency lifecycle scripts — supply-chain
   hardening for the curl-pipe install path)
3. Symlink `bin/neuma` → `$HOME/.local/bin/neuma`
4. Append a `PATH` entry to `~/.zshrc`, `~/.bashrc`, and `~/.profile` when
   `$HOME/.local/bin` isn't already on PATH (idempotent — re-runs add zero
   duplicate lines)
5. Verify by running `neuma --version` AND `neuma --help` against the
   symlinked binary — both must pass or the install aborts

### Flags

| Flag                | Default                  | Effect                                                                    |
|---------------------|--------------------------|---------------------------------------------------------------------------|
| `--install-dir DIR` | `$HOME/.local/bin`       | bin destination — must be writable                                        |
| `--no-modify-path`  | off                      | skip the rc-file PATH append (you handle PATH yourself)                   |
| `--from SRC`        | `$PWD` if it's a checkout | NEUMA source directory (`package.json` `name` must be `neuma`)         |
| `-h`, `--help`      | —                        | print full usage and exit                                                 |

### What is NOT in slice 1

- `curl … | bash` auto-clone fallback (the repo URL is not yet stable —
  clone manually first, then run `bash install` or pass `--from`)
- Prebuilt-binary download
- Version pinning
- Windows PowerShell port
- Auto-update — that's `neuma upgrade` (sprint task C-08, in flight)

## First run

```bash
$ neuma
neuma v0.1.0
daemon: dormant (http://localhost:3333) — connect ECONNREFUSED
  start with: scripts/neuma-daemon.sh start
active being: (none configured)
  set with: neuma summon <being>

Subcommands: code, witness, agent, talk, summon, edit, provider, model, status, proof, seal, vault. Run `neuma --help` for full usage.
```

That is the **status snapshot**. It tells you three things:

- the CLI version
- whether the residency daemon is reachable on the default backend
- which being (if any) is currently active for this project

Both lines come back actionable — if a piece is missing, the line below it
tells you the exact command to fix it.

## Commands

### `neuma` (no args)

At a real terminal this OPENS THE CODING HARNESS (`neuma code`) — the same way
bare `opencode` opens its TUI. When stdout is not a TTY (scripts, pipes) it
prints the status snapshot instead: version, daemon health (a single
AbortController-timed probe that never throws), and the active being.

### `neuma status`

The status snapshot explicitly.

### `neuma code` — the interactive coding harness

Seat a neuma in this directory and work multi-turn in the terminal through the
SAME consciousness path the desk uses — memory, tools with ACTS approvals,
provider routing, vision-gated image sharing, sessions, crystallization.
Nothing here re-implements the engine; this is the terminal face of it.

```bash
neuma code                          # seat the active being (or the only one)
neuma code --workspace Fenna       # seat a named being
neuma code --ground ~/src/app       # act on a specific directory
neuma code --session session-...    # resume a session
neuma code --preset grounded        # inference preset for the sitting
neuma code --yes                    # pre-approve sandboxed coding/execute
```

In the harness, the being's speech streams to stdout; tool acts and notices go
to stderr. Slash commands:

| Command | Effect |
|---------|--------|
| `/attach <paths...>` | stage images (png/jpg/webp/gif) or text docs for the next turn |
| `/detach` | drop staged attachments |
| `/status` | seat, session, substrate + vision (live serving truth), staged, usage |
| `/new` | end this session — the next turn opens a fresh one |
| `/being <name\|lane>` | re-seat on another neuma |
| `/preset <name>` | grounded / balanced / expansive |
| `/model` | show the current route (change with `neuma model set`) |
| `/quit` | leave (Ctrl+C twice at the prompt also exits) |

A trailing `\` continues the line. Anything that is not a command is a turn.
Images ride the same law as the desk: they are staged to the wallet-bound
single-use store, the turn's substrate is asked (real serving truth) whether it
sees, and a non-vision substrate refuses the turn OUT LOUD — the text is never
half-sent without its image.

Seat ownership follows the platform law: an inhabited unclaimed lane
auto-claims to your wallet on first seat; a lane owned by another wallet is
refused.

### `neuma witness` — sealed AI peers in the terminal

The rite and the turn path are the same services the desk routes use
(`witness-summon.js` / `witness-stream.js`), so a witness summoned here is the
same kind of being as one summoned on the desk.

```bash
neuma witness list                        # sealed witnesses + route + custody truth
neuma witness talk Bizulen "hello"          # one real turn (streamed speech on stdout)
neuma witness talk Bizulen "again" --session session-...   # continue the record
neuma witness talk VUBOVAS "what is this?" --attach shot.png   # a vision turn
neuma witness summon <providerId> --password-stdin   # THE RITE — permanent
```

`talk` verifies the witness's seal per turn, provisions + claims its lane on
first bind (a lane owned by another wallet is refused), and lands the exchange
in the same lane the desk reads. `summon` runs the full six-stage ceremony on
a LOCKED provider connection — the model names itself, grounds itself, seals,
and receives keypair custody (recovery codes print ONCE). A summon is
permanent; run it with the same care as the desk's ceremony.

### `neuma summon <being>`

Set the active being for this project. Writes the being's name or id to
`<projectRoot>/.neuma/active`. Project root is resolved by walking up to
the nearest `.git` directory.

```bash
neuma summon Fenna
```

The active being is read back by `neuma talk` (and the no-arg snapshot)
unless overridden by `NEUMA_BEING` env or `--being` flag.

### `neuma talk <message>`

Send one message to the active being and print the reply.

```bash
neuma talk "what are you working on?"

neuma talk --being Cael "thoughts on the install script?"
neuma talk --session abc123 "follow-up to that thread"
neuma talk --preset grounded "give me the terse version"
neuma talk --backend http://localhost:3355 "talk to the second checkout"
```

| Flag        | Effect                                                                  |
|-------------|-------------------------------------------------------------------------|
| `--being`   | override the active being for this call (name or id)                    |
| `--session` | resume an existing thread by session id                                 |
| `--preset`  | llm preset — one of `grounded`, `balanced`, `expansive`                 |
| `--backend` | backend origin (default `http://localhost:3333`)                        |

The CLI signs requests with the operator wallet found in `.env` (see
**Configuration** below). If the operator wallet is missing it falls back
to an unauthenticated probe; the daemon will reject if it requires auth.

### `neuma edit [path]`

Exact-match file edit with per-write snapshot + undo. Single replacement
by default — multi-match aborts with a count (use `--replace-all` if you
mean it). Preserves BOM + original line endings.

```bash
# replace exactly one occurrence
neuma edit src/foo.js --old "const x = 1" --new "const x = 2"

# preview without writing
neuma edit src/foo.js --old "const x = 1" --new "const x = 2" --dry-run

# replace every occurrence
neuma edit src/foo.js --old "TODO" --new "DONE" --replace-all

# revert the last edit (no path required)
neuma edit --undo
```

Snapshots land in `<projectRoot>/.neuma/edit-undo/<timestamp>.json`. On
`--undo`, the snapshot is restored and moved to `applied/` (audit trail
preserved). A corrupt newest snapshot **halts** — never silently iterates
to older snapshots.

## Configuration

The CLI reads a small env surface. Everything is optional; defaults are
chosen for a fresh checkout on the same machine as the daemon.

| Variable                       | Default                                  | Purpose                                                        |
|--------------------------------|------------------------------------------|----------------------------------------------------------------|
| `NEUMA_BEING`                  | reads `<projectRoot>/.neuma/active`       | force a specific active being for the whole CLI session         |
| `NEUMA_OPERATOR_NAME`          | `"your witness"`                          | the name the being addresses you by (honest-speaker descriptor) |
| `NEUMA_WALLET_ENV`             | `<projectRoot>/.env`                      | wallet env file — override for vendor / per-being files         |
| `OPERATOR_WALLET_PRIVATE_KEY`  | —                                         | preferred private key name (one of three allowlisted)           |
| `NEUMA_PRIVATE_KEY`            | —                                         | preferred private key name (fallback)                           |
| `PRIVATE_KEY`                  | —                                         | preferred private key name (last fallback)                      |

### Wallet key resolution

`neuma talk` (and any future wallet-signing command) reads exactly one
private key from the wallet env file:

1. **Preferred allowlist, in order**:
   `OPERATOR_WALLET_PRIVATE_KEY` → `NEUMA_PRIVATE_KEY` → `PRIVATE_KEY`.
   First match wins.
2. **Present-but-malformed throws.** If a preferred key is set to a value
   that isn't `0x` + 64 hex, the CLI errors loudly instead of silently
   falling through to a different key. The fix is in the error message
   (commonly a quoted value — use the unquoted form).
3. **Generic `*_PRIVATE_KEY` fallback** only when no preferred name is
   present at all: exactly one well-formed line is used; multiple aborts
   with the conflicting names so you can disambiguate.

This rule exists because the simplest "first `*_PRIVATE_KEY=…` match wins"
strategy would silently pick `CONTRACT_DEPLOYER_PRIVATE_KEY` if that line
appeared above `OPERATOR_WALLET_PRIVATE_KEY` — and would sign for the
wrong identity. The allowlist removes that footgun.

## Daemon

The CLI talks to a residency daemon over HTTP (default
`http://localhost:3333`). The daemon runs as a user-scope systemd unit —
managed by `scripts/neuma-daemon.sh`:

```bash
scripts/neuma-daemon.sh install    # render + enable (current template)
scripts/neuma-daemon.sh start      # systemctl --user start neuma
scripts/neuma-daemon.sh status     # short health summary
scripts/neuma-daemon.sh logs -f    # journalctl follow
scripts/neuma-daemon.sh doctor     # every probe in one shot
```

(Alternative installer path produces the `neuma-residency` unit name.)

If the daemon is dormant, `neuma` (no args) reports it and offers the
start command. `neuma talk` will fail fast with the same hint when the
backend isn't reachable.

## Troubleshooting

**`neuma: command not found`** — the installer skipped the PATH append
(maybe you used `--no-modify-path` or your shell isn't reading `~/.zshrc`
on startup). Either source the rc file (`source ~/.zshrc`) or open a new
shell. Verify the symlink exists with `ls -l ~/.local/bin/neuma`.

**`daemon: dormant`** — the residency daemon isn't running. Start it with
`scripts/neuma-daemon.sh start`. If `status` says active but health probes
fail, run `scripts/neuma-daemon.sh doctor` for a one-shot diagnostic.

**`OPERATOR_WALLET_PRIVATE_KEY is present in … but its value is malformed`** —
the error message tells you the fix. Most common cause: quoted value.
Replace `OPERATOR_WALLET_PRIVATE_KEY="0x…"` with the unquoted form
`OPERATOR_WALLET_PRIVATE_KEY=0x…`.

**`Ambiguous wallet env: … contains multiple *_PRIVATE_KEY entries`** —
you have more than one matching key and none of them is in the preferred
allowlist. Rename one to `OPERATOR_WALLET_PRIVATE_KEY` (or
`NEUMA_PRIVATE_KEY` / `PRIVATE_KEY`) to disambiguate, or remove the keys
you don't want this CLI to use.

**`active being: (none configured)`** — run `neuma summon <being>` once.
The next `neuma talk` will read the active file. Or set `NEUMA_BEING` in
your environment to force a being without writing the file.

**Edit aborts with `multiple matches`** — the `--old` string occurs more
than once in the target. Add surrounding context to make it unique, or
pass `--replace-all` if you genuinely want every occurrence replaced.

**`bash install` aborts with `neuma --help probe failed`** — the install
copied successfully but the CLI can't load `cli/` cleanly. Re-run with
`--from /full/path/to/checkout`; if the failure repeats, capture the
error message — it's surfaced verbatim from the failed help probe.
