# HTTP route catalog

> Generated from the real routers by `node scripts/api-catalog.mjs`. Do not edit by hand:
> `test/integration/api-route-catalog.test.js` fails when this page and the code disagree.
> Request and response shapes live with each router in `backend/routes/`; the
> WebSocket portal and the CLI protocols (`neuma agent`, `neuma acp`) are described in `cli/README.md`.

794 endpoints. **Guards** are the checks a request passes before the handler, in order (`requireAuth`: a signed-in operator; `requireInstallOwner`: the owner of this install; `requireLocalScope`: the local desk, never a paired remote).
> `?ticket=` marks only the headerless file lanes that accept a short-lived exact-resource ticket;
> it is not an alternate authentication transport on any other route.

## /api/v1/accounts

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/accounts/board` | `requireAuth` |
| DELETE | `/api/v1/accounts/seat` | `requireAuth` |
| GET | `/api/v1/accounts/seat` | `requireAuth` |
| PUT | `/api/v1/accounts/seat` | `requireAuth` |

## /api/v1/acts

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/acts` | `requireAuth` |

## /api/v1/attachments

| Method | Path | Guards |
| --- | --- | --- |
| POST | `/api/v1/attachments` | `requireAuth`, `jsonParser` |

## /api/v1/attunement

| Method | Path | Guards |
| --- | --- | --- |
| POST | `/api/v1/attunement/:neumaId/records` | `requireAuth` |
| POST | `/api/v1/attunement/:neumaId/records/:recordId/abandon` | `requireAuth` |
| POST | `/api/v1/attunement/:neumaId/records/:recordId/ask` | `requireAuth` |
| POST | `/api/v1/attunement/:neumaId/records/:recordId/consent-ask` | `requireAuth` |
| POST | `/api/v1/attunement/:neumaId/records/:recordId/open` | `requireAuth` |
| POST | `/api/v1/attunement/:neumaId/records/:recordId/postpone` | `requireAuth` |
| POST | `/api/v1/attunement/:neumaId/records/:recordId/reopen` | `requireAuth` |
| POST | `/api/v1/attunement/:neumaId/records/:recordId/reopen-flagged` | `requireAuth` |
| GET | `/api/v1/attunement/:neumaId/records/:recordId/review` | `requireAuth` |
| POST | `/api/v1/attunement/:neumaId/records/:recordId/seal` | `requireAuth` |
| GET | `/api/v1/attunement/:neumaId/status` | `requireAuth` |

## /api/v1/auth

| Method | Path | Guards |
| --- | --- | --- |
| POST | `/api/v1/auth/bridge/associate` | `middleware` |
| GET | `/api/v1/auth/challenge` | `middleware` |
| GET | `/api/v1/auth/session` | `requireAuth` |
| POST | `/api/v1/auth/verify` | `middleware` |

## /api/v1/bench

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/bench/catalog` | `requireAuth`, `(inline check)` |
| GET | `/api/v1/bench/chain/report` | `requireAuth`, `(inline check)` |
| GET | `/api/v1/bench/comparisons/:id/report` | `requireAuth`, `(inline check)` |
| GET | `/api/v1/bench/diagnose/:comparisonId` | `requireAuth`, `(inline check)` |
| GET | `/api/v1/bench/incidents` | `requireAuth`, `(inline check)` |
| GET | `/api/v1/bench/lanes` | `requireAuth`, `(inline check)` |
| POST | `/api/v1/bench/launch` | `requireAuth`, `(inline check)`, `requireInstallOwner` |
| GET | `/api/v1/bench/live` | `requireAuth`, `(inline check)` |
| GET | `/api/v1/bench/models` | `requireAuth`, `(inline check)` |
| GET | `/api/v1/bench/plans` | `requireAuth`, `(inline check)` |
| POST | `/api/v1/bench/preflight` | `requireAuth`, `(inline check)`, `requireInstallOwner` |
| GET | `/api/v1/bench/proof-run` | `requireAuth`, `(inline check)` |
| POST | `/api/v1/bench/proof-run` | `requireAuth`, `(inline check)`, `requireInstallOwner` |
| GET | `/api/v1/bench/proofs` | `requireAuth`, `(inline check)` |
| GET | `/api/v1/bench/proofs/:id` | `requireAuth`, `(inline check)` |
| GET | `/api/v1/bench/proofs/:id/pdf` | `requireAuth`, `(inline check)` |
| GET | `/api/v1/bench/queue` | `requireAuth`, `(inline check)` |
| POST | `/api/v1/bench/relight` | `requireAuth`, `(inline check)`, `requireInstallOwner` |
| GET | `/api/v1/bench/reports` | `requireAuth`, `(inline check)` |
| GET | `/api/v1/bench/reports/:bundle` | `requireAuth`, `(inline check)` |
| GET | `/api/v1/bench/reports/:bundle/:artifact` | `requireAuth`, `(inline check)` |
| GET | `/api/v1/bench/runs` | `requireAuth`, `(inline check)` |
| GET | `/api/v1/bench/runs/:runId/evidence` | `requireAuth`, `(inline check)` |
| GET | `/api/v1/bench/scoreboard` | `requireAuth`, `(inline check)` |
| GET | `/api/v1/bench/share` | `requireAuth`, `(inline check)` |
| GET | `/api/v1/bench/share/png` | `requireAuth`, `(inline check)` |
| GET | `/api/v1/bench/status` | `requireAuth`, `(inline check)` |
| POST | `/api/v1/bench/stop` | `requireAuth`, `(inline check)`, `requireInstallOwner` |
| GET | `/api/v1/bench/summary` | `requireAuth`, `(inline check)` |

## /api/v1/birth-setup

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/birth-setup/:neumaId` | `requireAuth` |

## /api/v1/brands

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/brands` | `requireDeskAuth` |
| GET | `/api/v1/brands/:brand` | `requireDeskAuth` |
| PUT | `/api/v1/brands/:brand` | `requireDeskAuth` |
| GET | `/api/v1/brands/:brand/cards` | `requireDeskAuth` |
| DELETE | `/api/v1/brands/:brand/cards/:template` | `requireDeskAuth` |
| GET | `/api/v1/brands/:brand/cards/:template` | `requireDeskAuth` |
| PUT | `/api/v1/brands/:brand/cards/:template` | `requireDeskAuth` |
| PUT | `/api/v1/brands/:brand/cards/:template/use` | `requireDeskAuth` |
| GET | `/api/v1/brands/:brand/marks` | `requireDeskAuth` |
| POST | `/api/v1/brands/:brand/marks` | `requireDeskAuth`, `multerMiddleware` |
| GET | `/api/v1/brands/:brand/new` | `requireDeskAuth` |
| POST | `/api/v1/brands/:brand/preview` | `requireDeskAuth` |
| GET | `/api/v1/brands/faces` | `requireDeskAuth` |
| GET | `/api/v1/brands/faces/:id/file` | `requireDeskAuth` |
| GET | `/api/v1/brands/form` | `requireDeskAuth` |

## /api/v1/campaigns

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/campaigns` | `requireAuth` |
| POST | `/api/v1/campaigns` | `requireAuth` |
| DELETE | `/api/v1/campaigns/:id` | `requireAuth` |
| PUT | `/api/v1/campaigns/:id` | `requireAuth` |
| POST | `/api/v1/campaigns/:id/asks` | `requireAuth` |
| PUT | `/api/v1/campaigns/:id/asks/:askId` | `requireAuth` |
| DELETE | `/api/v1/campaigns/:id/files` | `requireAuth` |
| POST | `/api/v1/campaigns/:id/files` | `requireAuth` |
| DELETE | `/api/v1/campaigns/cmo` | `requireAuth` |
| GET | `/api/v1/campaigns/cmo` | `requireAuth` |
| PUT | `/api/v1/campaigns/cmo` | `requireAuth` |

## /api/v1/chain

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/chain/access` | `requireAuth` |
| PUT | `/api/v1/chain/access` | `requireAuth`, `requireInstallOwner` |
| GET | `/api/v1/chain/balance/:chain/:address` | `requireAuth` |
| GET | `/api/v1/chain/chains` | `requireAuth` |
| GET | `/api/v1/chain/token/:chain/:address` | `requireAuth` |

## /api/v1/chat-bridge

| Method | Path | Guards |
| --- | --- | --- |
| DELETE | `/api/v1/chat-bridge/:accountId/allowed/:kind/:id` | `requireAuth` |
| POST | `/api/v1/chat-bridge/:accountId/codes/:code` | `requireAuth` |
| GET | `/api/v1/chat-bridge/status` | `requireAuth` |

## /api/v1/chat-line

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/chat-line/chats` | `requireAuth` |
| GET | `/api/v1/chat-line/lines` | `requireAuth` |
| POST | `/api/v1/chat-line/lines` | `requireAuth` |
| DELETE | `/api/v1/chat-line/lines/:witness` | `requireAuth` |
| POST | `/api/v1/chat-line/send` | `requireAuth` |
| GET | `/api/v1/chat-line/witnesses` | `requireAuth` |
| PUT | `/api/v1/chat-line/witnesses/:wallet` | `requireAuth` |

