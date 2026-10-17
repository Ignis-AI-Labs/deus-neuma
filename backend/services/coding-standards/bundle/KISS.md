# KISS — the smallest correct design

- Build the simplest change that satisfies the requirement and preserves security, correctness, and maintainability.
- Search before creating. Reuse the existing owner of a fact, configuration value, service, or behavior; remove duplicate sources of truth.
- Extract a shared primitive when real duplication or a clear boundary justifies it. Do not wait for an arbitrary third copy of a correctness rule.
- Add no speculative features, fallback paths, dependencies, or abstractions. Keep necessary compatibility paths until their consumers have migrated.
- Prefer readable control flow over clever compression. Remove dead code and obsolete scaffolding; do not equate fewer lines with better behavior.
- Justify extra checks by the failure they prevent. Keep checks at distinct trust boundaries: authentication, authorization, and data isolation prove different things.
- Measure performance changes at realistic and worst-case bounds. Preserve observable behavior and pin important improvements with repeatable checks.
