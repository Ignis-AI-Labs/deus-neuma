# Functional design — explicit data, isolated effects

- Keep computation pure: explicit inputs and outputs, no mutation of caller-owned data. Isolate I/O and state changes in named adapters or entry points.
- Prefer immutable values and composition. Use idiomatic loops or bounded local mutation when clearer or measurably cheaper; do not introduce shared mutable state or hide side effects.
- Give each function and module one coherent responsibility. Split by domain and dependency direction, not an arbitrary parameter or line count. Extracted modules must not import their former orchestrator.
- Put new capabilities in focused modules when they introduce a distinct responsibility. Keep the orchestrator thin; preserve documented public interfaces during decomposition.
- Default handwritten source, tests, styles, and scripts to at most 500 lines. A 501–1,000-line file needs a header `SIZE EXCEPTION:` with a concrete reason. Above 1,000 is decomposition debt; no new offender. Generated files, data, and prose are excluded. Existing offenders use a reviewed, shrink-only baseline; never grow the baseline to silence a failure.
- Use the language's type system and naming conventions. Validate untyped boundaries at runtime; make unsafe escapes explicit and narrow.
- Propagate errors to the boundary that can handle them. Do not swallow failures, convert failed checks into empty success, or add catch-and-rethrow boilerplate everywhere.
- Make important architecture and size rules executable in the repository's lint/CI tools. A passing size check alone does not prove good structure.
