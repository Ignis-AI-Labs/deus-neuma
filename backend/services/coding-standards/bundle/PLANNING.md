# Delivery — understand, change, prove

- Establish the requested outcome and acceptance criteria. Inspect repository instructions, working-tree changes, entry points, and existing patterns. Read only relevant modules; expand when dependencies require it.
- For substantial work, keep a short plan with affected surfaces and verification. For a small edit, proceed directly. Batch independent reads and checks; serialize dependent changes and shared-state operations.
- Fix the cause across the affected bug class. When return values, errors, schemas, routes, or events change, inspect every caller and update dependent code, tests, and documentation together.
- Check queries against the actual schema, including missing versus null fields. Handle query errors before using results to authorize an action or infer absence.
- Reproduce review findings before accepting them. Rate severity by demonstrated impact; record unresolved findings with location, evidence, owner, and next action.
- Use additional agents or external reviewers only when the task or repository workflow calls for them and tools are available. Give bounded scopes; do not duplicate work. An unavailable or failed review is unreviewed, not approved.
- Finish authorized work through verification and a clear handoff. Ask for a missing decision only after making the dependent result concrete enough to review.
