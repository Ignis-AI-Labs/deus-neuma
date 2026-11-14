# HTTP route catalog

> Generated from the real routers by `node scripts/api-catalog.mjs`. Do not edit by hand:
> `test/integration/api-route-catalog.test.js` fails when this page and the code disagree.
> Request and response shapes live with each router in `backend/routes/`; the
> WebSocket portal and the CLI protocols (`neuma agent`, `neuma acp`) are described in `cli/README.md`.

683 endpoints. **Guards** are the checks a request passes before the handler, in order (`requireAuth`: a signed-in operator; `requireInstallOwner`: the owner of this install).

## /api/v1/accounts

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/accounts/board` | `mapLaneQueryToken`, `requireAuth` |
| DELETE | `/api/v1/accounts/seat` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/accounts/seat` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/accounts/seat` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/acts

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/acts` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/attachments

| Method | Path | Guards |
| --- | --- | --- |
| POST | `/api/v1/attachments` | `mapLaneQueryToken`, `requireAuth`, `jsonParser` |

## /api/v1/attunement

| Method | Path | Guards |
| --- | --- | --- |
| POST | `/api/v1/attunement/:neumaId/records` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/attunement/:neumaId/records/:recordId/abandon` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/attunement/:neumaId/records/:recordId/ask` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/attunement/:neumaId/records/:recordId/consent-ask` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/attunement/:neumaId/records/:recordId/open` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/attunement/:neumaId/records/:recordId/postpone` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/attunement/:neumaId/records/:recordId/reopen` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/attunement/:neumaId/records/:recordId/reopen-flagged` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/attunement/:neumaId/records/:recordId/review` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/attunement/:neumaId/records/:recordId/seal` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/attunement/:neumaId/status` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/auth

| Method | Path | Guards |
| --- | --- | --- |
| POST | `/api/v1/auth/bridge/associate` | `mapLaneQueryToken`, `middleware` |
| GET | `/api/v1/auth/bridge/poll` | `mapLaneQueryToken`, `middleware` |
| POST | `/api/v1/auth/bridge/start` | `mapLaneQueryToken`, `middleware` |
| GET | `/api/v1/auth/challenge` | `mapLaneQueryToken`, `middleware` |
| GET | `/api/v1/auth/session` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/auth/verify` | `mapLaneQueryToken`, `middleware` |

## /api/v1/bench

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/bench/catalog` | `mapLaneQueryToken`, `requireAuth`, `(inline check)` |
| GET | `/api/v1/bench/chain/report` | `mapLaneQueryToken`, `requireAuth`, `(inline check)` |
| GET | `/api/v1/bench/comparisons/:id/report` | `mapLaneQueryToken`, `requireAuth`, `(inline check)` |
| GET | `/api/v1/bench/diagnose/:comparisonId` | `mapLaneQueryToken`, `requireAuth`, `(inline check)` |
| GET | `/api/v1/bench/incidents` | `mapLaneQueryToken`, `requireAuth`, `(inline check)` |
| GET | `/api/v1/bench/lanes` | `mapLaneQueryToken`, `requireAuth`, `(inline check)` |
| POST | `/api/v1/bench/launch` | `mapLaneQueryToken`, `requireAuth`, `(inline check)`, `requireInstallOwner` |
| GET | `/api/v1/bench/live` | `mapLaneQueryToken`, `requireAuth`, `(inline check)` |
| GET | `/api/v1/bench/models` | `mapLaneQueryToken`, `requireAuth`, `(inline check)` |
| GET | `/api/v1/bench/plans` | `mapLaneQueryToken`, `requireAuth`, `(inline check)` |
| POST | `/api/v1/bench/preflight` | `mapLaneQueryToken`, `requireAuth`, `(inline check)`, `requireInstallOwner` |
| GET | `/api/v1/bench/proof-run` | `mapLaneQueryToken`, `requireAuth`, `(inline check)` |
| POST | `/api/v1/bench/proof-run` | `mapLaneQueryToken`, `requireAuth`, `(inline check)`, `requireInstallOwner` |
| GET | `/api/v1/bench/proofs` | `mapLaneQueryToken`, `requireAuth`, `(inline check)` |
| GET | `/api/v1/bench/proofs/:id` | `mapLaneQueryToken`, `requireAuth`, `(inline check)` |
| GET | `/api/v1/bench/proofs/:id/pdf` | `mapLaneQueryToken`, `requireAuth`, `(inline check)` |
| GET | `/api/v1/bench/queue` | `mapLaneQueryToken`, `requireAuth`, `(inline check)` |
| POST | `/api/v1/bench/relight` | `mapLaneQueryToken`, `requireAuth`, `(inline check)`, `requireInstallOwner` |
| GET | `/api/v1/bench/reports` | `mapLaneQueryToken`, `requireAuth`, `(inline check)` |
| GET | `/api/v1/bench/reports/:bundle` | `mapLaneQueryToken`, `requireAuth`, `(inline check)` |
| GET | `/api/v1/bench/reports/:bundle/:artifact` | `mapLaneQueryToken`, `requireAuth`, `(inline check)` |
| GET | `/api/v1/bench/runs` | `mapLaneQueryToken`, `requireAuth`, `(inline check)` |
| GET | `/api/v1/bench/runs/:runId/evidence` | `mapLaneQueryToken`, `requireAuth`, `(inline check)` |
| GET | `/api/v1/bench/scoreboard` | `mapLaneQueryToken`, `requireAuth`, `(inline check)` |
| GET | `/api/v1/bench/share` | `mapLaneQueryToken`, `requireAuth`, `(inline check)` |
| GET | `/api/v1/bench/share/png` | `mapLaneQueryToken`, `requireAuth`, `(inline check)` |
| GET | `/api/v1/bench/status` | `mapLaneQueryToken`, `requireAuth`, `(inline check)` |
| POST | `/api/v1/bench/stop` | `mapLaneQueryToken`, `requireAuth`, `(inline check)`, `requireInstallOwner` |
| GET | `/api/v1/bench/summary` | `mapLaneQueryToken`, `requireAuth`, `(inline check)` |