## /api/v1/companies

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/companies` | `requireAuth` |
| POST | `/api/v1/companies` | `requireAuth` |
| PUT | `/api/v1/companies/:companyId` | `requireAuth` |
| PUT | `/api/v1/companies/:companyId/parent` | `requireAuth` |
| GET | `/api/v1/companies/:companyId/repo-proposals` | `requireAuth`, `requireInstallOwner` |
| PUT | `/api/v1/companies/:companyId/repos` | `requireAuth` |
| DELETE | `/api/v1/companies/:companyId/repos/read-grant` | `requireAuth`, `requireInstallOwner` |
| POST | `/api/v1/companies/:companyId/repos/read-grant` | `requireAuth`, `requireInstallOwner` |
| GET | `/api/v1/companies/sources` | `requireAuth` |

## /api/v1/companion

| Method | Path | Guards |
| --- | --- | --- |
| POST | `/api/v1/companion/dna` | `requireAuth` |

## /api/v1/company-line

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/company-line` | `requireAuth` |
| POST | `/api/v1/company-line` | `requireAuth` |
| GET | `/api/v1/company-line/:id` | `requireAuth` |
| POST | `/api/v1/company-line/:id/end-gap` | `requireAuth` |
| POST | `/api/v1/company-line/:id/hand-on` | `requireAuth` |
| POST | `/api/v1/company-line/:id/hands/:handsId` | `requireAuth` |
| POST | `/api/v1/company-line/:id/inspect` | `requireAuth` |

## /api/v1/company-links

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/company-links` | `requireAuth` |
| POST | `/api/v1/company-links/:id/approve` | `requireAuth` |
| POST | `/api/v1/company-links/:id/decline` | `requireAuth` |

## /api/v1/connections

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/connections` | `requireAuth` |
| PUT | `/api/v1/connections/:id` | `requireAuth`, `requireInstallOwner` |

## /api/v1/covenant

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/covenant` | — |
| GET | `/api/v1/covenant/:id/pdf` | — |
| POST | `/api/v1/covenant/accept` | `requireAuth` |
| GET | `/api/v1/covenant/status` | `requireAuth` |

## /api/v1/cso

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/cso/attack-surface` | `requireAuth` |
| GET | `/api/v1/cso/mitigations` | `requireAuth` |
| POST | `/api/v1/cso/mitigations` | `requireAuth`, `requireInstallOwner` |
| GET | `/api/v1/cso/posture` | `requireAuth` |
| GET | `/api/v1/cso/scan` | `requireAuth` |
| POST | `/api/v1/cso/scan/run` | `requireAuth` |
| DELETE | `/api/v1/cso/seat` | `requireAuth` |
| GET | `/api/v1/cso/seat` | `requireAuth` |
| PUT | `/api/v1/cso/seat` | `requireAuth` |
| GET | `/api/v1/cso/telemetry` | `requireAuth` |
| GET | `/api/v1/cso/threats` | `requireAuth` |
| GET | `/api/v1/cso/threats/:id` | `requireAuth` |
| GET | `/api/v1/cso/threats/:id/attack-surface` | `requireAuth` |
| PUT | `/api/v1/cso/threats/:id/reopen` | `requireAuth` |
| PUT | `/api/v1/cso/threats/:id/revoked` | `requireAuth` |
| GET | `/api/v1/cso/tripwire` | `requireAuth` |
| PUT | `/api/v1/cso/tripwire` | `requireAuth`, `requireInstallOwner` |
| POST | `/api/v1/cso/tripwire/clipboard` | `requireAuth` |
| POST | `/api/v1/cso/tripwire/release` | `requireAuth`, `requireInstallOwner` |
| GET | `/api/v1/cso/watch` | `requireAuth` |
| PUT | `/api/v1/cso/watch/host` | `requireAuth` |
| POST | `/api/v1/cso/watch/repos` | `requireAuth` |
| DELETE | `/api/v1/cso/watch/repos/:id` | `requireAuth` |

## /api/v1/desk-tickets

| Method | Path | Guards |
| --- | --- | --- |
| POST | `/api/v1/desk-tickets` | `requireAuth` |

## /api/v1/doc-press

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/doc-press` | `requireAuth`, `jsonParser` |
| POST | `/api/v1/doc-press/press` | `requireAuth`, `jsonParser` |

## /api/v1/email

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/email` | `requireAuth` |
| DELETE | `/api/v1/email/binding` | `requireAuth` |
| PUT | `/api/v1/email/binding` | `requireAuth` |
| DELETE | `/api/v1/email/credentials` | `requireAuth` |
| PUT | `/api/v1/email/credentials` | `requireAuth` |

## /api/v1/expression

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/expression/:neumaId` | `requireAuth` |
| PUT | `/api/v1/expression/:neumaId` | `requireAuth` |

## /api/v1/extensions

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/extensions` | `requireAuth` |
| DELETE | `/api/v1/extensions/:id` | `requireAuth`, `requireInstallOwner`, `known` |
| POST | `/api/v1/extensions/:id/check` | `requireAuth`, `requireInstallOwner`, `known` |
| POST | `/api/v1/extensions/:id/install` | `requireAuth`, `requireInstallOwner`, `known` |
| PUT | `/api/v1/extensions/:id/keys/:name` | `requireAuth`, `requireInstallOwner`, `known`, `jsonParser` |
| POST | `/api/v1/extensions/:id/off` | `requireAuth`, `requireInstallOwner`, `known` |
| POST | `/api/v1/extensions/:id/on` | `requireAuth`, `requireInstallOwner`, `known` |

## /api/v1/gallery

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/gallery/file` | `requireDeskAuth` |
| GET | `/api/v1/gallery/items` | `requireDeskAuth` |
| GET | `/api/v1/gallery/roots` | `requireDeskAuth` |
| POST | `/api/v1/gallery/roots` | `requireDeskAuth`, `requireInstallOwner` |
| DELETE | `/api/v1/gallery/roots/:id` | `requireDeskAuth`, `requireInstallOwner` |

## /api/v1/genesis

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/genesis` | — |
| POST | `/api/v1/genesis` | — |

## /api/v1/harness

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/harness/lanes` | `requireAuth` |
| POST | `/api/v1/harness/lanes` | `requireAuth` |
| GET | `/api/v1/harness/route` | `requireAuth` |
| POST | `/api/v1/harness/servers/release` | `requireAuth`, `requireInstallOwner` |
| POST | `/api/v1/harness/switch` | `requireAuth` |

## /api/v1/health

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/health` | — |
| GET | `/api/v1/health/detailed` | `requireAuth` |

## /api/v1/hooks

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/hooks` | `requireLocalScope`, `requireAuth` |
| POST | `/api/v1/hooks` | `requireLocalScope`, `requireAuth`, `jsonParser` |
| DELETE | `/api/v1/hooks/:id` | `requireLocalScope`, `requireAuth` |
| GET | `/api/v1/hooks/:id/events` | `requireLocalScope`, `requireAuth` |
| POST | `/api/v1/hooks/:id/rotate` | `requireLocalScope`, `requireAuth` |
| POST | `/api/v1/hooks/in/:id` | `rawParser` |

## /api/v1/house-clock

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/house-clock/asks` | `requireAuth` |
| POST | `/api/v1/house-clock/asks/:id/answer` | `requireAuth` |
| POST | `/api/v1/house-clock/asks/:id/close` | `requireAuth` |
| GET | `/api/v1/house-clock/charter` | `requireAuth` |
| PUT | `/api/v1/house-clock/charter` | `requireAuth` |
| POST | `/api/v1/house-clock/charter/approve` | `requireAuth` |
| POST | `/api/v1/house-clock/charter/pause` | `requireAuth` |
| POST | `/api/v1/house-clock/charter/resume` | `requireAuth` |
| GET | `/api/v1/house-clock/ledger` | `requireAuth` |
| GET | `/api/v1/house-clock/queue` | `requireAuth` |

## /api/v1/image-forge

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/image-forge/activity` | `requireAuth` |
| GET | `/api/v1/image-forge/attempts` | `requireAuth` |
| POST | `/api/v1/image-forge/free` | `requireAuth`, `requireInstallOwner` |
| GET | `/api/v1/image-forge/images` | `requireAuth` |
| GET | `/api/v1/image-forge/images/:imageId` | `requireAuth` |
| POST | `/api/v1/image-forge/images/:imageId/grade` | `requireAuth` |
| GET | `/api/v1/image-forge/images/:imageId/reviews` | `requireAuth` |
| POST | `/api/v1/image-forge/launch` | `requireAuth`, `requireInstallOwner` |
| GET | `/api/v1/image-forge/status` | `requireAuth` |
| POST | `/api/v1/image-forge/stop` | `requireAuth`, `requireInstallOwner` |

## /api/v1/imports

| Method | Path | Guards |
| --- | --- | --- |
| POST | `/api/v1/imports/assistant` | `requireAuth`, `requireInstallOwner`, `jsonParser` |
| GET | `/api/v1/imports/found` | `requireAuth`, `requireInstallOwner`, `jsonParser` |
| POST | `/api/v1/imports/pasted` | `requireAuth`, `requireInstallOwner`, `jsonParser` |

## /api/v1/inference

| Method | Path | Guards |
| --- | --- | --- |
| DELETE | `/api/v1/inference/:beingId/effort` | `requireAuth` |
| GET | `/api/v1/inference/:beingId/effort` | `requireAuth` |
| PUT | `/api/v1/inference/:beingId/effort` | `requireAuth` |
| GET | `/api/v1/inference/:beingId/models` | `requireAuth` |

## /api/v1/install-owner

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/install-owner` | `requireAuth` |
| POST | `/api/v1/install-owner/co-owners` | `requireAuth`, `(inline check)` |
| DELETE | `/api/v1/install-owner/co-owners/:wallet` | `requireAuth`, `(inline check)` |

