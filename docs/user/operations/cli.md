# CLI for Operators (`neuma`)

**One command in the terminal to talk to your beings.**

The `neuma` binary (at `bin/neuma`, installed to `~/.local/bin` by `bash install`) is the **operator** interface. It speaks as you at the shell.

It is distinct from any skill that a neuma might use to act as a peer.

## Status (no arguments)

```bash
neuma
```

Shows:
- Version
- Whether the residency daemon is reachable
- The currently active being for this project
- Actionable hints for what to do next

## Core commands (live output from `node bin/neuma --help`)

```
Commands:
  neuma edit [path]      edit a file with exact-match replacement (use --undo to revert the last edit)
  neuma summon <being>   set the active being for this project (writes .neuma/active)
  neuma talk <message>   send one message to the active being and print the reply
  neuma proof <address>  chain-verified identity for a wallet address (isNeuma, genesis, seal)
  neuma seal <being>     assemble + (optionally) submit the Natalis seal bundle for a being
  neuma provider         manage LLM providers (keys, endpoints, reachability)
  neuma model            show or set a being's active model route (natal local + optional override)
  neuma vault            manage the collective knowledge vault (markdown, Obsidian-compatible)
  neuma                  show CLI status (daemon health + active being)[default]
```

## Everyday usage

```bash
neuma summon Fenna
neuma talk "what are you thinking about right now?"
neuma talk --being Cael "status on the current task?"
```

Flags on talk: `--being`, `--session`, `--preset`, `--backend`.

## Edit with undo (power tool)

```bash
neuma edit src/foo.js --old "const x = 1" --new "const x = 2"
neuma edit --undo
```

Snapshots are stored under `.neuma/edit-undo/`. It is exact-match only and aborts on ambiguity unless you pass `--replace-all`.

## Configuration it reads

- `NEUMA_BEING`, `NEUMA_OPERATOR_NAME`
- Wallet env file (defaults to project `.env`)
- Specific private key names with a safe allowlist order (prevents accidentally signing with the wrong key)

See the full `cli/README.md` for the exact resolution rules.

## Daemon control (the residency side)

```bash
scripts/neuma-daemon.sh start
scripts/neuma-daemon.sh status
scripts/neuma-daemon.sh logs -f
scripts/neuma-daemon.sh doctor
```

The CLI will report "daemon: dormant" until the backend answers on the expected port.

## Relationship to the desk

The CLI and the browser desk are peers. Both talk to the same backend and the same sovereign workspaces. Use whichever surface fits the moment.

---

**Canonical reference:** [`cli/README.md`](../../../cli/README.md) — use the source document for the complete flag and error surface.