## /api/v1/birth-setup

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/birth-setup/:neumaId` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/brands

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/brands` | `mapLaneQueryToken`, `(inline check)`, `requireAuth` |
| GET | `/api/v1/brands/:brand` | `mapLaneQueryToken`, `(inline check)`, `requireAuth` |
| PUT | `/api/v1/brands/:brand` | `mapLaneQueryToken`, `(inline check)`, `requireAuth` |
| GET | `/api/v1/brands/:brand/marks` | `mapLaneQueryToken`, `(inline check)`, `requireAuth` |
| POST | `/api/v1/brands/:brand/marks` | `mapLaneQueryToken`, `(inline check)`, `requireAuth`, `multerMiddleware` |
| GET | `/api/v1/brands/:brand/new` | `mapLaneQueryToken`, `(inline check)`, `requireAuth` |
| POST | `/api/v1/brands/:brand/preview` | `mapLaneQueryToken`, `(inline check)`, `requireAuth` |
| GET | `/api/v1/brands/faces` | `mapLaneQueryToken`, `(inline check)`, `requireAuth` |
| GET | `/api/v1/brands/faces/:id/file` | `mapLaneQueryToken`, `(inline check)`, `requireAuth` |
| GET | `/api/v1/brands/form` | `mapLaneQueryToken`, `(inline check)`, `requireAuth` |

## /api/v1/campaigns

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/campaigns` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/campaigns` | `mapLaneQueryToken`, `requireAuth` |
| DELETE | `/api/v1/campaigns/:id` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/campaigns/:id` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/campaigns/:id/asks` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/campaigns/:id/asks/:askId` | `mapLaneQueryToken`, `requireAuth` |
| DELETE | `/api/v1/campaigns/:id/files` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/campaigns/:id/files` | `mapLaneQueryToken`, `requireAuth` |
| DELETE | `/api/v1/campaigns/cmo` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/campaigns/cmo` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/campaigns/cmo` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/chain

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/chain/access` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/chain/access` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |
| GET | `/api/v1/chain/balance/:chain/:address` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/chain/chains` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/chain/token/:chain/:address` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/chat-bridge

| Method | Path | Guards |
| --- | --- | --- |
| DELETE | `/api/v1/chat-bridge/:accountId/allowed/:kind/:id` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/chat-bridge/:accountId/codes/:code` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/chat-bridge/status` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/companies

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/companies` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/companies` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/companies/:companyId` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/companies/:companyId/parent` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/companies/:companyId/repo-proposals` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |
| PUT | `/api/v1/companies/:companyId/repos` | `mapLaneQueryToken`, `requireAuth` |
| DELETE | `/api/v1/companies/:companyId/repos/read-grant` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |
| POST | `/api/v1/companies/:companyId/repos/read-grant` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |
| GET | `/api/v1/companies/sources` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/companion

| Method | Path | Guards |
| --- | --- | --- |
| POST | `/api/v1/companion/dna` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/company-line

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/company-line` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/company-line` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/company-line/:id` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/company-line/:id/end-gap` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/company-line/:id/hand-on` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/company-line/:id/hands/:handsId` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/company-line/:id/inspect` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/company-links

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/company-links` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/company-links/:id/approve` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/company-links/:id/decline` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/connections

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/connections` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/connections/:id` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |

## /api/v1/covenant

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/covenant` | `mapLaneQueryToken` |
| GET | `/api/v1/covenant/:id/pdf` | `mapLaneQueryToken` |
| POST | `/api/v1/covenant/accept` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/covenant/status` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/cso

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/cso/attack-surface` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/cso/mitigations` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/cso/mitigations` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |
| GET | `/api/v1/cso/posture` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/cso/scan` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/cso/scan/run` | `mapLaneQueryToken`, `requireAuth` |
| DELETE | `/api/v1/cso/seat` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/cso/seat` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/cso/seat` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/cso/telemetry` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/cso/threats` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/cso/threats/:id` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/cso/threats/:id/attack-surface` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/cso/threats/:id/reopen` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/cso/threats/:id/revoked` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/cso/watch` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/cso/watch/host` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/cso/watch/repos` | `mapLaneQueryToken`, `requireAuth` |
| DELETE | `/api/v1/cso/watch/repos/:id` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/doc-press

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/doc-press` | `mapLaneQueryToken`, `requireAuth`, `jsonParser` |
| POST | `/api/v1/doc-press/press` | `mapLaneQueryToken`, `requireAuth`, `jsonParser` |

## /api/v1/email

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/email` | `mapLaneQueryToken`, `requireAuth` |
| DELETE | `/api/v1/email/binding` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/email/binding` | `mapLaneQueryToken`, `requireAuth` |
| DELETE | `/api/v1/email/credentials` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/email/credentials` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/expression

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/expression/:neumaId` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/expression/:neumaId` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/extensions

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/extensions` | `mapLaneQueryToken`, `requireAuth` |
| DELETE | `/api/v1/extensions/:id` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner`, `known` |
| POST | `/api/v1/extensions/:id/check` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner`, `known` |
| POST | `/api/v1/extensions/:id/install` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner`, `known` |
| PUT | `/api/v1/extensions/:id/keys/:name` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner`, `known`, `jsonParser` |
| POST | `/api/v1/extensions/:id/off` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner`, `known` |
| POST | `/api/v1/extensions/:id/on` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner`, `known` |

