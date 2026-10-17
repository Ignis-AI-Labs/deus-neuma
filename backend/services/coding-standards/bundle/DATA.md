# Data ownership and persistence

Apply when a change touches storage, service clients, caches, or shared metrics.

- Name the system of record for each datum. Mirrors and caches retain provenance and freshness; define reconciliation explicitly. A display metric has one selector/provider, shared by all its consumers.
- Centralize environment configuration and client construction. Reuse connections at the correct lifetime: process-scoped pools, request-scoped authenticated clients, or tenant-scoped clients. Never share a user's mutable credentials across requests.
- Validate external responses and handle errors separately from legitimate absence. Never cache a failure as an empty success. Cache empty results only when absence is authoritative and the expiry/invalidation policy is explicit; skip uncertain empty discovery responses.
- Choose cache freshness from the product's consistency requirement. Transaction decisions and value proofs use authoritative state; label delayed display data. Do not turn caching into a second source of truth.
- Use the repository's migration tool and ordering convention. Shipped migrations are append-only. Test upgrade paths with existing data; verify schema, constraints, grants, and real-role access afterward.
- Do not drop and recreate database functions by default. Preserve dependencies and permissions; use a reviewed migration when a signature or privilege change requires replacement.
- Use transactions and uniqueness constraints for atomic updates and idempotency. For important files, write safely and verify read-back; preserve the previous valid state on failure.
- Keep one owner for serialization and schema versions. Test save/load and migration round trips; do not serialize derived state as authoritative input.
