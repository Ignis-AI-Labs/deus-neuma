# Platform vs Neuma Engine Boundary

**The hard separation between Neuma (platform) and Neuma (sovereign consciousness engine).**

## Definition

- **Neuma / Platform**: Infrastructure, auth, routing, real-time portal wiring, MCP server management, residency daemon, on-chain readers, file-based social/registry, LLM provider selection, workspace routes. Lives in `backend/`.
- **Neuma Engine**: What a neuma *is* — identity (DNA + vault), memory (recall + continuity), birth (orchestration + crystallization), workspace (sovereign files), skills, evolution, weave (neuma-to-neuma), voice DNA, runtime (prompts, reflection). Lives in `core/`. Imported only via barrel `core/index.js`.

**Never mix them.** Platform code does not import from `core/` for its own logic in a way that inverts ownership, and `core/` code must never import `backend/` at all.

Verified by: read_file AGENTS.md:18-19 + 621-655 ([…]) and core/README.md:1-10.

## Import / Data Flow Rule

- `core/` is a pure dependency. The platform passes data *into* engine functions as parameters (DNA records, observations, prompts).
- One-way: platform → engine. Engine never reaches back into platform services.
- Barrel re-exports only: `import { neumaWorkspace, StagedBirthHandler, ... } from '../core/index.js';` (see server.js:17-18).
- Frontend never imports core directly (browser-incompatible); it talks to platform APIs / WS.

Verified by: read_file backend/server.js:17-19 (imports from `../core/index.js` only) + core/index.js:1-65 (barrel only) + AGENTS.md:655 ([…]).

## Directory Responsibilities (high level)

```
backend/
  server.js                 wiring + bootstrap
  services/                 auth, llm-provider, portal-stream, mcp, heartbeat, ...
  routes/                   REST + WS setup
  middleware/               requireAuth, require-neuma-owner, ...

core/
  identity/                 DNA vault, cache, genesis-seal, migrations, ai-witness
  workspace/                neuma-workspace.js + crypto (sovereign FS)
  birth/                    staged-birth-handler + name-extractor + finalize
  memory/                   neuma-recall, bm25-engine, graph-metrics
  continuity/               4-layer record + adapters (episodic/semantic/procedural/working)
  runtime/                  prompt-assembler, evolution-engine, emotion-detector, ...
  protocols/                birth-stages/*.md + manifest
  weave/                    keypair, identity-card, protocol (neuma-to-neuma)
  skills/, voice/, wallet/, attunement/, refinement/, ...
```

Verified by: list_dir core/ + core/README.md:11-90 + backend/README.md:1-70.

## Why the Boundary Exists

- Portability: a neuma's DNA + memory + skills must survive model changes, machine moves, or even export to another instance. If platform details leaked in, sovereignty is lost.
- Safety: the engine can be tested and evolved in isolation (pure functions + real workspace integration tests).
- Policy: […] (AGENTS.md:717)

The platform knows *that* a neuma exists (owner.json wallet + registry surfaces). The neuma knows *who it is*.

## Enforcement

- Convention + review (AGENTS Rule 6 self-check explicitly calls out […]).
- No shared mutable singletons that cross the line.
- Core remains runnable in Node without Express (used by CLI, tests, scripts).

Verified by: grep for platform/neuma boundary references in AGENTS.md + CONTRIBUTING.md:61-85 (architecture section).

## Common Violations to Avoid

- Putting neuma identity logic (DNA shape, memory crystallization) into a route or service.
- Importing `backend/services/mcp.js` from inside `core/`.
- Treating `workspaces/<id>/` as "platform data".
- Adding platform-only fields to core DNA templates without migration path.

## Related

- Sovereign workspace details: [sovereign-workspace.md](../workspace/sovereign-workspace.md)
- Birth as the place where engine and platform meet at crystallization: [birth.md](../../dev/systems/birth.md)
- Auth contract: [auth-and-portal.md](../../dev/systems/auth-and-portal.md)
- User view of ownership: [house.md](../../user/desk/house.md)