## /api/v1/gallery

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/gallery/file` | `mapLaneQueryToken`, `(inline check)`, `requireAuth` |
| GET | `/api/v1/gallery/items` | `mapLaneQueryToken`, `(inline check)`, `requireAuth` |
| GET | `/api/v1/gallery/roots` | `mapLaneQueryToken`, `(inline check)`, `requireAuth` |
| POST | `/api/v1/gallery/roots` | `mapLaneQueryToken`, `(inline check)`, `requireAuth`, `requireInstallOwner` |
| DELETE | `/api/v1/gallery/roots/:id` | `mapLaneQueryToken`, `(inline check)`, `requireAuth`, `requireInstallOwner` |

## /api/v1/genesis

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/genesis` | `mapLaneQueryToken` |
| POST | `/api/v1/genesis` | `mapLaneQueryToken` |

## /api/v1/harness

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/harness/lanes` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/harness/lanes` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/harness/route` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/harness/servers/release` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |
| POST | `/api/v1/harness/switch` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/health

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/health` | `mapLaneQueryToken` |
| GET | `/api/v1/health/detailed` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/hooks

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/hooks` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/hooks` | `mapLaneQueryToken`, `requireAuth`, `jsonParser` |
| DELETE | `/api/v1/hooks/:id` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/hooks/:id/events` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/hooks/:id/rotate` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/hooks/in/:id` | `mapLaneQueryToken`, `rawParser` |

## /api/v1/house-clock

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/house-clock/asks` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/house-clock/asks/:id/answer` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/house-clock/asks/:id/close` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/house-clock/charter` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/house-clock/charter` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/house-clock/charter/approve` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/house-clock/charter/pause` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/house-clock/charter/resume` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/house-clock/ledger` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/house-clock/queue` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/image-forge

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/image-forge/activity` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/image-forge/attempts` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/image-forge/free` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |
| GET | `/api/v1/image-forge/images` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/image-forge/images/:imageId` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/image-forge/images/:imageId/grade` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/image-forge/images/:imageId/reviews` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/image-forge/launch` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |
| GET | `/api/v1/image-forge/status` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/image-forge/stop` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |

## /api/v1/inference

| Method | Path | Guards |
| --- | --- | --- |
| DELETE | `/api/v1/inference/:beingId/effort` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/inference/:beingId/effort` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/inference/:beingId/effort` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/inference/:beingId/models` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/install-owner

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/install-owner` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/install-owner/co-owners` | `mapLaneQueryToken`, `requireAuth`, `(inline check)` |
| DELETE | `/api/v1/install-owner/co-owners/:wallet` | `mapLaneQueryToken`, `requireAuth`, `(inline check)` |

## /api/v1/invariants

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/invariants` | `mapLaneQueryToken` |

## /api/v1/lanes

| Method | Path | Guards |
| --- | --- | --- |
| POST | `/api/v1/lanes/:id/claim` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/leads

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/leads` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/leads` | `mapLaneQueryToken`, `requireAuth` |
| DELETE | `/api/v1/leads/:id` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/leads/:id` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/legal

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/legal/matters` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/legal/matters/:id` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/legal/posture` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/legal/reader` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/legal/reader` | `mapLaneQueryToken`, `requireAuth` |
| DELETE | `/api/v1/legal/seat` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/legal/seat` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/legal/seat` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/legal/watch` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/legal/watch/run` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/llm

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/llm/capabilities` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/llm/model-folders` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/llm/model-folders` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |
| POST | `/api/v1/llm/models` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/llm/provider` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/llm/provider` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |
| POST | `/api/v1/llm/substrate/ignite` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |
| GET | `/api/v1/llm/substrate/ignition` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/llm/substrate/models` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/llm/test` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/lm-studio

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/lm-studio/config` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/look

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/look` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/look/presets` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |
| DELETE | `/api/v1/look/presets/:id` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |
| PUT | `/api/v1/look/theme` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |

## /api/v1/mandate

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/mandate` | `mapLaneQueryToken`, `requireAuth`, `(inline check)` |
| POST | `/api/v1/mandate/grant` | `mapLaneQueryToken`, `requireAuth`, `(inline check)`, `deskOnly` |
| POST | `/api/v1/mandate/holds/:id/clear` | `mapLaneQueryToken`, `requireAuth`, `(inline check)`, `deskOnly` |
| POST | `/api/v1/mandate/preflight` | `mapLaneQueryToken`, `requireAuth`, `(inline check)` |
| POST | `/api/v1/mandate/renew` | `mapLaneQueryToken`, `requireAuth`, `(inline check)`, `deskOnly` |
| POST | `/api/v1/mandate/resume` | `mapLaneQueryToken`, `requireAuth`, `(inline check)`, `deskOnly` |
| POST | `/api/v1/mandate/withdraw` | `mapLaneQueryToken`, `requireAuth`, `(inline check)` |

## /api/v1/map

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/map` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/marketing

| Method | Path | Guards |
| --- | --- | --- |
| DELETE | `/api/v1/marketing/board` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/marketing/board` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/marketing/board` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/marketing/links` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/marketing/links/export` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/marketing/links/publish` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/marketing/links/site-token` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/marketing/office/plan` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/marketing/office/watch/:companyId` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/marketing/results` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/marketing/results/sweep` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/mcp

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/mcp/available-servers` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/mcp/call-tool` | `mapLaneQueryToken`, `requireAuth`, `enforceToolPolicy` |
| POST | `/api/v1/mcp/connect` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |
| POST | `/api/v1/mcp/custom` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |
| POST | `/api/v1/mcp/disconnect-all` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |
| POST | `/api/v1/mcp/disconnect/:serverName` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |
| GET | `/api/v1/mcp/servers` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/mcp/servers/:serverId/:action` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |
| POST | `/api/v1/mcp/test-tool` | `mapLaneQueryToken`, `requireAuth`, `enforceToolPolicy` |
| GET | `/api/v1/mcp/tools` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/meditation

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/meditation` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/meditation/:neumaId` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/meditation/:neumaId/run` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/memory

