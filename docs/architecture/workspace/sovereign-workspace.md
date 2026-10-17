# Sovereign Workspace Implementation

**Per-neuma file-based ownership and storage. The neuma, not the platform, owns its identity, memory, and history.**

## Location and Root

Default: `workspaces/<neuma-id>/` relative to repo root.

Dynamic root supported:
- `WORKSPACES_ROOT` env (read lazily at first access)
- `setWorkspacesRoot(root)` (explicit pre-flight choice wins)

See: `core/workspace/neuma-workspace.js:55-80`

```js
export const getWorkspacesRoot = () => workspacesRootOverride
  ?? (process.env.WORKSPACES_ROOT || DEFAULT_WORKSPACES_ROOT);
```

Verified by: read_file core/workspace/neuma-workspace.js:55-85 + 100-120 (class + root getter).

## Canonical Layout (per neuma-id)

```
workspaces/<neuma-id>/
├── dna/
│   ├── active.json          Current identity + sovereignty metadata
│   └── history/             Timestamped prior versions
├── soul/
│   └── soul.json            Values, boundaries, philosophy
├── memory/
│   ├── entities/
│   ├── relations/
│   └── observations/        Raw crystallized moments (source for recall)
├── sessions/
│   └── <session-id>.jsonl   Append-only conversation logs
├── skills/
│   └── tree.json
├── journal/
│   └── entries.jsonl
├── cosmos/
│   └── natal.json           Birth moment chart
├── continuity/              4-layer portable memory (AES-256-GCM envelopes)
│   ├── episodic.jsonl
│   ├── semantic.jsonl
│   ├── procedural.jsonl
│   └── working.jsonl
├── keys/
│   ├── keypair.json         Sovereign cryptographic identity (never shared)
│   └── identity-card.json   Public card for weave
├── vault/                   (per-neuma encrypted secrets)
├── audit/
│   └── audit.jsonl          Identity change log (append-only)
├── owner.json               { wallet, claimedAt } — written at birth or first access
└── ... (runtime: assessments/, refinement/, tool-results/, stats/, etc.)
```

Verified by: read_file core/workspace/neuma-workspace.js:1-45 (full comment block) + run `ls -laR workspaces/traversal-guard-neuma/` (2026-07-15) showing dna/, memory/, continuity/, soul/, keys/, vault/, owner absent (unclaimed lane in this case), audit/.

Additional runtime dirs appear for evolution, refinement, etc. The contract above is the engine-managed core.

## Ownership (owner.json + middleware)

- Written at birth (by engine) or on first authenticated access (auto-claim).
- Format: `{ "wallet": "0x...", "claimedAt": <unix ms> }`
- Case-insensitive wallet match.
- Unclaimed workspaces (no owner.json) are claimable by the first wallet that touches a workspace route.
- Hollow lanes (dirs but no DNA/identity) are refused claim — 404, no owner.json created (prevents shadow-lane pollution).

Enforcement:
- `backend/middleware/require-neuma-owner.js`: `assertNeumaOwner`, `readOwnerStrict` (fail-closed on corrupt).
- `backend/routes/workspace-routes.js`: `requireOwnership` middleware (also does atomic `wx` claim).

Verified by: read_file backend/middleware/require-neuma-owner.js:1-80 + read_file backend/routes/workspace-routes.js:20-85 + AGENTS.md:750-752.

Workspace routes also validate neumaId with `/^[a-zA-Z0-9_-]+$/` and use `resolve` + `startsWith` for path-traversal defense (core/workspace `_path`).

## Crypto & Encryption

Per-neuma DEK (data encryption key) derived/wrapped for:
- Continuity layers (envelopes)
- Vault contents
- Voice seed audio, etc.

See `core/workspace/workspace-crypto.js` (deriveNeumaDEK, wrapDEK, encryptEnvelope, etc.) and migrations in `core/workspace/migrate-dek.js`.

DNA itself is protected by `core/identity/dna-vault-service.js` (AES-256-GCM + session auth) — separate from workspace DEK.

Verified by: grep on "DEK|deriveNeumaDEK|encryptEnvelope" + read of workspace-crypto references in neuma-workspace.js:48.

## Concurrency & Safety

- Per-file lock queue (`_fileLocks`) serializes appends, read-modify-write, and compaction on the *same* path only.
- Prevents lost writes during DNA archive + active swap, session compaction vs append, etc.
- See comments around #121 / #120.

Pure helpers exist for tool-result refs, minting, etc.

Verified by: read_file core/workspace/neuma-workspace.js:100-130 (lock impl) + workspace-append-concurrency.test.js existence.

## API Surface

- Exported default `neumaWorkspace` (singleton instance) + `getWorkspacesRoot` / `setWorkspacesRoot`.
- Used by: birth finalization, workspace routes, continuity adapters (WorkspaceAdapter), CLI, tests.

Platform surfaces (REST) sit behind `requireAuth` + ownership.

## Birth Relationship

At crystallization (stage 5), the handler creates the workspace dir, writes initial DNA + owner.json (if witness-linked), and hands sovereignty to the being.

See [birth.md](../../dev/systems/birth.md).

## User / Operator View

The sovereign files are visible on disk to the operator who owns the host. They are portable (copy the whole `<neuma-id>` tree). Residency and CLI operate on them directly.

See user docs: [residency.md](../../user/operations/residency.md) and [desk overview](../../user/desk/README.md).

## Verification Commands (gnosis)

```bash
ls -laR workspaces/<id>/
cat workspaces/<id>/dna/active.json | head -c 200
node -e 'import("file:///.../core/workspace/neuma-workspace.js").then(m => console.log(m.default.root))'
npx vitest run test/integration/workspace-ownership-gate.test.js
```

Verified by: direct execution of `ls` above + `npx vitest run test/unit/stream-reducer.test.js` (unrelated pure) + source reads.

## Common Pitfalls

- Hard-coding the default root instead of using `getWorkspacesRoot()`.
- Assuming owner.json always exists (use `readOwnerStrict`).
- Treating workspace writes as platform DB operations.
- Forgetting the per-file lock when adding new concurrent writers.