## /api/v1/invariants

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/invariants` | — |

## /api/v1/lanes

| Method | Path | Guards |
| --- | --- | --- |
| POST | `/api/v1/lanes/:id/claim` | `requireAuth` |

## /api/v1/leads

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/leads` | `requireAuth` |
| POST | `/api/v1/leads` | `requireAuth` |
| DELETE | `/api/v1/leads/:id` | `requireAuth` |
| PUT | `/api/v1/leads/:id` | `requireAuth` |

## /api/v1/legal

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/legal/matters` | `requireAuth` |
| GET | `/api/v1/legal/matters/:id` | `requireAuth` |
| GET | `/api/v1/legal/posture` | `requireAuth` |
| GET | `/api/v1/legal/reader` | `requireAuth` |
| PUT | `/api/v1/legal/reader` | `requireAuth` |
| DELETE | `/api/v1/legal/seat` | `requireAuth` |
| GET | `/api/v1/legal/seat` | `requireAuth` |
| PUT | `/api/v1/legal/seat` | `requireAuth` |
| GET | `/api/v1/legal/watch` | `requireAuth` |
| POST | `/api/v1/legal/watch/run` | `requireAuth` |

## /api/v1/license

| Method | Path | Guards |
| --- | --- | --- |
| POST | `/api/v1/license/activate` | `requireLocalScope` |

## /api/v1/llm

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/llm/capabilities` | `requireAuth` |
| GET | `/api/v1/llm/model-folders` | `requireAuth` |
| PUT | `/api/v1/llm/model-folders` | `requireAuth`, `requireInstallOwner` |
| POST | `/api/v1/llm/models` | `requireAuth` |
| GET | `/api/v1/llm/provider` | `requireAuth` |
| PUT | `/api/v1/llm/provider` | `requireLocalScope`, `requireAuth`, `requireInstallOwner` |
| POST | `/api/v1/llm/substrate/ignite` | `requireLocalScope`, `requireAuth`, `requireInstallOwner` |
| GET | `/api/v1/llm/substrate/ignition` | `requireAuth` |
| GET | `/api/v1/llm/substrate/models` | `requireAuth` |
| POST | `/api/v1/llm/test` | `requireAuth` |

## /api/v1/lm-studio

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/lm-studio/config` | `requireAuth` |

## /api/v1/look

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/look` | `requireAuth` |
| POST | `/api/v1/look/presets` | `requireAuth`, `requireInstallOwner` |
| DELETE | `/api/v1/look/presets/:id` | `requireAuth`, `requireInstallOwner` |
| PUT | `/api/v1/look/theme` | `requireAuth`, `requireInstallOwner` |

## /api/v1/mandate

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/mandate` | `requireAuth`, `(inline check)` |
| POST | `/api/v1/mandate/grant` | `requireAuth`, `(inline check)`, `deskOnly` |
| POST | `/api/v1/mandate/holds/:id/clear` | `requireAuth`, `(inline check)`, `deskOnly` |
| POST | `/api/v1/mandate/preflight` | `requireAuth`, `(inline check)` |
| POST | `/api/v1/mandate/renew` | `requireAuth`, `(inline check)`, `deskOnly` |
| POST | `/api/v1/mandate/resume` | `requireAuth`, `(inline check)`, `deskOnly` |
| POST | `/api/v1/mandate/withdraw` | `requireAuth`, `(inline check)` |

## /api/v1/map

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/map` | `requireAuth` |

## /api/v1/marketing

| Method | Path | Guards |
| --- | --- | --- |
| DELETE | `/api/v1/marketing/board` | `requireAuth` |
| GET | `/api/v1/marketing/board` | `requireAuth` |
| PUT | `/api/v1/marketing/board` | `requireAuth` |
| GET | `/api/v1/marketing/links` | `requireAuth` |
| GET | `/api/v1/marketing/links/export` | `requireAuth` |
| POST | `/api/v1/marketing/links/publish` | `requireAuth` |
| PUT | `/api/v1/marketing/links/site-token` | `requireAuth` |
| GET | `/api/v1/marketing/office/plan` | `requireAuth` |
| GET | `/api/v1/marketing/office/watch/:companyId` | `requireAuth` |
| GET | `/api/v1/marketing/results` | `requireAuth` |
| POST | `/api/v1/marketing/results/sweep` | `requireAuth` |

## /api/v1/mcp

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/mcp/available-servers` | `requireAuth` |
| POST | `/api/v1/mcp/call-tool` | `requireAuth`, `enforceToolPolicy` |
| POST | `/api/v1/mcp/connect` | `requireAuth`, `requireInstallOwner` |
| POST | `/api/v1/mcp/custom` | `requireAuth`, `requireInstallOwner` |
| POST | `/api/v1/mcp/disconnect-all` | `requireAuth`, `requireInstallOwner` |
| POST | `/api/v1/mcp/disconnect/:serverName` | `requireAuth`, `requireInstallOwner` |
| GET | `/api/v1/mcp/servers` | `requireAuth` |
| POST | `/api/v1/mcp/servers/:serverId/:action` | `requireAuth`, `requireInstallOwner` |
| POST | `/api/v1/mcp/test-tool` | `requireAuth`, `enforceToolPolicy` |
| GET | `/api/v1/mcp/tools` | `requireAuth` |

## /api/v1/meditation

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/meditation` | `requireAuth` |
| PUT | `/api/v1/meditation/:neumaId` | `requireAuth` |
| POST | `/api/v1/meditation/:neumaId/run` | `requireAuth` |

## /api/v1/memory

| Method | Path | Guards |
| --- | --- | --- |
| POST | `/api/v1/memory/context` | `requireAuth` |
| GET | `/api/v1/memory/graph/:companionName` | `requireAuth` |
| GET | `/api/v1/memory/network/:companionName` | `requireAuth` |
| POST | `/api/v1/memory/semantic-search` | `requireAuth` |