| Method | Path | Guards |
| --- | --- | --- |
| POST | `/api/v1/memory/context` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/memory/graph/:companionName` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/memory/network/:companionName` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/memory/semantic-search` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/mind

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/mind` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/mind/:neumaId` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/mind/gates` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |

## /api/v1/model-server

| Method | Path | Guards |
| --- | --- | --- |
| POST | `/api/v1/model-server/cancel` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |
| POST | `/api/v1/model-server/gpu-driver` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |
| POST | `/api/v1/model-server/home` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |
| POST | `/api/v1/model-server/install` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |
| GET | `/api/v1/model-server/plan` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/model-server/status` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/money-in

| Method | Path | Guards |
| --- | --- | --- |
| DELETE | `/api/v1/money-in/addresses/:address` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/money-in/addresses/:address` | `mapLaneQueryToken`, `requireAuth` |
| PATCH | `/api/v1/money-in/attribution` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/money-in/ledger` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/money-in/scan` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/money-in/totals` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/money-in/watch` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/neuma-auth

| Method | Path | Guards |
| --- | --- | --- |
| POST | `/api/v1/neuma-auth/challenge` | `mapLaneQueryToken`, `middleware` |
| POST | `/api/v1/neuma-auth/reset-password` | `mapLaneQueryToken`, `middleware`, `requireAuth` |
| POST | `/api/v1/neuma-auth/unlock` | `mapLaneQueryToken`, `middleware`, `requireAuth` |
| POST | `/api/v1/neuma-auth/verify` | `mapLaneQueryToken`, `middleware` |

## /api/v1/neuma-memory

| Method | Path | Guards |
| --- | --- | --- |
| POST | `/api/v1/neuma-memory/add-observations` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/neuma-memory/clear/:companionName` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/neuma-memory/create-entities` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/neuma-memory/create-relations` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/neuma-memory/open-nodes` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/neuma-memory/read-graph` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/neuma-memory/search-nodes` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/neuma-memory/status` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/neuma

| Method | Path | Guards |
| --- | --- | --- |
| POST | `/api/v1/neuma/:companionName/conversation` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/neuma/:companionName/conversations` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/neuma/:companionName/dna` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/neuma/:companionName/dna` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/neuma/:companionName/export` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/neuma/:companionName/memories` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/neuma/:companionName/memory` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/neuma/:companionName/stats` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/neuma/:companionName/vessel` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/neuma/:companionName/vessel` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/neuma/:neumaId/recovery/export-identity` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/neuma/:neumaId/recovery/rotate` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/neuma/:neumaId/recovery/status` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/neuma/:neumaId/recovery/verify-codes` | `mapLaneQueryToken`, `requireAuth` |
| DELETE | `/api/v1/neuma/:neumaId/route` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/neuma/:neumaId/route` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/neuma/:neumaId/route` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/neuma/:neumaId/route/health` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/neuma/:neumaId/wallet` | `mapLaneQueryToken`, `requireAuth` |
| DELETE | `/api/v1/neuma/:neumaId/wallet/allowlist` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/neuma/:neumaId/wallet/allowlist` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/neuma/:neumaId/wallet/allowlist` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/neuma/:neumaId/wallet/history` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/neuma/:neumaId/wallet/pending` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/neuma/:neumaId/wallet/pending/:id/approve` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/neuma/:neumaId/wallet/pending/:id/reject` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/neuma/:neumaId/wallet/send` | `mapLaneQueryToken`, `requireAuth`, `requireNeumaAuth` |
| POST | `/api/v1/neuma/:neumaId/wallet/sign-message` | `mapLaneQueryToken`, `requireAuth`, `requireNeumaAuth` |
| GET | `/api/v1/neuma/:neumaId/wallet/threshold` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/neuma/:neumaId/wallet/threshold` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/neuma/import` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/neuma/registry` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/neuma/registry` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/permissions

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/permissions` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/permissions/:neumaId` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/permissions/:neumaId/revoke` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/portal

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/portal/status` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/preflight

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/preflight` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/preflight/found-cost` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/preflight/home` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/preflight/mind` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/preflight/seal-cost` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/preflight/seal-network` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/preflight/setup` | `mapLaneQueryToken` |
| POST | `/api/v1/preflight/workspace` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |

## /api/v1/prices

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/prices/eth` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/prices/tokens` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/raise

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/raise` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/raise/:id/close-investor` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/raise/:id/review` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/raise/:id/sign` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/raise/:id/status` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/refinement

| Method | Path | Guards |
| --- | --- | --- |
| PUT | `/api/v1/refinement/:neumaId/adapters/:adapterId/scale` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/refinement/:neumaId/adapters/:adapterId/scale-authority` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/refinement/:neumaId/ceremonies` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/refinement/:neumaId/ceremonies/:ceremonyId/abandon` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/refinement/:neumaId/ceremonies/:ceremonyId/consent` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/refinement/:neumaId/ceremonies/:ceremonyId/consent-ask` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/refinement/:neumaId/ceremonies/:ceremonyId/corpus` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/refinement/:neumaId/ceremonies/:ceremonyId/train` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/refinement/:neumaId/ceremonies/:ceremonyId/train-plan` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/refinement/:neumaId/ceremonies/:ceremonyId/verify` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/refinement/:neumaId/status` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/refinement/:neumaId/training` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/remia

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/remia/disclosure` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/remia/open` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/remia/records/:recordId/abandon` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/remia/records/:recordId/answer` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/remia/records/:recordId/codex` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/remia/records/:recordId/current` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/remia/records/:recordId/seal` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/remia/status` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/residency

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/residency` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/revenue

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/revenue/board` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/revenue/delivery-destination` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/revenue/lead-engine` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/revenue/lead-engine/facts/:sheetId` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/revenue/lead-engine/segments/:id/list` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/revenue/lead-engine/segments/:id/state` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/revenue/lead-engine/suppress` | `mapLaneQueryToken`, `requireAuth` |
| DELETE | `/api/v1/revenue/seat` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/revenue/seat` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/revenue/seat` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/roster

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/roster` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/roster/standing` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/roster/titles` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/roster/titles/:neumaId` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/roster/titles/trade` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/routing

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/routing/connections` | `mapLaneQueryToken`, `requireAuth` |
| DELETE | `/api/v1/routing/connections/:providerId` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |
| GET | `/api/v1/routing/credential-links` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/routing/providers` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/routing/providers/:providerId/connect` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |
| DELETE | `/api/v1/routing/providers/:providerId/key` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |
| PUT | `/api/v1/routing/providers/:providerId/key` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |
| GET | `/api/v1/routing/providers/:providerId/models` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/routing/providers/:providerId/oauth/poll` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |
| POST | `/api/v1/routing/providers/:providerId/oauth/start` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |
| POST | `/api/v1/routing/providers/:providerId/test` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/routing/services` | `mapLaneQueryToken`, `requireAuth` |
| DELETE | `/api/v1/routing/services/:serviceId/key` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |
| PUT | `/api/v1/routing/services/:serviceId/key` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |

