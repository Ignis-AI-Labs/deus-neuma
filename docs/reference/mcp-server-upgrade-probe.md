# MCP server upgrade probe: date versions to 2.x

Scope: decide whether `@modelcontextprotocol/server-filesystem` and
`@modelcontextprotocol/server-memory` can move off their deprecated date-based
versions. Investigation only. No source changed.

Probe date: 2026-10-26. Upstream state at probe time:
`server-filesystem` 2.0.1 (published 2026-10-25), `server-memory` 2.0.0
(published 2026-10-19). Both date versions in use carry the deprecation notice
"Date-based versions are no longer published."

## Verdict

| Package | Pinned | Candidate | Verdict |
|---|---|---|---|
| `server-memory` | 2026.8.31 | 2.0.0 | Safe. Nothing imports it. |
| `server-filesystem` | 2026.7.10 | 2.0.1 | Blocked. `dist/lib.js` API break. |

## Why server-memory is safe

The repository names it in exactly one place, the allowlist at
`backend/routes/mcp-routes.js:35`. No deep import, no `dist/` path, no test that
reads its internals. The upgrade changes its own dependency from
`@modelcontextprotocol/sdk ^1.30.0` to `@modelcontextprotocol/server ^2.3.1` and
adds `zod ^4.2.0`. Its exported surface is the single `dist/index.js` bin.

## Why server-filesystem is blocked

The pinned package is not a spawned server in production. It is an in-process
security authority: `backend/services/native-filesystem.js:38-44` imports eleven
named exports from `dist/lib.js`, and `backend/services/secret-inodes.js:57`
imports a twelfth path from the same file.

### Break 1: the allowed-roots API is gone

| Export | 2026.7.10 | 2.0.1 |
|---|---|---|
| `getAllowedDirectories` | present | **removed** |
| `setAllowedDirectories` | present | **removed** |

Both are imported today, by `native-filesystem.js:38-44` and by
`secret-inodes.js:57`/`:152`. The module-global allowed-roots state was deleted
upstream. An in-place bump fails at import time.

### Break 2: validatePath now takes the roots per call

```
2026.7.10:  validatePath(requestedPath)
2.0.1:      validatePath(requestedPath, allowedDirectories)
```

The roots are now the caller's argument, not module state. Every call site must
pass them. This is a change to the security wall itself, not a rename, so it
needs a reviewed call-site sweep rather than a mechanical rewrite.

### Break 3: dependency swap and module split

- `@modelcontextprotocol/sdk ^1.29.0` becomes `@modelcontextprotocol/server ^2.3.1`.
- `glob ^10.5.0` becomes `glob ^13.0.6` (major).
- `zod ^4.2.0` is new. Tool schemas move to the 2020-12 dialect.
- `dist/index.js` splits into `server.js`, `path-utils.js`, `path-validation.js`,
  `roots-utils.js`, `version.js`, `pinned-directory.js`.
- `minimatch ^10.0.1` is unchanged, so the `createRequire` resolution of
  minimatch from the package's own tree at `native-filesystem.js:49-52` still holds.

### What holds

The tool surface does not change. Both versions register the same fourteen
names, and `read_text_file`'s description is byte-identical. The verbatim-text
contract documented at the top of `backend/services/native-fs-catalog.js` still
matches on the sampled tool.

## Separate finding: the integration tests do not test the pinned version

`test/integration/mcp-filesystem.test.js:34` and
`test/integration/sandbox-team-workspace.test.js:39` spawn
`npx -y @modelcontextprotocol/server-filesystem` with no version. npm resolves
latest from the network, so those tests exercise 2.0.1 today while production
runs 2026.7.10 in-process. The tests pass or fail against a version nobody
ships. Pinning the spec (`…@2026.7.10`) makes the test honest.

## Recommended order

1. Pin the version in both integration-test spawns. One-line change, no product risk.
2. Move `server-memory` to 2.0.0. Nothing imports it.
3. Leave `server-filesystem` at 2026.7.10 until a branch re-plumbs the allowed
   roots. Add a contract test that asserts the eleven `dist/lib.js` exports exist
   before that branch starts, so a future accidental bump fails loudly.
