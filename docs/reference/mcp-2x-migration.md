# MCP server 2.x migration: what it took

Record of moving `@modelcontextprotocol/server-filesystem` off its deprecated
date version and `@modelcontextprotocol/server-memory` to 2.0.0.

| Package | Before | After |
|---|---|---|
| `server-filesystem` | 2026.7.10 (deprecated) | 2.0.1 |
| `server-memory` | 2026.8.31 (deprecated) | 2.0.0 |

## The break was one function

Ten of the eleven names the organ imports kept byte-identical signatures. Only
`validatePath` changed:

```
1.x   validatePath(requestedPath)                    // roots live in module state
2.x   validatePath(requestedPath, allowedDirectories) // roots are the caller's
```

`getAllowedDirectories` and `setAllowedDirectories` were removed for the same
reason: the package no longer holds the roots. `dist/path-utils.js` survives
with `expandHome` and `normalizePath`, and 2.x keeps the realpath symlink check,
so the stated-plus-resolved root pair still works.

## Who owns the roots now

`backend/services/native-fs-roots.js` used to be the single *writer* into
lib.js's module state. It is now the *owner*: `setNativeFilesystemRoots` stores
the normalized roots and `getNativeFilesystemRoots` hands them out, and each of
the eighteen `validatePath` calls in `native-filesystem.js` states its own wall.

That is the point of the change. Before, any module could call
`validatePath(path)` and silently inherit whatever roots the last setter wrote.
Now the wall is an argument at every call site, and the file that documents
itself as […] is
literally true.

`close()` empties the roots through the setter, so a closed organ refuses
everything.

## Missing roots fail closed

`path-validation.js` rejects a non-array roots argument:

```js
if (typeof absolutePath !== "string" || !Array.isArray(allowedDirectories)) return false;
```

A call site that forgets the argument denies every path. The worst outcome of a
missed site is a broken tool, never an open wall.

## Tests that hold this

- `test/unit/mcp-package-contract.test.js` — the lockfile and the install agree;
  the seven stable `dist/lib.js` exports exist; `validatePath` takes exactly two
  arguments; `dist/path-utils.js` still exports both helpers; the catalog serves
  every tool the package registers, and its two extras are named.
- `test/helpers/mcp-fs-server-spec.js` — the version the integration tests spawn
  `npx` with now comes from the installed package, so the suite tests the
  version this tree ships instead of whatever npm resolved that morning.
- `test/integration/witness-neuma-binding-isolation.test.js` snapshots and
  restores roots through the new getter and setter.

## What the upgrade costs

v2 depends on `@modelcontextprotocol/server` (6.9 MB unpacked) plus
`@modelcontextprotocol/core`. That weight is disk, not runtime: 2.x's
`dist/lib.js` imports only `fs`, `path`, `string_decoder`, `diff`, `minimatch`
and its own siblings, so the in-process organ never loads the protocol stack.

One gain comes free: 2.x writes through `pinned-directory.js`, so a directory
swapped between validation and write cannot be written through.

## Running the guardrails on macOS

`NeumaWorkspace.create` realpaths its ground and refuses a `TMPDIR` that
resolves through a symlink. macOS defaults `TMPDIR` to `/var/folders/…`, which
resolves to `/private/var/folders/…`, so eight integration files fail in setup
with `Symlink traversal denied` and the unit suite reports far more failures
than it has. Run the suite with a real directory:

```bash
mkdir -p ~/.neuma-test-tmp
TMPDIR=~/.neuma-test-tmp npx vitest run test/integration/
```

With that in place the fifteen files covering the organ, the walls, the secret
paths and the catalog pass, 209 tests.