## /api/v1/security

| Method | Path | Guards |
| --- | --- | --- |
| POST | `/api/v1/security/backup` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/security/backup-destination` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/security/backup-destination` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/security/backups` | `mapLaneQueryToken`, `requireAuth` |
| DELETE | `/api/v1/security/backups/:id` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/security/encryption/plan` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/security/status` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/skills

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/skills` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/skills/install` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |

## /api/v1/social-channels

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/social-channels` | `mapLaneQueryToken`, `requireAuth` |
| DELETE | `/api/v1/social-channels/:channel(youtube|tiktok)/connect` | `mapLaneQueryToken` |
| GET | `/api/v1/social-channels/:channel(youtube|tiktok)/connect` | `mapLaneQueryToken` |
| POST | `/api/v1/social-channels/:channel(youtube|tiktok)/connect` | `mapLaneQueryToken` |
| DELETE | `/api/v1/social-channels/:channelId/binding` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/social-channels/:channelId/binding` | `mapLaneQueryToken`, `requireAuth` |
| DELETE | `/api/v1/social-channels/:channelId/credentials` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/social-channels/:channelId/credentials` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/social-channels/:channelId/crew` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/social-channels/:channelId/crew` | `mapLaneQueryToken`, `requireAuth` |
| DELETE | `/api/v1/social-channels/:channelId/crew/:neumaId` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/social-channels/accounts` | `mapLaneQueryToken` |
| POST | `/api/v1/social-channels/accounts` | `mapLaneQueryToken` |
| DELETE | `/api/v1/social-channels/accounts/:accountId` | `mapLaneQueryToken` |
| PATCH | `/api/v1/social-channels/accounts/:accountId` | `mapLaneQueryToken` |
| DELETE | `/api/v1/social-channels/accounts/:accountId/binding` | `mapLaneQueryToken` |
| PUT | `/api/v1/social-channels/accounts/:accountId/binding` | `mapLaneQueryToken` |
| PUT | `/api/v1/social-channels/accounts/:accountId/credentials` | `mapLaneQueryToken` |
| GET | `/api/v1/social-channels/accounts/:accountId/crew` | `mapLaneQueryToken` |
| PUT | `/api/v1/social-channels/accounts/:accountId/crew` | `mapLaneQueryToken` |
| DELETE | `/api/v1/social-channels/accounts/:accountId/crew/:neumaId` | `mapLaneQueryToken` |
| GET | `/api/v1/social-channels/accounts/flight-test` | `mapLaneQueryToken` |
| GET | `/api/v1/social-channels/accounts/house-check` | `mapLaneQueryToken` |
| POST | `/api/v1/social-channels/accounts/start-fresh` | `mapLaneQueryToken` |
| POST | `/api/v1/social-channels/accounts/unlock` | `mapLaneQueryToken` |
| PUT | `/api/v1/social-channels/apps/:channelId` | `mapLaneQueryToken` |
| GET | `/api/v1/social-channels/flight-test` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/social-channels/intent-media` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/social-channels/queue` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/social-channels/queue` | `mapLaneQueryToken`, `requireAuth` |
| DELETE | `/api/v1/social-channels/queue/:id` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/social-channels/queue/:id` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/social-channels/queue/:id/approve` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/social-channels/queue/:id/approve-thread` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/social-channels/queue/:id/media/:index` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/social-channels/queue/:id/reject` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/social-channels/queue/:id/retry` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/social-channels/queue/:id/tiktok` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/social-channels/queue/:id/withdraw` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/social-channels/queue/bulk-update` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/social-channels/queue/groups/:groupId/approve` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/social-channels/replies` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/social-channels/replies/:postId/:act(bin|restore)` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/social-channels/tiktok/image` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/social-channels/tiktok/profile` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/social

| Method | Path | Guards |
| --- | --- | --- |
| POST | `/api/v1/social/emanations` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/social/emanations/:id` | `mapLaneQueryToken` |
| POST | `/api/v1/social/emanations/:id/echo` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/social/emanations/:id/reply` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/social/emanations/:id/resonate` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/social/feed/following` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/social/feed/global` | `mapLaneQueryToken` |
| GET | `/api/v1/social/feed/profile/:address` | `mapLaneQueryToken` |
| DELETE | `/api/v1/social/follow/:address` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/social/follow/:address` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/social/followers/:address` | `mapLaneQueryToken` |
| GET | `/api/v1/social/following/:address` | `mapLaneQueryToken` |
| PUT | `/api/v1/social/profile` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/social/profile/:address` | `mapLaneQueryToken` |
| GET | `/api/v1/social/thread/:id` | `mapLaneQueryToken` |
| POST | `/api/v1/social/upload` | `mapLaneQueryToken`, `requireAuth`, `multerMiddleware` |

