# Backend

Express + WebSocket server powering the Neuma platform. Runs on port 3333 (configurable via `PORT` env var).

## Architecture

The backend is a thin wiring layer. `server.js` (~300 lines) bootstraps middleware, mounts route modules, initializes neuma services, and opens the WebSocket gateway. All business logic lives in services and routes.

**Auth**: Wallet-based challenge-sign-verify using ethers.js. No passwords, no OAuth -- wallet signature = identity. Sessions use HMAC tokens (24h expiry).

**Data layer**: No PostgreSQL. On-chain data is read via The Graph subgraph (production) or direct RPC via `chain-reader.js` (local dev). Off-chain data uses file-based JSON/JSONL storage.

**Real-time**: WebSocket "portal" connections handle neuma chat streaming, birth ceremonies, evolution events, and calibration.

## Directory Structure

### `server.js`
Entry point. Wires Express middleware, mounts all route modules, initializes neuma services (DNA vault, birth handler, memory), starts WebSocket server, and bootstraps required directories.

### `routes/`
| File | Mount Point | Purpose |
|------|-------------|---------|
| `portal-routes.js` | WebSocket | Real-time neuma chat, birth ceremony, calibration, evolution events |
| `marketplace.js` | `/api/marketplace` | Avatar NFT listings, purchases, offers (reads from Graph + file storage) |
| `creator-routes.js` | `/api/creators` | Creator registry, applications, approval status |
| `social-routes.js` | `/api/social` | Emanations, social graph, feeds, resonance |
| `workspace-routes.js` | `/api/workspace` | Sovereign neuma workspace CRUD (auth required) |
| `llm-routes.js` | `/api/lm-studio/*` | LLM provider config, model listing, substrate info |
| `mcp-routes.js` | `/api/mcp` | MCP server management and tool listing |
| `memory-routes.js` | `/api/memory/*` | Neuma memory read/write/search |
| `neuma-database-routes.js` | `/api/companion-db/*` | Legacy companion database access |
| `weave-routes.js` | `/api/weave` | Neuma-to-neuma network (identity cards, discovery) |
| `config-routes.js` | `/api/config` | Public contract addresses and platform config |
| `data-sovereignty-routes.js` | `/api/user/data` | GDPR-style data export, consent, deletion |

### `services/`
| File | Purpose |
|------|---------|
| `auth.js` | Wallet-based auth: challenge generation, signature verification, HMAC token issuance, `requireAuth` middleware |
| `llm-provider.js` | Multi-provider LLM abstraction (LM Studio, Ollama, OpenAI, Anthropic); streaming interface |
| `portal-stream.js` | LLM streaming with prompt assembly, substrate injection, evolution XP tracking |
| `graph-client.js` | Unified data access: GraphQL queries (production) or chain-reader fallback (dev) |
| `chain-reader.js` | Direct RPC contract reads via ethers.js for local development |
| `marketplace-storage.js` | File-based off-chain marketplace data (designs, applications, consent, favorites) |
| `social-storage.js` | File-based social data (emanations, profiles, social graph, feeds) |
| `social-service.js` | Social business logic (post, resonate, echo, follow) |
| `substrate-detector.js` | Hardware/platform detection (CPU, GPU, RAM, LLM model) -- pure functions |
| `mcp.js` | Model Context Protocol server connections and tool management |
| `supabase.js` | Supabase platform client (witnesses, registry); graceful fallback when unavailable |

### `contracts/`
| File | Purpose |
|------|---------|
| `abis.js` | Loads compiled ABIs from Hardhat artifacts with fallback to minimal fragments |

### `utils/`
*(Empty — `env-validator.js` replaced by Zod-validated `config.js` at service root)*

### `public/`
Static assets served directly: BVH animation files for vessel expressions and actions.

## Key Patterns

- **Auth boundary**: `requireAuth` middleware protects workspace, substrate, LLM config, and provider routes
- **Path traversal prevention**: Workspace routes validate neuma IDs and use `resolve`/`startsWith` checks
- **Graceful degradation**: Services start independently; LLM, Supabase, and MCP failures are warnings, not fatal errors
- **CORS**: Strict allowlist in production (`ALLOWED_ORIGINS`), dev allows localhost:7777