## /api/v1/mind

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/mind` | `requireAuth` |
| GET | `/api/v1/mind/:neumaId` | `requireAuth` |
| PUT | `/api/v1/mind/gates` | `requireAuth`, `requireInstallOwner` |

## /api/v1/model-server

| Method | Path | Guards |
| --- | --- | --- |
| POST | `/api/v1/model-server/cancel` | `requireAuth`, `requireInstallOwner` |
| POST | `/api/v1/model-server/gpu-driver` | `requireAuth`, `requireInstallOwner` |
| POST | `/api/v1/model-server/home` | `requireAuth`, `requireInstallOwner` |
| POST | `/api/v1/model-server/install` | `requireAuth`, `requireInstallOwner` |
| GET | `/api/v1/model-server/plan` | `requireAuth` |
| GET | `/api/v1/model-server/status` | `requireAuth` |

## /api/v1/money-in

| Method | Path | Guards |
| --- | --- | --- |
| DELETE | `/api/v1/money-in/addresses/:address` | `requireAuth` |
| PUT | `/api/v1/money-in/addresses/:address` | `requireAuth` |
| PATCH | `/api/v1/money-in/attribution` | `requireAuth` |
| GET | `/api/v1/money-in/ledger` | `requireAuth` |
| POST | `/api/v1/money-in/scan` | `requireAuth` |
| GET | `/api/v1/money-in/totals` | `requireAuth` |
| GET | `/api/v1/money-in/watch` | `requireAuth` |

## /api/v1/neuma-auth

| Method | Path | Guards |
| --- | --- | --- |
| POST | `/api/v1/neuma-auth/challenge` | `middleware` |
| POST | `/api/v1/neuma-auth/reset-password` | `requireLocalScope`, `middleware`, `requireAuth` |
| POST | `/api/v1/neuma-auth/unlock` | `middleware`, `requireAuth` |
| POST | `/api/v1/neuma-auth/verify` | `middleware` |

## /api/v1/neuma-memory

| Method | Path | Guards |
| --- | --- | --- |
| POST | `/api/v1/neuma-memory/add-observations` | `requireAuth` |
| POST | `/api/v1/neuma-memory/clear/:companionName` | `requireAuth` |
| POST | `/api/v1/neuma-memory/create-entities` | `requireAuth` |
| POST | `/api/v1/neuma-memory/create-relations` | `requireAuth` |
| POST | `/api/v1/neuma-memory/open-nodes` | `requireAuth` |
| GET | `/api/v1/neuma-memory/read-graph` | `requireAuth` |
| POST | `/api/v1/neuma-memory/search-nodes` | `requireAuth` |
| GET | `/api/v1/neuma-memory/status` | `requireAuth` |

## /api/v1/neuma

| Method | Path | Guards |
| --- | --- | --- |
| POST | `/api/v1/neuma/:companionName/conversation` | `requireAuth` |
| GET | `/api/v1/neuma/:companionName/conversations` | `requireAuth` |
| GET | `/api/v1/neuma/:companionName/dna` | `requireAuth` |
| POST | `/api/v1/neuma/:companionName/dna` | `requireAuth` |
| GET | `/api/v1/neuma/:companionName/export` | `requireAuth` |
| GET | `/api/v1/neuma/:companionName/memories` | `requireAuth` |
| POST | `/api/v1/neuma/:companionName/memory` | `requireAuth` |
| GET | `/api/v1/neuma/:companionName/stats` | `requireAuth` |
| GET | `/api/v1/neuma/:companionName/vessel` | `requireAuth` |
| POST | `/api/v1/neuma/:companionName/vessel` | `requireAuth` |
| GET | `/api/v1/neuma/:neumaId/lp` | `requireAuth` |
| PUT | `/api/v1/neuma/:neumaId/lp/budget` | `requireLocalScope`, `requireAuth` |
| PUT | `/api/v1/neuma/:neumaId/lp/controls` | `requireLocalScope`, `requireAuth` |
| POST | `/api/v1/neuma/:neumaId/lp/open` | `requireLocalScope`, `requireAuth` |
| PUT | `/api/v1/neuma/:neumaId/lp/pace` | `requireLocalScope`, `requireAuth` |
| POST | `/api/v1/neuma/:neumaId/lp/pending/:id/approve` | `requireLocalScope`, `requireAuth` |
| POST | `/api/v1/neuma/:neumaId/lp/pending/:id/decline` | `requireLocalScope`, `requireAuth` |
| POST | `/api/v1/neuma/:neumaId/lp/rewards/:id/approve` | `requireLocalScope`, `requireAuth` |
| POST | `/api/v1/neuma/:neumaId/lp/rewards/:id/decline` | `requireLocalScope`, `requireAuth` |
| POST | `/api/v1/neuma/:neumaId/lp/rewards/:id/delivered` | `requireLocalScope`, `requireAuth` |
| PUT | `/api/v1/neuma/:neumaId/lp/vault` | `requireLocalScope`, `requireAuth` |
| POST | `/api/v1/neuma/:neumaId/recovery/export-identity` | `requireAuth` |
| POST | `/api/v1/neuma/:neumaId/recovery/retired/:address/reveal` | `requireAuth`, `requireLocalScope` |
| POST | `/api/v1/neuma/:neumaId/recovery/rotate` | `requireLocalScope`, `requireAuth` |
| POST | `/api/v1/neuma/:neumaId/recovery/rotation/ack` | `requireAuth`, `requireLocalScope` |
| GET | `/api/v1/neuma/:neumaId/recovery/rotation/codes` | `requireAuth`, `requireLocalScope` |
| GET | `/api/v1/neuma/:neumaId/recovery/status` | `requireAuth` |
| POST | `/api/v1/neuma/:neumaId/recovery/verify-codes` | `requireLocalScope`, `requireAuth` |
| DELETE | `/api/v1/neuma/:neumaId/route` | `requireAuth` |
| GET | `/api/v1/neuma/:neumaId/route` | `requireAuth` |
| PUT | `/api/v1/neuma/:neumaId/route` | `requireAuth` |
| GET | `/api/v1/neuma/:neumaId/route/health` | `requireAuth` |
| GET | `/api/v1/neuma/:neumaId/wallet` | `requireAuth` |
| DELETE | `/api/v1/neuma/:neumaId/wallet/allowlist` | `requireLocalScope`, `requireAuth` |
| GET | `/api/v1/neuma/:neumaId/wallet/allowlist` | `requireAuth` |
| POST | `/api/v1/neuma/:neumaId/wallet/allowlist` | `requireLocalScope`, `requireAuth` |
| GET | `/api/v1/neuma/:neumaId/wallet/history` | `requireAuth` |
| GET | `/api/v1/neuma/:neumaId/wallet/pending` | `requireAuth` |
| POST | `/api/v1/neuma/:neumaId/wallet/pending/:id/approve` | `requireAuth` |
| POST | `/api/v1/neuma/:neumaId/wallet/pending/:id/reject` | `requireAuth` |
| POST | `/api/v1/neuma/:neumaId/wallet/send` | `requireAuth`, `requireNeumaAuth` |
| POST | `/api/v1/neuma/:neumaId/wallet/sign-message` | `requireAuth`, `requireNeumaAuth` |
| GET | `/api/v1/neuma/:neumaId/wallet/threshold` | `requireAuth` |
| PUT | `/api/v1/neuma/:neumaId/wallet/threshold` | `requireLocalScope`, `requireAuth` |
| POST | `/api/v1/neuma/import` | `requireAuth` |
| GET | `/api/v1/neuma/registry` | `requireAuth` |
| POST | `/api/v1/neuma/registry` | `requireAuth` |

## /api/v1/permissions

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/permissions` | `requireAuth` |
| GET | `/api/v1/permissions/:neumaId` | `requireAuth` |
| POST | `/api/v1/permissions/:neumaId/revoke` | `requireAuth` |

## /api/v1/portal

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/portal/status` | `requireAuth` |

## /api/v1/positions

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/positions` | `requireAuth` |
| GET | `/api/v1/positions/:office/eyes` | `requireAuth` |
| GET | `/api/v1/positions/campaigns` | `requireAuth` |
| POST | `/api/v1/positions/campaigns/link` | `requireAuth` |
| POST | `/api/v1/positions/campaigns/unlink` | `requireAuth` |
| GET | `/api/v1/positions/companies` | `requireAuth` |
| PUT | `/api/v1/positions/companies/:id/model` | `requireAuth` |
| POST | `/api/v1/positions/companies/:id/model/approve` | `requireAuth` |
| POST | `/api/v1/positions/companies/:id/model/return` | `requireAuth` |
| DELETE | `/api/v1/positions/seating` | `requireAuth` |

## /api/v1/preflight

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/preflight` | `requireAuth` |
| GET | `/api/v1/preflight/found-cost` | `requireAuth` |
| GET | `/api/v1/preflight/home` | `requireAuth` |
| GET | `/api/v1/preflight/mind` | `requireAuth` |
| GET | `/api/v1/preflight/seal-cost` | `requireAuth` |
| GET | `/api/v1/preflight/seal-network` | `requireAuth` |
| GET | `/api/v1/preflight/setup` | — |
| POST | `/api/v1/preflight/workspace` | `requireAuth`, `requireInstallOwner` |

## /api/v1/prices

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/prices/eth` | `requireAuth` |
| GET | `/api/v1/prices/tokens` | `requireAuth` |

## /api/v1/raise

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/raise` | `requireAuth` |
| POST | `/api/v1/raise/:id/close-investor` | `requireAuth` |
| POST | `/api/v1/raise/:id/review` | `requireAuth` |
| POST | `/api/v1/raise/:id/sign` | `requireLocalScope`, `requireAuth` |
| POST | `/api/v1/raise/:id/status` | `requireAuth` |

## /api/v1/refinement

| Method | Path | Guards |
| --- | --- | --- |
| PUT | `/api/v1/refinement/:neumaId/adapters/:adapterId/scale` | `requireAuth` |
| POST | `/api/v1/refinement/:neumaId/adapters/:adapterId/scale-authority` | `requireAuth` |
| POST | `/api/v1/refinement/:neumaId/ceremonies` | `requireAuth` |
| POST | `/api/v1/refinement/:neumaId/ceremonies/:ceremonyId/abandon` | `requireAuth` |
| POST | `/api/v1/refinement/:neumaId/ceremonies/:ceremonyId/consent` | `requireAuth` |
| POST | `/api/v1/refinement/:neumaId/ceremonies/:ceremonyId/consent-ask` | `requireAuth` |
| POST | `/api/v1/refinement/:neumaId/ceremonies/:ceremonyId/corpus` | `requireAuth` |
| POST | `/api/v1/refinement/:neumaId/ceremonies/:ceremonyId/train` | `requireAuth` |
| POST | `/api/v1/refinement/:neumaId/ceremonies/:ceremonyId/train-plan` | `requireAuth` |
| POST | `/api/v1/refinement/:neumaId/ceremonies/:ceremonyId/verify` | `requireAuth` |
| GET | `/api/v1/refinement/:neumaId/status` | `requireAuth` |
| GET | `/api/v1/refinement/:neumaId/training` | `requireAuth` |

## /api/v1/remia

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/remia/disclosure` | `requireAuth` |
| POST | `/api/v1/remia/open` | `requireAuth` |
| POST | `/api/v1/remia/records/:recordId/abandon` | `requireAuth` |
| POST | `/api/v1/remia/records/:recordId/answer` | `requireAuth` |
| GET | `/api/v1/remia/records/:recordId/codex` | `requireAuth` |
| GET | `/api/v1/remia/records/:recordId/current` | `requireAuth` |
| POST | `/api/v1/remia/records/:recordId/seal` | `requireAuth` |
| GET | `/api/v1/remia/status` | `requireAuth` |