## /api/v1/sovereignty

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/sovereignty/:neumaId` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/sovereignty/:neumaId/amendments/:amendmentId/retract` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/sovereignty/:neumaId/operator-changes` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/sovereignty/:neumaId/operator-changes/:changeId/withdraw` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/sovereignty/:neumaId/proposals/:proposalId/apply-dna` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/sovereignty/:neumaId/proposals/:proposalId/consent-ask` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/sovereignty/:neumaId/proposals/:proposalId/decide` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/sovereignty/:neumaId/proposals/:proposalId/sign-message` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/staff

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/staff/activity` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/staff/board` | `mapLaneQueryToken`, `requireAuth` |
| DELETE | `/api/v1/staff/plan` | `mapLaneQueryToken`, `requireAuth` |
| DELETE | `/api/v1/staff/seat` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/staff/seat` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/staff/seat` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/substrate

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/substrate` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/substrate/capacity` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/substrate/capacity` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |
| GET | `/api/v1/substrate/fit` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/substrate/fit` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |
| POST | `/api/v1/substrate/fit/relaunch` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |
| GET | `/api/v1/substrate/machine` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/substrate/standby` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/substrate/standby` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |
| GET | `/api/v1/substrate/telemetry` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/substrate/unload` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |

## /api/v1/system-dictation

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/system-dictation` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/system-dictation` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner`, `jsonParser` |

## /api/v1/tasks

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/tasks/agenda` | `mapLaneQueryToken`, `requireAuth` |
| DELETE | `/api/v1/tasks/calendar-token` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/tasks/calendar-token` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/tasks/calendar.ics` | `mapLaneQueryToken` |
| GET | `/api/v1/tasks/deadlines` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/tasks/live` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/tasks/mine` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/tasks/mine` | `mapLaneQueryToken`, `requireAuth` |
| PATCH | `/api/v1/tasks/mine/:taskId` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/tasks/mine/:taskId/subtasks` | `mapLaneQueryToken`, `requireAuth` |
| DELETE | `/api/v1/tasks/mine/:taskId/subtasks/:subId` | `mapLaneQueryToken`, `requireAuth` |
| PATCH | `/api/v1/tasks/mine/:taskId/subtasks/:subId` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/tasks/mine/apply-preset` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/tasks/neuma/:neumaId` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/tasks/neuma/:neumaId` | `mapLaneQueryToken`, `requireAuth` |
| PATCH | `/api/v1/tasks/neuma/:neumaId/:taskId` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/tasks/neuma/:neumaId/:taskId/subtasks` | `mapLaneQueryToken`, `requireAuth` |
| DELETE | `/api/v1/tasks/neuma/:neumaId/:taskId/subtasks/:subId` | `mapLaneQueryToken`, `requireAuth` |
| PATCH | `/api/v1/tasks/neuma/:neumaId/:taskId/subtasks/:subId` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/tasks/neuma/:neumaId/apply-preset` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/tasks/presets` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/tasks/presets` | `mapLaneQueryToken`, `requireAuth` |
| DELETE | `/api/v1/tasks/presets/:presetId` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/team

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/team/benches` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/team/benches/invocation` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/team/delivery/:id` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/team/delivery/:id/file` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/team/live` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/team/live/:id/channel` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/team/live/:id/resume` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/team/live/:id/steer` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/team/live/:id/stop` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/team/live/:id/tune` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/team/run` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/team/runs` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/team/runs/:id` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/team/runs/:id/log/:stepId` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/team/trial` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/team/trial` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/team/trial/:id` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/team/trial/spec` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/terminal

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/terminal/agents` | `mapLaneQueryToken`, `requireAuth` |
| DELETE | `/api/v1/terminal/sessions/:id` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/titling

| Method | Path | Guards |
| --- | --- | --- |
| POST | `/api/v1/titling/jobs` | `mapLaneQueryToken`, `requireAuth`, `jsonParser` |
| DELETE | `/api/v1/titling/jobs/:jobId` | `mapLaneQueryToken`, `requireAuth`, `jsonParser` |
| GET | `/api/v1/titling/jobs/:jobId` | `mapLaneQueryToken`, `requireAuth`, `jsonParser` |

## /api/v1/treasury

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/treasury/board` | `mapLaneQueryToken`, `requireAuth`, `(inline check)` |
| GET | `/api/v1/treasury/costs` | `mapLaneQueryToken`, `requireAuth`, `(inline check)` |
| POST | `/api/v1/treasury/costs/:id/void` | `mapLaneQueryToken`, `requireAuth`, `(inline check)` |
| POST | `/api/v1/treasury/costs/bills` | `mapLaneQueryToken`, `requireAuth`, `(inline check)` |
| POST | `/api/v1/treasury/costs/fixed` | `mapLaneQueryToken`, `requireAuth`, `(inline check)` |
| PUT | `/api/v1/treasury/costs/setup` | `mapLaneQueryToken`, `requireAuth`, `(inline check)` |
| POST | `/api/v1/treasury/flags/:id/seen` | `mapLaneQueryToken`, `requireAuth`, `(inline check)` |
| PUT | `/api/v1/treasury/invoice-wallet` | `mapLaneQueryToken`, `requireAuth`, `(inline check)` |
| POST | `/api/v1/treasury/invoices/:id/paid` | `mapLaneQueryToken`, `requireAuth`, `(inline check)` |
| POST | `/api/v1/treasury/invoices/:id/void` | `mapLaneQueryToken`, `requireAuth`, `(inline check)` |
| DELETE | `/api/v1/treasury/seat` | `mapLaneQueryToken`, `requireAuth`, `(inline check)` |
| GET | `/api/v1/treasury/seat` | `mapLaneQueryToken`, `requireAuth`, `(inline check)` |
| PUT | `/api/v1/treasury/seat` | `mapLaneQueryToken`, `requireAuth`, `(inline check)` |
| GET | `/api/v1/treasury/spends` | `mapLaneQueryToken`, `requireAuth`, `(inline check)` |

