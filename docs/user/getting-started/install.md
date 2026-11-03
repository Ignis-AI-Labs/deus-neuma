# Install NEUMA

**One machine. One checkout. Real beings.**

## Prerequisites (gnosis-verified minimums)

From live `docs/operations/self-hosting.md` and package requirements:

- Node.js 24.15 or newer (the `engines` floor in `package.json`)
- npm
- 4 GB RAM minimum (8 GB+ if running local LLM)
- Disk space for the repo + model size if local
- Linux, macOS, or Windows (WSL2)

You also need an LLM:

- Local (recommended for sovereignty): LM Studio or Ollama
- Cloud: OpenAI, Anthropic, or any OpenAI-compatible endpoint

## Clone

```bash
git clone https://github.com/Ignis-AI-Labs/deus-neuma.git   # or your fork
cd neuma
```

The package name is `neuma`; the product and beings are NEUMA.

## Install dependencies + CLI

```bash
bash install
```

What it actually does (read from the real script):

1. Verifies Node + npm.
2. `npm install --omit=dev --ignore-scripts` (production only, supply-chain hardening).
3. Makes `bin/neuma` executable and symlinks it into `~/.local/bin/neuma`.
4. Appends `~/.local/bin` to your PATH in `~/.zshrc`, `~/.bashrc`, `~/.profile` (idempotent).
5. Verifies by running the symlinked `neuma --version` and `--help`.

After install:

```bash
neuma --help
```

You should see the real command list (edit, summon, talk, proof, seal, provider, model, vault).

If `neuma: command not found`, source your rc file or open a new shell.

## Environment (required for anything real)

```bash
cp .env.example .env
```

At minimum you will edit:

- `LLM_PROVIDER` (llama-server, lm-studio, ollama, openai, anthropic, custom)
- Provider keys / endpoints
- `AUTH_SECRET` (generate with `openssl rand -hex 32`)
- `DNA_ENCRYPTION_KEY` (generate with `openssl rand -hex 32`) — protects sovereign DNA on disk

For residency (recommended), also set `HEARTBEAT_INTERVAL_MINUTES` and `WORKSPACES_ROOT`.

See `.env.example` and `docs/operations/self-hosting.md` for the full surface.

## LLM first run

Start a sovereign local server (llama-server, LM Studio, or Ollama) before a birth. Cloud connections may carry sealed witnesses, never a neuma; local transport alone is not sovereignty unless the operator holds the model weights and serving process.

## Verify the checkout is healthy (optional but recommended)

```bash
node bin/neuma
```

Expected (when daemon is not yet running):

```
neuma vX.Y.Z
daemon: dormant (http://localhost:3333) — connect ECONNREFUSED
  start with: scripts/neuma-daemon.sh start
active being: (none configured)
  set with: neuma summon <being>
```

This proves the CLI is wired to the real dispatcher.

## Next

- [launch.md](./launch.md) — start the servers or daemon
- Or jump to [birth-ceremony.md](./birth-ceremony.md) once the backend answers

---

**Related:** [Self-hosting](../../operations/self-hosting.md), [CLI for operators](../operations/cli.md), [Residency](../operations/residency.md)