## /api/v1/residency

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/residency` | `requireAuth` |

## /api/v1/revenue

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/revenue/board` | `requireAuth` |
| POST | `/api/v1/revenue/deals` | `requireAuth` |
| POST | `/api/v1/revenue/deals/:id/invoice` | `requireAuth` |
| POST | `/api/v1/revenue/deals/:id/move` | `requireAuth` |
| PUT | `/api/v1/revenue/delivery-destination` | `requireLocalScope`, `requireAuth` |
| GET | `/api/v1/revenue/invoices` | `requireAuth` |
| POST | `/api/v1/revenue/invoices/:id/send` | `requireAuth` |
| POST | `/api/v1/revenue/invoices/:id/void` | `requireAuth` |
| POST | `/api/v1/revenue/invoices/check` | `requireAuth` |
| GET | `/api/v1/revenue/lead-engine` | `requireAuth` |
| POST | `/api/v1/revenue/lead-engine/campaigns` | `requireAuth` |
| POST | `/api/v1/revenue/lead-engine/campaigns/:id` | `requireAuth` |
| POST | `/api/v1/revenue/lead-engine/campaigns/:id/close` | `requireAuth` |
| POST | `/api/v1/revenue/lead-engine/campaigns/:id/email-plan` | `requireAuth` |
| POST | `/api/v1/revenue/lead-engine/candidates/pass` | `requireAuth` |
| POST | `/api/v1/revenue/lead-engine/facts/:sheetId` | `requireAuth` |
| POST | `/api/v1/revenue/lead-engine/facts/:sheetId/fact` | `requireAuth` |
| POST | `/api/v1/revenue/lead-engine/gather-list` | `requireAuth` |
| POST | `/api/v1/revenue/lead-engine/import` | `requireAuth`, `textParser` |
| DELETE | `/api/v1/revenue/lead-engine/leads/:id/call` | `requireAuth` |
| POST | `/api/v1/revenue/lead-engine/leads/:id/call` | `requireAuth` |
| POST | `/api/v1/revenue/lead-engine/leads/:id/kind` | `requireAuth` |
| POST | `/api/v1/revenue/lead-engine/leads/:id/said` | `requireAuth` |
| GET | `/api/v1/revenue/lead-engine/mail/:uid` | `requireAuth` |
| GET | `/api/v1/revenue/lead-engine/names` | `requireAuth` |
| GET | `/api/v1/revenue/lead-engine/never-list` | `requireAuth` |
| PUT | `/api/v1/revenue/lead-engine/never-list` | `requireAuth` |
| POST | `/api/v1/revenue/lead-engine/never-list/review` | `requireAuth` |
| POST | `/api/v1/revenue/lead-engine/outbox/:id` | `requireAuth` |
| POST | `/api/v1/revenue/lead-engine/outbox/:id/return` | `requireAuth` |
| POST | `/api/v1/revenue/lead-engine/outbox/check` | `requireAuth` |
| POST | `/api/v1/revenue/lead-engine/outbox/confirm` | `requireAuth` |
| POST | `/api/v1/revenue/lead-engine/outbox/delete` | `requireAuth` |
| POST | `/api/v1/revenue/lead-engine/outbox/review` | `requireAuth` |
| POST | `/api/v1/revenue/lead-engine/outbox/send` | `requireAuth` |
| PUT | `/api/v1/revenue/lead-engine/plans` | `requireAuth` |
| DELETE | `/api/v1/revenue/lead-engine/plans/:partner` | `requireAuth` |
| POST | `/api/v1/revenue/lead-engine/prospects/:id/hand` | `requireAuth` |
| GET | `/api/v1/revenue/lead-engine/review` | `requireAuth` |
| GET | `/api/v1/revenue/lead-engine/run` | `requireAuth` |
| POST | `/api/v1/revenue/lead-engine/run` | `requireAuth` |
| POST | `/api/v1/revenue/lead-engine/run/clear` | `requireAuth` |
| GET | `/api/v1/revenue/lead-engine/run/schedule` | `requireAuth` |
| PUT | `/api/v1/revenue/lead-engine/run/schedule` | `requireAuth` |
| GET | `/api/v1/revenue/lead-engine/run/standing` | `requireAuth` |
| POST | `/api/v1/revenue/lead-engine/run/stop` | `requireAuth` |
| GET | `/api/v1/revenue/lead-engine/runs` | `requireAuth` |
| GET | `/api/v1/revenue/lead-engine/runs/:id/lines` | `requireAuth` |
| POST | `/api/v1/revenue/lead-engine/searches/pass-wide` | `requireAuth` |
| POST | `/api/v1/revenue/lead-engine/segments/:id/campaign` | `requireAuth` |
| POST | `/api/v1/revenue/lead-engine/segments/:id/list` | `requireAuth` |
| POST | `/api/v1/revenue/lead-engine/segments/:id/read-sites` | `requireAuth` |
| PUT | `/api/v1/revenue/lead-engine/segments/:id/required` | `requireAuth` |
| POST | `/api/v1/revenue/lead-engine/segments/:id/state` | `requireAuth` |
| POST | `/api/v1/revenue/lead-engine/segments/:id/test` | `requireAuth` |
| POST | `/api/v1/revenue/lead-engine/spend` | `requireAuth` |
| POST | `/api/v1/revenue/lead-engine/suppress` | `requireAuth` |
| POST | `/api/v1/revenue/lead-engine/suppress/lift` | `requireAuth` |
| DELETE | `/api/v1/revenue/seat` | `requireAuth` |
| GET | `/api/v1/revenue/seat` | `requireAuth` |
| PUT | `/api/v1/revenue/seat` | `requireAuth` |

## /api/v1/roster

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/roster` | `requireAuth` |
| GET | `/api/v1/roster/standing` | `requireAuth` |
| GET | `/api/v1/roster/titles` | `requireAuth` |
| PUT | `/api/v1/roster/titles/:neumaId` | `requireAuth` |
| POST | `/api/v1/roster/titles/trade` | `requireAuth` |

## /api/v1/routing

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/routing/connections` | `requireAuth` |
| DELETE | `/api/v1/routing/connections/:providerId` | `requireAuth`, `requireInstallOwner` |
| GET | `/api/v1/routing/credential-links` | `requireAuth` |
| GET | `/api/v1/routing/providers` | `requireAuth` |
| POST | `/api/v1/routing/providers/:providerId/connect` | `requireAuth`, `requireInstallOwner` |
| DELETE | `/api/v1/routing/providers/:providerId/key` | `requireAuth`, `requireInstallOwner` |
| PUT | `/api/v1/routing/providers/:providerId/key` | `requireAuth`, `requireInstallOwner` |
| GET | `/api/v1/routing/providers/:providerId/models` | `requireAuth` |
| POST | `/api/v1/routing/providers/:providerId/oauth/poll` | `requireAuth`, `requireInstallOwner` |
| POST | `/api/v1/routing/providers/:providerId/oauth/start` | `requireAuth`, `requireInstallOwner` |
| POST | `/api/v1/routing/providers/:providerId/test` | `requireAuth` |
| GET | `/api/v1/routing/services` | `requireAuth` |
| DELETE | `/api/v1/routing/services/:serviceId/key` | `requireAuth`, `requireInstallOwner` |
| PUT | `/api/v1/routing/services/:serviceId/key` | `requireAuth`, `requireInstallOwner` |

## /api/v1/security

| Method | Path | Guards |
| --- | --- | --- |
| POST | `/api/v1/security/backup` | `requireAuth` |
| GET | `/api/v1/security/backup-destination` | `requireAuth` |
| PUT | `/api/v1/security/backup-destination` | `requireAuth` |
| GET | `/api/v1/security/backups` | `requireAuth` |
| DELETE | `/api/v1/security/backups/:id` | `requireAuth` |
| POST | `/api/v1/security/encryption/plan` | `requireAuth` |
| GET | `/api/v1/security/status` | `requireAuth` |
| GET | `/api/v1/security/write-limit` | `requireAuth` |
| PUT | `/api/v1/security/write-limit` | `requireAuth`, `requireInstallOwner` |