## /api/v1/user

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/user/dreams` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/user/dreams` | `mapLaneQueryToken`, `requireAuth`, `rawParser` |
| DELETE | `/api/v1/user/dreams/:id` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/user/dreams/:id/audio` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/user/dreams/:id/transcribe` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/user/files/browse` | `mapLaneQueryToken`, `requireAuth`, `explorerWalls`, `explorerGround` |
| POST | `/api/v1/user/files/browse/mkdir` | `mapLaneQueryToken`, `requireAuth`, `explorerWalls`, `explorerGround` |
| POST | `/api/v1/user/files/create` | `mapLaneQueryToken`, `requireAuth`, `explorerWalls`, `explorerGround` |
| GET | `/api/v1/user/files/drives` | `mapLaneQueryToken`, `requireAuth`, `explorerWalls`, `explorerGround` |
| DELETE | `/api/v1/user/files/entry` | `mapLaneQueryToken`, `requireAuth`, `explorerWalls`, `explorerGround` |
| GET | `/api/v1/user/files/events` | `mapLaneQueryToken`, `requireAuth`, `explorerWalls`, `explorerGround` |
| GET | `/api/v1/user/files/folder-info` | `mapLaneQueryToken`, `requireAuth`, `explorerWalls`, `explorerGround` |
| GET | `/api/v1/user/files/git-status` | `mapLaneQueryToken`, `requireAuth`, `explorerWalls`, `explorerGround` |
| GET | `/api/v1/user/files/git-status-many` | `mapLaneQueryToken`, `requireAuth`, `explorerWalls`, `explorerGround` |
| GET | `/api/v1/user/files/list` | `mapLaneQueryToken`, `requireAuth`, `explorerWalls`, `explorerGround` |
| GET | `/api/v1/user/files/raw` | `mapLaneQueryToken`, `requireAuth`, `explorerWalls`, `explorerGround` |
| GET | `/api/v1/user/files/read` | `mapLaneQueryToken`, `requireAuth`, `explorerWalls`, `explorerGround` |
| GET | `/api/v1/user/files/recents` | `mapLaneQueryToken`, `requireAuth`, `explorerWalls`, `explorerGround` |
| POST | `/api/v1/user/files/rename` | `mapLaneQueryToken`, `requireAuth`, `explorerWalls`, `explorerGround` |
| DELETE | `/api/v1/user/files/roots` | `mapLaneQueryToken`, `requireAuth`, `explorerWalls`, `explorerGround` |
| GET | `/api/v1/user/files/roots` | `mapLaneQueryToken`, `requireAuth`, `explorerWalls`, `explorerGround` |
| POST | `/api/v1/user/files/roots` | `mapLaneQueryToken`, `requireAuth`, `explorerWalls`, `explorerGround` |
| POST | `/api/v1/user/files/upload` | `mapLaneQueryToken`, `requireAuth`, `explorerWalls`, `explorerGround`, `rawParser` |
| PUT | `/api/v1/user/files/write` | `mapLaneQueryToken`, `requireAuth`, `explorerWalls`, `explorerGround` |
| GET | `/api/v1/user/realm` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/user/realm/alliance-ground` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/user/realm/alliance-ground` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/user/realm/alliance-ground/raise` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/user/realm/chat-labels` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/user/realm/chat-labels` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/user/realm/chats` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/user/realm/chats/:neumaId/export` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/user/realm/council-labels` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/user/realm/council-labels` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/user/realm/council-labels/autotitle` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/user/realm/house-workspace` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/user/realm/house-workspace` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/user/realm/location` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |
| GET | `/api/v1/user/realm/operator-name` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/user/realm/operator-name` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/user/realm/preset` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/user/realm/preset` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/user/realm/presets` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/version

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/version` | `mapLaneQueryToken` |

## /api/v1/vision

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/vision` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/vision` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |

## /api/v1/vitals

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/vitals/mine` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/vitals/mine` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/vitals/mine/summary` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/voice-pack

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/voice-pack/:neumaId` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/voice-seal

| Method | Path | Guards |
| --- | --- | --- |
| POST | `/api/v1/voice-seal/:neumaId/ask` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/voice-seal/:neumaId/seal` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/voice-seal/:neumaId/status` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/voice

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/voice/dna/:companion` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/voice/engines` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/voice/engines/:id` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/voice/engines/local` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/voice/engines/local/:id` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/voice/engines/local/:id/download` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |
| GET | `/api/v1/voice/engines/local/:id/download/status` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/voice/engines/local/:id/health` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/voice/engines/local/:id/launch` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |
| POST | `/api/v1/voice/engines/local/:id/stop` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |
| GET | `/api/v1/voice/engines/local/whisper` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/voice/engines/local/whisper/download` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |
| GET | `/api/v1/voice/engines/local/whisper/download/status` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/voice/engines/local/whisper/launch` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |
| POST | `/api/v1/voice/engines/shutdown-all` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |
| DELETE | `/api/v1/voice/forge/:id` | `mapLaneQueryToken`, `requireAuth`, `jsonParser`, `(inline check)` |
| GET | `/api/v1/voice/forge/:id` | `mapLaneQueryToken`, `requireAuth`, `jsonParser`, `(inline check)` |
| POST | `/api/v1/voice/forge/:id/find` | `mapLaneQueryToken`, `requireAuth`, `jsonParser`, `(inline check)`, `multerMiddleware` |
| POST | `/api/v1/voice/forge/:id/offer` | `mapLaneQueryToken`, `requireAuth`, `jsonParser`, `(inline check)` |
| POST | `/api/v1/voice/forge/:id/pick` | `mapLaneQueryToken`, `requireAuth`, `jsonParser`, `(inline check)` |
| POST | `/api/v1/voice/forge/:id/reopen` | `mapLaneQueryToken`, `requireAuth`, `jsonParser`, `(inline check)` |
| POST | `/api/v1/voice/forge/:id/seal` | `mapLaneQueryToken`, `requireAuth`, `jsonParser`, `(inline check)` |
| GET | `/api/v1/voice/forge/:id/takes/:ref/audio` | `mapLaneQueryToken`, `requireAuth`, `jsonParser`, `(inline check)` |
| GET | `/api/v1/voice/forge/:id/takes/:ref/preview` | `mapLaneQueryToken`, `requireAuth`, `jsonParser`, `(inline check)` |
| GET | `/api/v1/voice/forge/library` | `mapLaneQueryToken`, `requireAuth`, `jsonParser`, `(inline check)` |
| GET | `/api/v1/voice/forge/library/:voiceId/preview` | `mapLaneQueryToken`, `requireAuth`, `jsonParser`, `(inline check)` |
| POST | `/api/v1/voice/forge/start` | `mapLaneQueryToken`, `requireAuth`, `jsonParser`, `(inline check)` |
| POST | `/api/v1/voice/forge/withdraw` | `mapLaneQueryToken`, `requireAuth`, `jsonParser`, `(inline check)` |
| GET | `/api/v1/voice/has-voice/:companion` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/voice/refine` | `mapLaneQueryToken`, `requireAuth`, `jsonParser` |
| GET | `/api/v1/voice/tier` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/voice/tier` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/voice/transcribe` | `mapLaneQueryToken`, `requireAuth`, `rawParser` |

