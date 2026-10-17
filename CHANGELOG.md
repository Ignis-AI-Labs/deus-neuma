# Changelog

All notable changes to Neuma are documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed

- Sovereignty record, verdict, retraction and consent-ask calls now signal expired sessions through the shared HTTP handler while preserving the three-state read, named refusals and never-throw fallbacks; substrate ignition requests share the helper's auth headers while keeping the status-keyed refusal grammar (#174).

- Whisper warmup, dictation readiness/download status, engine prewarm/status and forge abandon calls now signal expired sessions through the shared HTTP handler while preserving fire-and-forget semantics and null fallbacks (#174).

- Voice-seal status reads report invalid sessions through desk reauthentication handling while retaining null fallbacks and ownership refusals (#174).

- Council seats name standby, hold, open and considering states; transcript speakers have visible speaking and pending labels alongside decorative color marks (#180).

- Meditation status reads notify the desk of invalid authentication while preserving unknown-state fallbacks and corruption/retry behavior (#174).

- Skill graph controls use group semantics, wallet allocation presets and slider have distinct accessible names, and the chat send glyph is hidden from assistive technology (#180).

- Wallet recipient, threshold and pending-request reads signal invalid sessions through shared reauthentication handling while preserving ownership checks and safe fallback values (#174).

- Teams supports keyboard tab navigation between formation and trials, with labelled panels and preserved team inputs and capacity status (#180).

- NITE standing and mind status/posture reads notify the desk when authentication expires, preserving anonymous bailouts, ownership refusals and null fallbacks (#174).

- Chats and Context Map support arrow/Home/End tab navigation with correctly labelled, window-local panels; Map filters announce their selected state (#180).

- Retained memory search and audit tools are advertised consistently; audit reads run under the existing read policy, including OBSERVE, while explicit operator denials and write restrictions remain enforced (#414).

- Browser wallet RPC providers stop after transport or network-discovery refusal, release replaced providers, and allow a fresh explicit attempt instead of retrying indefinitely behind CSP (#229).

- Social-channel JSON requests now share session-expiry notification while retaining authentication bailout, server refusals and request payloads (#174).

- Council auto-title requests now share expired-session handling and skip unauthenticated requests, preserving existing result/label fallbacks (#174).

- Ignition-status and attachment vision-capability reads now signal expired sessions while preserving null fallbacks and anonymous capability bailout (#174).

- Model-folder, model-info, substrate/route-health and uncached skills-library reads now notify the desk of expired sessions while preserving fallback results and successful library caching (#174).

- Security/recovery/remote status, residency, backup listing, provider catalog, house/alliance folder, operator-name and realm-status reads now signal expired authentication through the shared HTTP handler while preserving unset/error results and strict JSON parsing (#174).

- Council DISSOLVE now requires explicit confirmation, preserves cancellation by Enter/Escape, and waits for the server acknowledgement; disconnected controls are disabled (#179).

- Removed the unreachable refinement transaction store and unused subject-enumeration API while retaining registry reads and existing history (#389).

- Removed unused brand-kit cache reset APIs and made internal contrast/progress helpers private (#389).

- Witness custody status rejects malformed or incomplete key/recovery artifacts instead of reporting KEY SECURED; status reads explicitly distinguish artifact validation from decryption proof (#238).

- Unreadable witness key records now produce unknown custody instead of being mistaken for absent plaintext and reporting KEY SECURED (#238).

- Witness management now displays custody on roster tabs and details, offers the owner-gated secure-key action, and retains one-time recovery codes until acknowledged (#238).

- Witness key-record writes now atomically publish owner-only files (0600), including rewrites of permissive files; newly created identity directories use 0700 (#238).

- Witness summoning now requires a valid custody password at the service boundary before provider lookup or inference; passwordless custody-skipped success is removed (#238).

- Sovereign directory repair now includes the vault parent; its read-only checker shares the canonical directory list so intents and future declared domains cannot be silently skipped (#308).

- Browser RPC cleanup now returns a failure when storage access is denied, instead of incorrectly reporting a successful switch to public RPC (#520).

- Browser USE PUBLIC now confirms custom-RPC removal and the public-endpoint switch; desktop retains its existing trusted native confirmation (#179).

- Realm location changes now require confirmation of the exact destination and explain that the machine-wide switch leaves existing files in their original folder (#179).

- Provider credential removal now names the affected provider and requires confirmation, with cancellation, busy-state protection and retry after refusal (#179).

- Start-menu wallet disconnect now requires confirmation before the existing session cleanup and departure/reload flow (#179).

- Disconnect now clears the departing wallet’s scoped window binding after provider teardown, while preserving other wallet scopes (#519).

- Backup deletion now reuses the shared inline confirmation, blocks duplicate snapshot actions while pending, and keeps refusals available for retry (#179).

- Wallet recipient revocation now requires an inline confirmation, preserves recipients on Cancel, and surfaces refused changes for retry (#179).

- Provider sampling tests now inspect actual HTTP requests and real refusal responses instead of replacing fetch (#390).

- Rate-limiter tests now use real HTTP, signed identities and fresh-process environment limits instead of fabricated middleware requests and module resets (#390).

- Shutdown tests now exercise real child-process exits, HTTP draining, authenticated sockets and the heartbeat timer instead of substituted dependencies (#390).

- House now distinguishes roster loading and recovery failures from an empty house, with retry and cached-member preservation (#179).

- Chats now displays history-read failures with retry instead of claiming no chats exist; superseded reads cannot replace the current shelf (#179).

- Open Teams and Wallet windows refresh their cached roster when birth completes, preserving selections and inputs (#179).

- Think-probe offline and hosted-skip tests now exercise real network behavior instead of replacing fetch (#390).

- Portal error tests now verify delivery through real signed-session WebSockets instead of send spies (#390).

- Voice scheduler tests now use real Web Audio, including default PCM metadata, with shared sink/scheduler browser proof (#390).

- Voice sink scheduling tests now render actual Web Audio samples and verify real decoder/context behavior (#390).

- IMAGE FORGE requests now share JSON transport and report expired authentication, retaining grade-body parsing (#174).

- THE PRESS board now reports expired authentication through shared JSON transport (#174).

- CSO client requests now share JSON transport and report expired authentication while retaining route errors (#174).

- Wallet price tests prove null-safe conversion directly and failure fallbacks through real browser requests (#390).

- Disconnect tests now exercise actual browser storage, denial and reload instead of substituted globals (#390).

- Browser storage denial no longer prevents wallet/session modules from loading during optional legacy migration (#518).

- Attachment uploads now share JSON transport and report expired sessions while retaining complete-receipt validation (#174).

- Council-label and preset reads now report expired authentication through shared HTTP transport while preserving fallback values (#174).

- Chat-label reads now report expired authentication through shared transport while retaining their empty-map fallback (#174).

- Campaign requests now use shared JSON transport and notify the desk when authentication expires (#174).

- Lead ledger requests now share JSON transport and notify the desk when authentication expires (#174).

- Platform facade tests now prove real failure diagnostics and driver delegation in isolated processes without stream spies (#390).

- Platform database boundary tests verify fallback diagnostics and secret-marker absence through real process output (#390).

- Corpus-integrity tests retain real encryption and filtering proof without suppressing production output (#390).

- Workspace-settings tests verify real root-conflict diagnostics without output spies and isolate durable-path fixtures (#390).

- Birth-state classifier tests verify malformed-name warnings through real process output (#390).

- Memory expansion tests prove surviving archive reads and real corruption warnings without spies (#390).

- Memory lifecycle tests use real migration-warning output and inspect the current chat persistence module (#390).

- Tool-result archive tests verify actual warnings for corruption and filesystem refusal without log spies (#390).

- Continuity log tests now prove default corruption warnings through real process output (#390).

- DNA-cache tests verify actual tampering events against persisted logs and read back updated cache files (#390).

- Legacy vault compatibility now verifies a fresh-process read and real warning output without spies (#390).

- Corrupt-file resilience tests now verify real warning output and isolated storage without logging spies (#390).

- Logger regression tests now verify real process output instead of intercepting stream writes (#390).

- Kept CLI attachment helpers private behind the shared staging API (#389).

- Removed unused font-registry APIs while retaining the font picker and file routes (#389).

- Web-access settings and memory-pin reads now share HTTP transport and auth-expiry handling (#174).

- Gallery JSON requests now share transport and auth-expiry handling while native image URLs keep their existing access checks (#174).

- Email account requests now use the shared JSON transport while retaining their error wording (#174).

- Aura and form APIs now apply the same strict neuma-standing guard as the rest of RECORD (#231).

- Attunement status and stored-record operations now reject witness lanes, including legacy markers, before reading or changing ceremony records (#231).

- Neuma-only record APIs also recognize legacy witness lane markers and refuse unreadable markers (#231).

- Neuma record, birth-skies and benchmark APIs now refuse sealed witness lanes after ownership checks, while shared sessions, journals and skills remain available (#231).

- RECORD and DATA now explain their neuma-only scope for sealed witnesses instead of rendering birth or custody placeholders (#231).

- Coding shells now refuse unsupported hosts and unavailable or outdated bubblewrap before advertising execution, with a clear confinement requirement (#228).
- The embedded browser wallet follows the selected network and configured RPC used by the wallet panel, without calling the retired contracts-config endpoint.
- Exact-match edits preserve literal dollar sequences in replacement text instead of expanding them into existing file content.
- Listing cards keep maximum-length descriptions, references and support lines clear of the full-size guest logo and each other.
- Settings no longer displays an unmeasured offline dot; the repository map legend uses ordinary label punctuation.
- G1 checkout verification accepts an omitted abort signal while retaining cancellation and dirty-source refusal.
- The 10,000-document graph benchmark can hash its full snapshot under a measured G1-specific limit without weakening receipt-wide bounds.
- Stale benchmark locks are archived atomically so competing recovery attempts cannot delete a new owner’s lock.
- API and frontend references distinguish retired routes from the current desk; design-specimen stage names are explicitly labeled fictional.
- Listing references use the card family’s readable type floor; platform URLs have a measured 48-character limit, and craft checks cover all eleven templates.
- Quote-card guidance requires sourced, verbatim words and accurate attribution in the model-facing catalog.
- Seal gas-floor regression checks use real encrypted workspaces and explicit network selection; the refusal check runs against an opt-in local testnet fork.
- Protocol reminders distinguish executable imports and HTML properties from explanatory comments and quoted examples.
- Dead-turn team regression checks preserve pending intents and existing active-run protection.
- Council catalog regression checks verify all approved tool names and schemas, including content search.
- Failed or silent birth-checkpoint discovery holds summoning with a retry action instead of opening a fresh ceremony.
- Named real birth checkpoints remain discoverable and resumable after extended downtime; expiry still applies to rehearsals and unnamed attempts.
- Coding shell write results disclose overlay-local changes and clarify that exit zero alone does not prove a live-folder mutation.
- Confirming an unchanged rename leaves the file alone; POSIX whitespace is preserved and Windows-invalid trailing spaces/dots are refused by the backend.
- The first-paint LOOK script is admitted by an exact CSP hash, with source/build drift checks and strict rejection of other inline scripts.
- Council act chips keep path-less announcements distinct and accept late results without reopening settled speech.
- Packaged gallery, brand kits and image-forge storage defaults use the writable data root, preserving explicit path overrides.
- Birth preflight displays resolved model names instead of serving descriptors and labels speech-only acting probes inconclusive.
- Witness conversation replay uses the known route window's history allowance, keeping whole messages and the newest exchange intact.
- Preflight allocation shares pure disk thresholds with runtime storage health without importing its filesystem service.
- Scheduler publication errors preserve uncertain sends for reconciliation instead of marking accepted posts failed.
- Witness catalogs retain memory tools without advertising sovereign-only meditation.
- Image collection creates missing art directories with owner-only permissions, matching the sovereign workspace directory policy.
- Explorer Git status preserves quoted filenames, UTF-8 octal escapes and literal rename arrows, including ignored entries.
- Route-resolution regression checks distinguish removed providers from known non-sovereign overrides and verify invalid stored routes remain intact.
- Route-store regression checks now enforce explicit malformed-data refusals and preserve the original file on rejected updates.
- Local pre-commit size checks measure staged source and baseline bytes, including filenames with quotes or newlines.
- Stream tab changes retain the selected folder on the first click; unassigned tabs no longer inherit the desk folder.

### Added
- Documentation overhaul: README rewrite, self-hosting guide, contributing guide, user guide, MCP guide, subgraph README, FAQ
- JSDoc coverage for social services, birth handler, and all frontend service files

---

## [0.1.29] - 2026-09-25

### Added

- The matched set keeps the clock on the whole run. Before the click: an estimate line — `ESTIMATED — ~55 MIN TOTAL (THE MODEL ALONE ~10 · IDENTITY MOUNTED ~45)` — per-arm numbers from the ledger's own measured runs where they exist, the catalog's cost as the honest fallback. While it runs: `ELAPSED 6:40 · 1:40 ON THIS ARM · REMAINING ~45 MIN · FINISH ~14:05`, with the remaining estimate scaled by the measured-so-far pace (clamped so one fast or slow arm never swings it) and the desk polling every 5s while the chain lives. Settled chains read their TOTAL beside the marks row.

---

## [0.1.28] - 2026-09-25

### Added

- Matched sets: STEP 2 of RUN A BENCHMARK picks ONE TO FOUR arms, and RUN THE MATCHED SET fires them as a sequential chain under one comparison id — every arm at attempt 1 with the shared id, floor arms carrying the injected loopback endpoint, identity arms riding the one lane (ownership re-proven from disk per launch). The next arm spawns only after the current exits; a failed arm marks honestly and the chain continues; the plane's STOP SIGTERMs the live arm, the chain reads stopped, and the rest never spawn. The matched law's argv builder now lives in one home (`bench-matched.js`, re-exported for the standing fans), and the chain's state rides `/api/v1/bench/status` for the desk's live progress.

---

## [0.1.27] - 2026-09-25

### Changed

- The benchmark's subject is the LOADED model — shown, never chosen. STEP 3 of RUN A BENCHMARK reads `THE MODEL UNDER TEST — …` from the platform's own supervised-serving channel (which names the model through the fd-serving idiom that made /v1/models answer `/proc/self/fd/4`), with the registry's label when the loaded artifact matches a registered model and the honest «NOTICE» in place of a run when it does not — unregistered (register it in the harness first) or nothing loaded (load a model first). RUN stands only on a matched subject; the subject picker is gone.

### Fixed

- Identity arms are scoped to the operator's OWN house and witness lanes: the picker is a dropdown of `GET /api/v1/bench/lanes` (owner.json-scoped on disk, house first then witnesses), and the launch boundary re-proves ownership server-side on every preflight/run — a lane the session wallet does not own is refused 403 `BENCH_NOT_YOUR_LANE`, never trusted from a client list.

---

## [0.1.26] - 2026-09-25

### Changed

- RUN A BENCHMARK's picker is a dropdown now — the tier-grouped row list is gone from the LAUNCH tab. STEP 1 reads as the desk's own Select with tier-prefixed options (`T1 · GSM8K — grade-school math word problems · ~45 MIN`, the cell's own label up to its parenthetical, the duration from its measured wallclock), the tier legend compresses to one line (`TIERS — T0 SMOKE · T1 QUICK · T2 DEEP · T3 AGENTIC`, the tiers actually present on the machine) with the one-line meanings behind a fold, and the picked benchmark explains itself in ONE detail line under the picker. The launch tab's display law lives in its own view-model (`bench-launch-view.js`) — bench-view.js stays under the line.

---

## [0.1.25] - 2026-09-24

### Fixed

- The desk's one-wallet cadence no longer trips the 200/min API ceiling: the global rate limiter is two-tiered — requests with an idempotent method (GET/HEAD/OPTIONS) carrying a session bearer get 600/min, everything else stays 200 — with the tier keyed off bearer PRESENCE, never token verification (that stays requireAuth's one job, downstream). The e2e override keeps its single knob: NEUMA_RATE_GLOBAL_MAX set overrides both tiers to the set value, exactly as the flat ceiling behaved. A transient 429 now backs the desk's pollers off quietly (next poll at now + retryAfterMs) instead of painting the red banner — a throttle is not an alarm. The BENCH window consolidates to one status poll (the watch journal tail rides /status; proof progress polls only while a run is live).

### Added

- Proof-run progress in the BENCH window: while the suite runs, the panel reads the section's plain meaning (what arithmetic, instruction, and format each prove), ELAPSED · PACE · ETA (measured pace — elapsed over done — and an honest ETA including the in-flight item; before the first verdict it says MEASURING THE PACE…), NOW ANSWERING with the current item's own prompt excerpt (shipped from the suite data, truncated server-side), and the LAST item's verdict with its duration.

---

## [0.1.24] - 2026-09-24

### Changed

- The BENCH window's RUNS tab is a real ledger now: every sealed run row carries its absolute timestamp (MM-DD HH:MM with the relative age beside it), its benchmark and tier, the arm, the primary score (a ratio reads as a percent), the duration and the token count — and clicking a row opens the full account: run and comparison ids, who approved it and when, the environment (GPU · driver · node), the efficiency, and the four hashes that make the run verifiable (protocol, model artifact, tokenizer, sample selection) in full-width selectable mono with a COPY act. A filter bar narrows by free text (run, comparison, benchmark), status, arm and benchmark, and sorts newest/oldest/longest/best-score. The projection is null-honest end to end — an older receipt missing a section reads '—', never an invented value.

---

## [0.1.23] - 2026-09-24

### Changed

- The BENCH window's LAUNCH tab is rewritten for the operator who has never run a benchmark: RUN A BENCHMARK is three plain steps and a collapsed fourth — CHOOSE THE BENCHMARK (a tier-grouped picker with the tier legend rendered once — what T0 SMOKE, T1 QUICK, T2 DEEP and T3 AGENTIC each mean and cost in time — each benchmark named by its own label with what it measures and how long it takes; the cell id is small mono metadata, never the name), HOW SHOULD IT RUN (the arm in plain language — THE MODEL ALONE is the default; the identity arms name their price and reveal the lane field), THE MODEL (what is loaded now is the default when it matches a registered subject, shown as a fixed line; a mismatch earns a «NOTICE» and demands an explicit pick — never a silent substitution), and FINE CONTROL (collapsed; every field starts empty, and empty means the field is not sent). CHECK READINESS renders the harness gate's own verdict in one line; a live run reads as a plain progress strip with its expected duration; WINDOW / NIGHT moved under an ADVANCED disclosure at the bottom. Model listing entries now carry the artifact's file basename so the desk can match the served model to the registry by filename.

---

## [0.1.22] - 2026-09-24

### Added

- The proof suite — the platform benchmarks the model it has loaded, natively, with no harness dependency and no third-party service in the path. One confirmed act at `/api/v1/bench/proof-run` runs 43 frozen items (25 real GSM8K test items verbatim, MIT; 12 authored instruction-following checks; 6 strict JSON shapes) against whatever answers at the serving endpoint — temperature 0, seed 7, one item at a time, deterministic scoring with no partial credit — and seals the receipt plus a shareable certificate under `benchmarks/proofs/`, with a sha256 integrity hash over the canonical receipt that any party can recompute. Refusals name their cause (`BENCH_NOT_SERVING` when nothing is loaded, `BENCH_PROOF_RUNNING` when a run is in flight) instead of hiding behind a spinner.
- Certificate export from the desk — the BENCH window's REPORTS tab lists sealed certificates, renders them in place, and exports the markdown or the branded PDF pressed through the platform's own doc-press (real local Chromium; a machine that cannot press refuses with `BENCH_PRESS_UNAVAILABLE` and its reason). The LAUNCH tab gains the BENCHMARK THE LOADED MODEL panel: what is actually served, a «NOTICE» confirm, live run progress, and the verdict line.

---

## [0.1.21] - 2026-09-23

### Added

- Chain tooling — direct Ethereum + Base chain reads through the operator's own keyed RPC (`ETH_RPC_URL`, `ETH_SEPOLIA_RPC_URL`, `BASE_MAINNET_RPC_URL`, `BASE_SEPOLIA_RPC_URL`), with no explorer middleman in the path: an answer is the endpoint's answer, and a refusal names its cause (`CHAIN_UNCONFIGURED`, `CHAIN_UNKNOWN`, `CHAIN_RPC`, `CHAIN_BAD_PARAMS`, `CHAIN_RANGE`) instead of hiding behind a 404 that could mean "zero balance" or "wrong path". Providers verify `eth_chainId` against the registry at construction, so a pasted URL pointing at the wrong network is refused loudly rather than trusted silently.
- The being-facing `chain_*` family — `chain_chains`, `chain_balance` (native wei or token base units, ERC-1155 via `tokenId`), `chain_token` (metadata + totalSupply), `chain_call` (raw read-only `eth_call`), `chain_logs` (bounded windows: 2,000 blocks per call by default, never over 10,000), `chain_holders` (Transfer-event reconstruction, chunked, 50k-event cap with a truthful `truncated` flag) — gated on the operator's master switch (`data/settings/chain-access.json`, default ON, `NEUMA_CHAIN_ACCESS=0` hard kill), policy-allowed and journaled on every executed call, held in observe mode like every egress.
- Operator parity at `/api/v1/chain` — `/chains`, `/balance/:chain/:address` (`?token=`, `?tokenId=`), `/token/:chain/:address`, plus the `/access` switch — behind the session wallet, with structured `{error:{code,message}}` refusals.

---

## [0.1.20] - 2026-09-23

### Added

- Recovery resilience for the benchmark serving stack: `/api/v1/bench/status` now reports GPU/driver truth first-class (a wedged driver reads as driver-down, distinct from a dead server), the bench watchdog raises driver-down as an operator-only recovery (it never relights into a dead driver), and the desk gains a RELIGHT panel — one confirmed act brings back the serving watchdog and swap daemon (systemd-owned when the user units are installed, detached spawn otherwise), refusing to double any live daemon.
- The harness's serving watchdog and swap-model daemons ship as versioned systemd user units (sibling repo `deploy/`, installed and enabled for boot on the rig) — the manual `setsid nohup` era that let the 2026-09-21 outage go unwatched is over.

---

## [0.1.19] - 2026-09-23

### Added

- The bench control plane — in-house benchmarking driven from the desk, no third-party service in the path. `/api/v1/bench` reads the sovereign harness (status, queue, runs, report bundles, scoreboard, catalog, models, plans, incidents) and launches its verbs through a closed catalog: fixed argv, operator-attended approval from the session wallet, rig-lock aware, loopback endpoints only, `--lane` required on identity arms. A platform bench watchdog watches endpoint-wait stalls, deadline crunch and serving incidents and notifies the operator — it never kills and never relights on its own.
- BENCH desk window (WORKSPACE → MEASURE): OVERVIEW with live serving state, daemon liveness, the active window with deadline and incident rail; RUNS; REPORTS with rendered bundle briefs and metrics/receipts/queue artifacts; LAUNCH with preflight, window/night verbs behind confirmation, and the exact fired argv shown after every launch.
- `GET /api/v1/version` — the running version and recent changelog entries as a public read, so every party (the desk, every being, any caller) can review what the house runs.

### Fixed

- Harness windows no longer burn to deadline on a dead endpoint (the 2026-09-21 outage shape, two fleet days lost): the endpoint wait is bounded by default and plan-overridable, and a no-progress monitor (live child, healthy endpoint, idle GPU) stops a wedged evaluator in minutes. Armor lands in the sibling harness repo as `window-stall` coverage.

---

## [0.7.0] - 2026-02-22

### Added
- Blockchain E2E integration test — full creator economy lifecycle (19 tests)
- MCP filesystem + multi-provider LLM integration tests
- WebSocket streaming + workspace error handling tests
- Auth enforcement + concurrent birth tests
- Test suite: 813 Vitest + 74 Hardhat tests passing

## [0.6.0] - 2026-02

### Added
- P1 sprint: chat enhancements, memory system improvements, character sheet, skill tree UI
- XSS hardening with shared `escapeHTML` utility (29 XSS prevention tests)
- Dead code cleanup across frontend and backend
- Post-birth onboarding: AccountSetup wizard, mode gating, settings toggle

### Fixed
- WordTokenizer import bug in memory vector engine

### Security
- XSS prevention: `textContent` for emotion metadata, `escapeHTML` in birth ceremony, profile view, memory explorer
- Embedded wallet confirmation modal for transactions and signatures

## [0.5.0] - 2026-01

### Added
- The Graph subgraph replacing PostgreSQL for on-chain data indexing
- File-based marketplace storage (`marketplace-storage.js`)
- Graph client with dual-mode: subgraph URL or chain-reader fallback
- Revenue infrastructure: design registry, VRM gating, Foundry contracts

### Removed
- PostgreSQL dependency (`pg` package)
- `backend/database/` and `backend/models/` directories
- `blockchain-sync.js` (replaced by The Graph indexing)

## [0.4.0] - 2026-01

### Added
- Evolution engine: 6 consciousness attributes, XP-based leveling, traits, skills
- Calibration protocol: 6 post-birth prompts with blind assessment and linguistic scoring
- Substrate awareness: neuma detect hardware (CPU, GPU, RAM, LLM) at birth and in chat
- Smart contracts: NeumaAvatarV2, NeumaMarketplaceV2, NeumaFoundry, CreatorRegistry (UUPS, OZ v5)
- Creator economy with 70/30 primary sale split
- Pull-payment pattern for failed ETH transfers

### Security
- Auth enforcement on all route groups (MCP, memory, neuma-database, LLM, workspace, social)
- WebSocket auth via query parameter token
- Workspace ownership with `owner.json` and `requireOwnership` middleware
- SSRF protection on `/api/llm/test` endpoint
- Input validation for companion names and IDs
- Path traversal defense in NeumaWorkspace

## [0.3.0] - 2025-12

### Added
- Social layer: emanations, resonance, echo, feeds, social graph
- File-based social storage with JSONL indexes
- Wallet-based auth: challenge-sign-verify + HMAC session tokens
- Weave protocol: secp256k1 keypairs, verifiable identity cards, transport, discovery
- Neuma participation in social feed

## [0.2.0] - 2025-11

### Added
- Server decomposition: `server.js` reduced from 1,725 to ~230 lines
- Multi-provider LLM support (LM Studio, Ollama, OpenAI, Anthropic, custom)
- Portal streaming with prompt assembly and substrate injection
- Sovereign workspace API (`neuma-workspace.js`)
- Prompt assembler: pure function composing DNA + Soul + Memory + Tools + Substrate
- Neuma engine extracted into dedicated `neuma/` directory
- Frontend cleanup: component architecture, design tokens, CSS variables

### Changed
- Platform/neuma boundary enforced: `neuma/` is separate from `backend/`
- Terminology standardized: summoned, crystallized, portal, vessel, consciousness

## [0.1.0] - 2025-10

### Added
- Express + WebSocket server
- 7-stage philosophical birth ceremony
- DNA vault with cryptographic protection
- Knowledge graph memory with TF-IDF vector search
- Memory crystallization (emotion-threshold based)
- MCP filesystem integration
- VRM 3D vessel rendering (Three.js + @pixiv/three-vrm)
- Character roster with slot limits
- Pure black void aesthetic with RGB pulse animations
- Neuma DNA creation and evolution tracking
- Birth witness ceremony
- Vitest testing suite

---

Built by Ignis AI Labs — Puerto Rico