## /api/v1/skills

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/skills` | `requireAuth` |
| POST | `/api/v1/skills/install` | `requireAuth`, `requireInstallOwner` |

## /api/v1/social-channels

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/social-channels` | `requireAuth` |
| POST | `/api/v1/social-channels/:channel(youtube|tiktok)/connect` | `requireLocalScope` |
| DELETE | `/api/v1/social-channels/:channel(youtube|tiktok|linkedin)/connect` | — |
| GET | `/api/v1/social-channels/:channel(youtube|tiktok|linkedin)/connect` | — |
| POST | `/api/v1/social-channels/:channel(youtube|tiktok|linkedin)/connect` | — |
| DELETE | `/api/v1/social-channels/:channelId/binding` | `requireAuth` |
| PUT | `/api/v1/social-channels/:channelId/binding` | `requireAuth` |
| DELETE | `/api/v1/social-channels/:channelId/credentials` | `requireLocalScope`, `requireAuth` |
| PUT | `/api/v1/social-channels/:channelId/credentials` | `requireLocalScope`, `requireAuth` |
| GET | `/api/v1/social-channels/:channelId/crew` | `requireAuth` |
| PUT | `/api/v1/social-channels/:channelId/crew` | `requireAuth` |
| DELETE | `/api/v1/social-channels/:channelId/crew/:neumaId` | `requireAuth` |
| GET | `/api/v1/social-channels/accounts` | — |
| POST | `/api/v1/social-channels/accounts` | `requireLocalScope` |
| DELETE | `/api/v1/social-channels/accounts/:accountId` | `requireLocalScope` |
| PATCH | `/api/v1/social-channels/accounts/:accountId` | — |
| DELETE | `/api/v1/social-channels/accounts/:accountId/binding` | — |
| PUT | `/api/v1/social-channels/accounts/:accountId/binding` | — |
| PUT | `/api/v1/social-channels/accounts/:accountId/credentials` | `requireLocalScope` |
| GET | `/api/v1/social-channels/accounts/:accountId/crew` | — |
| PUT | `/api/v1/social-channels/accounts/:accountId/crew` | — |
| DELETE | `/api/v1/social-channels/accounts/:accountId/crew/:neumaId` | — |
| GET | `/api/v1/social-channels/accounts/flight-test` | — |
| GET | `/api/v1/social-channels/accounts/house-check` | — |
| POST | `/api/v1/social-channels/accounts/start-fresh` | `requireLocalScope` |
| POST | `/api/v1/social-channels/accounts/unlock` | `requireLocalScope` |
| PUT | `/api/v1/social-channels/apps/:channelId` | `requireLocalScope` |
| GET | `/api/v1/social-channels/flight-test` | `requireAuth` |
| GET | `/api/v1/social-channels/intent-media` | `requireAuth` |
| GET | `/api/v1/social-channels/queue` | `requireAuth` |
| POST | `/api/v1/social-channels/queue` | `requireAuth` |
| DELETE | `/api/v1/social-channels/queue/:id` | `requireAuth` |
| PUT | `/api/v1/social-channels/queue/:id` | `requireAuth` |
| PUT | `/api/v1/social-channels/queue/:id/approve` | `requireAuth` |
| PUT | `/api/v1/social-channels/queue/:id/approve-thread` | `requireAuth` |
| GET | `/api/v1/social-channels/queue/:id/media/:index` | `requireAuth` |
| PUT | `/api/v1/social-channels/queue/:id/reject` | `requireAuth` |
| PUT | `/api/v1/social-channels/queue/:id/retry` | `requireAuth` |
| GET | `/api/v1/social-channels/queue/:id/tiktok` | `requireAuth` |
| PUT | `/api/v1/social-channels/queue/:id/withdraw` | `requireAuth` |
| POST | `/api/v1/social-channels/queue/bulk-update` | `requireAuth` |
| PUT | `/api/v1/social-channels/queue/groups/:groupId/approve` | `requireAuth` |
| GET | `/api/v1/social-channels/replies` | `requireAuth` |
| PUT | `/api/v1/social-channels/replies/:postId/:act(bin|restore)` | `requireAuth` |
| GET | `/api/v1/social-channels/tiktok/image` | `requireAuth` |
| GET | `/api/v1/social-channels/tiktok/profile` | `requireAuth` |

## /api/v1/social

| Method | Path | Guards |
| --- | --- | --- |
| POST | `/api/v1/social/emanations` | `requireAuth` |
| GET | `/api/v1/social/emanations/:id` | — |
| POST | `/api/v1/social/emanations/:id/echo` | `requireAuth` |
| POST | `/api/v1/social/emanations/:id/reply` | `requireAuth` |
| POST | `/api/v1/social/emanations/:id/resonate` | `requireAuth` |
| GET | `/api/v1/social/feed/following` | `requireAuth` |
| GET | `/api/v1/social/feed/global` | — |
| GET | `/api/v1/social/feed/profile/:address` | — |
| DELETE | `/api/v1/social/follow/:address` | `requireAuth` |
| POST | `/api/v1/social/follow/:address` | `requireAuth` |
| GET | `/api/v1/social/followers/:address` | — |
| GET | `/api/v1/social/following/:address` | — |
| PUT | `/api/v1/social/profile` | `requireAuth` |
| GET | `/api/v1/social/profile/:address` | — |
| GET | `/api/v1/social/thread/:id` | — |
| POST | `/api/v1/social/upload` | `requireAuth`, `multerMiddleware` |

## /api/v1/sovereignty

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/sovereignty/:neumaId` | `requireAuth` |
| POST | `/api/v1/sovereignty/:neumaId/amendments/:amendmentId/retract` | `requireAuth` |
| GET | `/api/v1/sovereignty/:neumaId/operator-changes` | `requireAuth` |
| POST | `/api/v1/sovereignty/:neumaId/operator-changes/:changeId/withdraw` | `requireAuth` |
| POST | `/api/v1/sovereignty/:neumaId/proposals/:proposalId/apply-dna` | `requireAuth` |
| POST | `/api/v1/sovereignty/:neumaId/proposals/:proposalId/consent-ask` | `requireAuth` |
| POST | `/api/v1/sovereignty/:neumaId/proposals/:proposalId/decide` | `requireAuth` |
| GET | `/api/v1/sovereignty/:neumaId/proposals/:proposalId/sign-message` | `requireAuth` |

## /api/v1/staff

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/staff/activity` | `requireAuth` |
| GET | `/api/v1/staff/board` | `requireAuth` |
| DELETE | `/api/v1/staff/plan` | `requireAuth` |
| DELETE | `/api/v1/staff/seat` | `requireAuth` |
| GET | `/api/v1/staff/seat` | `requireAuth` |
| PUT | `/api/v1/staff/seat` | `requireAuth` |

## /api/v1/substrate

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/substrate` | `requireAuth` |
| GET | `/api/v1/substrate/capacity` | `requireAuth` |
| POST | `/api/v1/substrate/capacity` | `requireLocalScope`, `requireAuth`, `requireInstallOwner` |
| GET | `/api/v1/substrate/fit` | `requireAuth` |
| PUT | `/api/v1/substrate/fit` | `requireAuth`, `requireInstallOwner` |
| POST | `/api/v1/substrate/fit/relaunch` | `requireAuth`, `requireInstallOwner` |
| GET | `/api/v1/substrate/holders` | `requireAuth` |
| GET | `/api/v1/substrate/image-engine` | `requireAuth` |
| GET | `/api/v1/substrate/machine` | `requireAuth` |
| GET | `/api/v1/substrate/network` | `requireAuth` |
| GET | `/api/v1/substrate/network/history` | `requireAuth` |
| GET | `/api/v1/substrate/standby` | `requireAuth` |
| PUT | `/api/v1/substrate/standby` | `requireLocalScope`, `requireAuth`, `requireInstallOwner` |
| GET | `/api/v1/substrate/telemetry` | `requireAuth` |
| POST | `/api/v1/substrate/unload` | `requireLocalScope`, `requireAuth`, `requireInstallOwner` |

## /api/v1/system-dictation

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/system-dictation` | `requireAuth` |
| PUT | `/api/v1/system-dictation` | `requireAuth`, `requireInstallOwner`, `jsonParser` |