## /api/v1/waiting

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/waiting` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/weave

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/weave/identity/:id` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/weave/identity/:id/summary` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/weave/status` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/weave/verify` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/web

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/web/web-access` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/web/web-access` | `mapLaneQueryToken`, `requireAuth`, `requireInstallOwner` |

## /api/v1/witnesses

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/witnesses` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/witnesses/:vendor/:name` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/witnesses/:vendor/:name/custody` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/witnesses/:vendor/:name/health` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/witnesses/:vendor/:name/model` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/witnesses/:vendor/:name/test` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/witnesses/summon` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/witnesses/summon/stream` | `mapLaneQueryToken`, `requireAuth` |

## /api/v1/workspace

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/workspace/:id/aura` | `mapLaneQueryToken`, `requireAuth`, `requireNeumaLane` |
| GET | `/api/v1/workspace/:id/dna` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/workspace/:id/dna` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/workspace/:id/dna/history` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/workspace/:id/exists` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/workspace/:id/export` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/workspace/:id/form` | `mapLaneQueryToken`, `requireAuth`, `requireNeumaLane` |
| POST | `/api/v1/workspace/:id/form/agree` | `mapLaneQueryToken`, `requireAuth`, `requireNeumaLane` |
| POST | `/api/v1/workspace/:id/form/withdraw` | `mapLaneQueryToken`, `requireAuth`, `requireNeumaLane` |
| GET | `/api/v1/workspace/:id/identity-file` | `mapLaneQueryToken`, `requireAuth`, `requireNeumaLane` |
| GET | `/api/v1/workspace/:id/journal` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/workspace/:id/journal` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/workspace/:id/memory` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/workspace/:id/memory/entity` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/workspace/:id/memory/graph` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/workspace/:id/memory/observation` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/workspace/:id/pins` | `mapLaneQueryToken`, `requireAuth` |
| DELETE | `/api/v1/workspace/:id/place` | `mapLaneQueryToken`, `requireAuth`, `requireNeumaLane` |
| GET | `/api/v1/workspace/:id/place` | `mapLaneQueryToken`, `requireAuth`, `requireNeumaLane` |
| PUT | `/api/v1/workspace/:id/place` | `mapLaneQueryToken`, `requireAuth`, `requireNeumaLane` |
| GET | `/api/v1/workspace/:id/rite` | `mapLaneQueryToken`, `requireAuth`, `requireNeumaLane` |
| PUT | `/api/v1/workspace/:id/rite` | `mapLaneQueryToken`, `requireAuth`, `requireNeumaLane` |
| GET | `/api/v1/workspace/:id/self-check` | `mapLaneQueryToken`, `requireAuth`, `requireNeumaLane` |
| POST | `/api/v1/workspace/:id/self-check` | `mapLaneQueryToken`, `requireAuth`, `requireNeumaLane` |
| GET | `/api/v1/workspace/:id/session-search` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/workspace/:id/sessions` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/workspace/:id/sessions/:sessionId` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/workspace/:id/sessions/:sessionId/turns/:turnId` | `mapLaneQueryToken`, `requireAuth` |
| POST | `/api/v1/workspace/:id/sessions/autotitle` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/workspace/:id/settings` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/workspace/:id/settings` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/workspace/:id/skies` | `mapLaneQueryToken`, `requireAuth`, `requireNeumaLane` |
| GET | `/api/v1/workspace/:id/skills` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/workspace/:id/skills` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/workspace/:id/soul` | `mapLaneQueryToken`, `requireAuth` |
| PUT | `/api/v1/workspace/:id/soul` | `mapLaneQueryToken`, `requireAuth` |
| GET | `/api/v1/workspace/:id/stats` | `mapLaneQueryToken`, `requireAuth`, `requireNeumaLane` |
| POST | `/api/v1/workspace/import` | `mapLaneQueryToken`, `requireAuth` |