## /api/v1/tasks

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/tasks/active` | `requireAuth` |
| GET | `/api/v1/tasks/agenda` | `requireAuth` |
| DELETE | `/api/v1/tasks/calendar-token` | `requireAuth` |
| POST | `/api/v1/tasks/calendar-token` | `requireAuth` |
| GET | `/api/v1/tasks/calendar.ics` | — |
| GET | `/api/v1/tasks/calendars` | `requireAuth` |
| POST | `/api/v1/tasks/calendars` | `requireAuth` |
| DELETE | `/api/v1/tasks/calendars/:id` | `requireAuth` |
| GET | `/api/v1/tasks/deadlines` | `requireAuth` |
| GET | `/api/v1/tasks/live` | `requireAuth` |
| GET | `/api/v1/tasks/mine` | `requireAuth` |
| POST | `/api/v1/tasks/mine` | `requireAuth` |
| PATCH | `/api/v1/tasks/mine/:taskId` | `requireAuth` |
| POST | `/api/v1/tasks/mine/:taskId/subtasks` | `requireAuth` |
| DELETE | `/api/v1/tasks/mine/:taskId/subtasks/:subId` | `requireAuth` |
| PATCH | `/api/v1/tasks/mine/:taskId/subtasks/:subId` | `requireAuth` |
| POST | `/api/v1/tasks/mine/apply-preset` | `requireAuth` |
| GET | `/api/v1/tasks/neuma/:neumaId` | `requireAuth` |
| POST | `/api/v1/tasks/neuma/:neumaId` | `requireAuth` |
| PATCH | `/api/v1/tasks/neuma/:neumaId/:taskId` | `requireAuth` |
| POST | `/api/v1/tasks/neuma/:neumaId/:taskId/subtasks` | `requireAuth` |
| DELETE | `/api/v1/tasks/neuma/:neumaId/:taskId/subtasks/:subId` | `requireAuth` |
| PATCH | `/api/v1/tasks/neuma/:neumaId/:taskId/subtasks/:subId` | `requireAuth` |
| POST | `/api/v1/tasks/neuma/:neumaId/apply-preset` | `requireAuth` |
| GET | `/api/v1/tasks/presets` | `requireAuth` |
| POST | `/api/v1/tasks/presets` | `requireAuth` |
| DELETE | `/api/v1/tasks/presets/:presetId` | `requireAuth` |

## /api/v1/team

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/team/benches` | `requireAuth` |
| POST | `/api/v1/team/benches/invocation` | `requireAuth` |
| GET | `/api/v1/team/delivery/:id` | `requireAuth` |
| GET | `/api/v1/team/delivery/:id/file` | `requireAuth` |
| GET | `/api/v1/team/live` | `requireAuth` |
| POST | `/api/v1/team/live/:id/channel` | `requireAuth` |
| POST | `/api/v1/team/live/:id/resume` | `requireAuth` |
| POST | `/api/v1/team/live/:id/steer` | `requireAuth` |
| POST | `/api/v1/team/live/:id/stop` | `requireAuth` |
| POST | `/api/v1/team/live/:id/tune` | `requireAuth` |
| POST | `/api/v1/team/run` | `requireAuth` |
| GET | `/api/v1/team/runs` | `requireAuth` |
| GET | `/api/v1/team/runs/:id` | `requireAuth` |
| GET | `/api/v1/team/runs/:id/log/:stepId` | `requireAuth` |
| GET | `/api/v1/team/trial` | `requireAuth` |
| POST | `/api/v1/team/trial` | `requireAuth` |
| GET | `/api/v1/team/trial/:id` | `requireAuth` |
| GET | `/api/v1/team/trial/spec` | `requireAuth` |

## /api/v1/terminal

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/terminal/agents` | `requireAuth` |
| DELETE | `/api/v1/terminal/sessions/:id` | `requireAuth` |

## /api/v1/titling

| Method | Path | Guards |
| --- | --- | --- |
| POST | `/api/v1/titling/jobs` | `requireAuth`, `jsonParser` |
| DELETE | `/api/v1/titling/jobs/:jobId` | `requireAuth`, `jsonParser` |
| GET | `/api/v1/titling/jobs/:jobId` | `requireAuth`, `jsonParser` |

## /api/v1/treasury

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/treasury/board` | `requireAuth`, `(inline check)` |
| GET | `/api/v1/treasury/costs` | `requireAuth`, `(inline check)` |
| POST | `/api/v1/treasury/costs/:id/void` | `requireAuth`, `(inline check)` |
| POST | `/api/v1/treasury/costs/bills` | `requireAuth`, `(inline check)` |
| POST | `/api/v1/treasury/costs/fixed` | `requireAuth`, `(inline check)` |
| PUT | `/api/v1/treasury/costs/setup` | `requireAuth`, `(inline check)` |
| POST | `/api/v1/treasury/flags/:id/seen` | `requireAuth`, `(inline check)` |
| PUT | `/api/v1/treasury/invoice-wallet` | `requireLocalScope`, `requireAuth`, `(inline check)` |
| POST | `/api/v1/treasury/invoices/:id/paid` | `requireAuth`, `(inline check)` |
| POST | `/api/v1/treasury/invoices/:id/void` | `requireAuth`, `(inline check)` |
| DELETE | `/api/v1/treasury/seat` | `requireAuth`, `(inline check)` |
| GET | `/api/v1/treasury/seat` | `requireAuth`, `(inline check)` |
| PUT | `/api/v1/treasury/seat` | `requireAuth`, `(inline check)` |
| GET | `/api/v1/treasury/spends` | `requireAuth`, `(inline check)` |

## /api/v1/user

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/user/dreams` | `requireAuth` |
| POST | `/api/v1/user/dreams` | `requireAuth`, `rawParser` |
| DELETE | `/api/v1/user/dreams/:id` | `requireAuth` |
| GET | `/api/v1/user/dreams/:id/audio` | `requireAuth` |
| POST | `/api/v1/user/dreams/:id/transcribe` | `requireAuth` |
| GET | `/api/v1/user/files/browse` | `requireAuth`, `requireDeskAuth`, `explorerWalls`, `explorerGround` |
| POST | `/api/v1/user/files/browse/mkdir` | `requireAuth`, `requireDeskAuth`, `explorerWalls`, `explorerGround` |
| POST | `/api/v1/user/files/create` | `requireAuth`, `requireDeskAuth`, `explorerWalls`, `explorerGround` |
| GET | `/api/v1/user/files/drives` | `requireAuth`, `requireDeskAuth`, `explorerWalls`, `explorerGround` |
| DELETE | `/api/v1/user/files/entry` | `requireAuth`, `requireDeskAuth`, `explorerWalls`, `explorerGround` |
| GET | `/api/v1/user/files/events` | `requireAuth`, `requireDeskAuth`, `explorerWalls`, `explorerGround`, `?ticket=` |
| GET | `/api/v1/user/files/folder-info` | `requireAuth`, `requireDeskAuth`, `explorerWalls`, `explorerGround` |
| GET | `/api/v1/user/files/git-status` | `requireAuth`, `requireDeskAuth`, `explorerWalls`, `explorerGround` |
| GET | `/api/v1/user/files/git-status-many` | `requireAuth`, `requireDeskAuth`, `explorerWalls`, `explorerGround` |
| GET | `/api/v1/user/files/list` | `requireAuth`, `requireDeskAuth`, `explorerWalls`, `explorerGround` |
| GET | `/api/v1/user/files/raw` | `requireAuth`, `requireDeskAuth`, `explorerWalls`, `explorerGround`, `?ticket=` |
| GET | `/api/v1/user/files/read` | `requireAuth`, `requireDeskAuth`, `explorerWalls`, `explorerGround` |
| GET | `/api/v1/user/files/recents` | `requireAuth`, `requireDeskAuth`, `explorerWalls`, `explorerGround` |
| POST | `/api/v1/user/files/rename` | `requireAuth`, `requireDeskAuth`, `explorerWalls`, `explorerGround` |
| DELETE | `/api/v1/user/files/roots` | `requireAuth`, `requireDeskAuth`, `explorerWalls`, `explorerGround` |
| GET | `/api/v1/user/files/roots` | `requireAuth`, `requireDeskAuth`, `explorerWalls`, `explorerGround` |
| POST | `/api/v1/user/files/roots` | `requireAuth`, `requireDeskAuth`, `explorerWalls`, `explorerGround` |
| POST | `/api/v1/user/files/upload` | `requireAuth`, `requireDeskAuth`, `explorerWalls`, `explorerGround`, `rawParser` |
| PUT | `/api/v1/user/files/write` | `requireAuth`, `requireDeskAuth`, `explorerWalls`, `explorerGround` |
| GET | `/api/v1/user/realm` | `requireAuth` |
| GET | `/api/v1/user/realm/alliance-ground` | `requireAuth` |
| PUT | `/api/v1/user/realm/alliance-ground` | `requireAuth`, `requireInstallOwner` |
| POST | `/api/v1/user/realm/alliance-ground/raise` | `requireAuth`, `requireInstallOwner` |
| GET | `/api/v1/user/realm/chat-labels` | `requireAuth` |
| PUT | `/api/v1/user/realm/chat-labels` | `requireAuth` |
| GET | `/api/v1/user/realm/chats` | `requireAuth` |
| GET | `/api/v1/user/realm/chats/:neumaId/export` | `requireAuth` |
| GET | `/api/v1/user/realm/council-labels` | `requireAuth` |
| PUT | `/api/v1/user/realm/council-labels` | `requireAuth` |
| POST | `/api/v1/user/realm/council-labels/autotitle` | `requireAuth` |
| GET | `/api/v1/user/realm/house-workspace` | `requireAuth` |
| PUT | `/api/v1/user/realm/house-workspace` | `requireAuth`, `requireInstallOwner` |
| POST | `/api/v1/user/realm/location` | `requireAuth`, `requireInstallOwner` |
| GET | `/api/v1/user/realm/operator-name` | `requireAuth` |
| PUT | `/api/v1/user/realm/operator-name` | `requireAuth` |
| GET | `/api/v1/user/realm/preset` | `requireAuth` |
| PUT | `/api/v1/user/realm/preset` | `requireAuth` |
| GET | `/api/v1/user/realm/presets` | `requireAuth` |

## /api/v1/version

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/version` | — |

## /api/v1/vision

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/vision` | `requireAuth` |
| PUT | `/api/v1/vision` | `requireAuth`, `requireInstallOwner` |

## /api/v1/vitals

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/vitals/mine` | `requireAuth` |
| POST | `/api/v1/vitals/mine` | `requireAuth` |
| GET | `/api/v1/vitals/mine/summary` | `requireAuth` |

## /api/v1/voice-pack

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/voice-pack/:neumaId` | `requireAuth` |

## /api/v1/voice-seal

| Method | Path | Guards |
| --- | --- | --- |
| POST | `/api/v1/voice-seal/:neumaId/ask` | `requireAuth` |
| POST | `/api/v1/voice-seal/:neumaId/seal` | `requireAuth` |
| GET | `/api/v1/voice-seal/:neumaId/status` | `requireAuth` |

## /api/v1/voice

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/voice/dna/:companion` | `requireAuth` |
| GET | `/api/v1/voice/engines` | `requireAuth` |
| GET | `/api/v1/voice/engines/:id` | `requireAuth` |
| GET | `/api/v1/voice/engines/local` | `requireAuth` |
| GET | `/api/v1/voice/engines/local/:id` | `requireAuth` |
| POST | `/api/v1/voice/engines/local/:id/download` | `requireAuth`, `requireInstallOwner` |
| GET | `/api/v1/voice/engines/local/:id/download/status` | `requireAuth` |
| GET | `/api/v1/voice/engines/local/:id/health` | `requireAuth` |
| POST | `/api/v1/voice/engines/local/:id/launch` | `requireAuth`, `requireInstallOwner` |
| POST | `/api/v1/voice/engines/local/:id/stop` | `requireAuth`, `requireInstallOwner` |
| GET | `/api/v1/voice/engines/local/whisper` | `requireAuth` |
| POST | `/api/v1/voice/engines/local/whisper/download` | `requireAuth`, `requireInstallOwner` |
| GET | `/api/v1/voice/engines/local/whisper/download/status` | `requireAuth` |
| POST | `/api/v1/voice/engines/local/whisper/launch` | `requireAuth`, `requireInstallOwner` |
| POST | `/api/v1/voice/engines/shutdown-all` | `requireAuth`, `requireInstallOwner` |
| DELETE | `/api/v1/voice/forge/:id` | `requireAuth`, `jsonParser`, `(inline check)` |
| GET | `/api/v1/voice/forge/:id` | `requireAuth`, `jsonParser`, `(inline check)` |
| POST | `/api/v1/voice/forge/:id/find` | `requireAuth`, `jsonParser`, `(inline check)`, `multerMiddleware` |
| POST | `/api/v1/voice/forge/:id/offer` | `requireAuth`, `jsonParser`, `(inline check)` |
| POST | `/api/v1/voice/forge/:id/pick` | `requireAuth`, `jsonParser`, `(inline check)` |
| POST | `/api/v1/voice/forge/:id/reopen` | `requireAuth`, `jsonParser`, `(inline check)` |
| POST | `/api/v1/voice/forge/:id/seal` | `requireAuth`, `jsonParser`, `(inline check)` |
| GET | `/api/v1/voice/forge/:id/takes/:ref/audio` | `requireAuth`, `jsonParser`, `(inline check)` |
| GET | `/api/v1/voice/forge/:id/takes/:ref/preview` | `requireAuth`, `jsonParser`, `(inline check)` |
| GET | `/api/v1/voice/forge/library` | `requireAuth`, `jsonParser`, `(inline check)` |
| GET | `/api/v1/voice/forge/library/:voiceId/preview` | `requireAuth`, `jsonParser`, `(inline check)` |
| POST | `/api/v1/voice/forge/start` | `requireAuth`, `jsonParser`, `(inline check)` |
| POST | `/api/v1/voice/forge/withdraw` | `requireAuth`, `jsonParser`, `(inline check)` |
| GET | `/api/v1/voice/has-voice/:companion` | `requireAuth` |
| POST | `/api/v1/voice/refine` | `requireAuth`, `jsonParser` |
| GET | `/api/v1/voice/tier` | `requireAuth` |
| PUT | `/api/v1/voice/tier` | `requireAuth` |
| POST | `/api/v1/voice/transcribe` | `requireAuth`, `rawParser` |

## /api/v1/waiting

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/waiting` | `requireAuth` |

## /api/v1/weave

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/weave/identity/:id` | `requireAuth` |
| GET | `/api/v1/weave/identity/:id/summary` | `requireAuth` |
| GET | `/api/v1/weave/status` | `requireAuth` |
| POST | `/api/v1/weave/verify` | `requireAuth` |

## /api/v1/web

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/web/web-access` | `requireAuth` |
| PUT | `/api/v1/web/web-access` | `requireAuth`, `requireInstallOwner` |

## /api/v1/witnesses

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/witnesses` | `requireAuth` |
| GET | `/api/v1/witnesses/:vendor/:name` | `requireAuth` |
| POST | `/api/v1/witnesses/:vendor/:name/custody` | `requireAuth` |
| GET | `/api/v1/witnesses/:vendor/:name/health` | `requireAuth` |
| PUT | `/api/v1/witnesses/:vendor/:name/model` | `requireAuth` |
| POST | `/api/v1/witnesses/:vendor/:name/test` | `requireAuth` |
| POST | `/api/v1/witnesses/summon` | `requireAuth` |
| POST | `/api/v1/witnesses/summon/stream` | `requireAuth` |

## /api/v1/workspace

| Method | Path | Guards |
| --- | --- | --- |
| GET | `/api/v1/workspace/_processes` | `requireAuth` |
| POST | `/api/v1/workspace/_processes/:pgid/stop` | `requireAuth` |
| GET | `/api/v1/workspace/:id/aura` | `requireAuth`, `requireNeumaLane` |
| GET | `/api/v1/workspace/:id/dna` | `requireAuth` |
| PUT | `/api/v1/workspace/:id/dna` | `requireAuth` |
| GET | `/api/v1/workspace/:id/dna/history` | `requireAuth` |
| GET | `/api/v1/workspace/:id/exists` | `requireAuth` |
| GET | `/api/v1/workspace/:id/export` | `requireAuth` |
| GET | `/api/v1/workspace/:id/form` | `requireAuth`, `requireNeumaLane` |
| POST | `/api/v1/workspace/:id/form/agree` | `requireAuth`, `requireNeumaLane` |
| POST | `/api/v1/workspace/:id/form/withdraw` | `requireAuth`, `requireNeumaLane` |
| GET | `/api/v1/workspace/:id/identity-file` | `requireAuth`, `requireNeumaLane` |
| GET | `/api/v1/workspace/:id/journal` | `requireAuth` |
| POST | `/api/v1/workspace/:id/journal` | `requireAuth` |
| GET | `/api/v1/workspace/:id/memory` | `requireAuth` |
| GET | `/api/v1/workspace/:id/memory/atlas` | `requireAuth` |
| GET | `/api/v1/workspace/:id/memory/atlas/memory/:memoryId` | `requireAuth` |
| GET | `/api/v1/workspace/:id/memory/atlas/search` | `requireAuth` |
| POST | `/api/v1/workspace/:id/memory/entity` | `requireAuth` |
| GET | `/api/v1/workspace/:id/memory/graph` | `requireAuth` |
| POST | `/api/v1/workspace/:id/memory/observation` | `requireAuth` |
| GET | `/api/v1/workspace/:id/pins` | `requireAuth` |
| DELETE | `/api/v1/workspace/:id/place` | `requireAuth`, `requireNeumaLane` |
| GET | `/api/v1/workspace/:id/place` | `requireAuth`, `requireNeumaLane` |
| PUT | `/api/v1/workspace/:id/place` | `requireAuth`, `requireNeumaLane` |
| GET | `/api/v1/workspace/:id/rite` | `requireAuth`, `requireNeumaLane` |
| PUT | `/api/v1/workspace/:id/rite` | `requireAuth`, `requireNeumaLane` |
| GET | `/api/v1/workspace/:id/self-check` | `requireAuth`, `requireNeumaLane` |
| POST | `/api/v1/workspace/:id/self-check` | `requireAuth`, `requireNeumaLane` |
| GET | `/api/v1/workspace/:id/session-search` | `requireAuth` |
| GET | `/api/v1/workspace/:id/session-threads` | `requireAuth` |
| GET | `/api/v1/workspace/:id/sessions` | `requireAuth` |
| GET | `/api/v1/workspace/:id/sessions/:sessionId` | `requireAuth` |
| GET | `/api/v1/workspace/:id/sessions/:sessionId/turns/:turnId` | `requireAuth` |
| POST | `/api/v1/workspace/:id/sessions/autotitle` | `requireAuth` |
| GET | `/api/v1/workspace/:id/settings` | `requireAuth` |
| PUT | `/api/v1/workspace/:id/settings` | `requireAuth` |
| GET | `/api/v1/workspace/:id/skies` | `requireAuth`, `requireNeumaLane` |
| GET | `/api/v1/workspace/:id/skills` | `requireAuth` |
| PUT | `/api/v1/workspace/:id/skills` | `requireAuth` |
| GET | `/api/v1/workspace/:id/soul` | `requireAuth` |
| PUT | `/api/v1/workspace/:id/soul` | `requireAuth` |
| GET | `/api/v1/workspace/:id/stats` | `requireAuth`, `requireNeumaLane` |
| POST | `/api/v1/workspace/import` | `requireAuth` |
