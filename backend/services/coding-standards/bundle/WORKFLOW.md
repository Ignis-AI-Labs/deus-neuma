# Work ownership and handoff

Use the repository's existing task tracker. Coordination is required when work overlaps; a solo, short task does not need a second tracking system.

## Claim work where others can see it

- Record the task, owner, status, and scope in the agreed shared tracker before overlapping implementation. Check existing claims first.
- A claim on a personal branch is not an atomic lock across other branches. Use one shared tracker or explicit coordination; concurrent pushes to different branches do not establish a winner.
- A claim does not authorize a push or an external message. If publication is not authorized, record local ownership and continue independent work; resolve overlapping ownership before editing shared areas.
- Keep one canonical task status. Use a work ledger for uncommitted implementation context, not a duplicate issue tracker.

## Preserve work across interruption

For substantial or shared work, keep a short entry in the project's work-log directory with: request, owner/session, files or symbols owned, completed steps, checks and results, remaining work, and exact next action. Update at useful checkpoints and before a long operation. Record implementation complete, committed, and published separately; do not imply an unpushed result is published.

## Shared resources

- Treat unknown dirty or staged changes as someone else's work. Continue where independent; coordinate overlapping symbols. Never clean up, revert, or commit another person's work without authorization.
- Serialize commits in a shared checkout. Inspect both staged and working-tree changes; stage explicit paths or reviewed hunks. If ownership or index isolation is uncertain, leave the patch intact for the operator instead of risking a mixed commit.
- Use assigned runtime roots and port ranges, or ephemeral ports for tests. Check resource ownership before starting heavy jobs. Stop only processes you started and still own.
- Put probes in an ignored scratch directory or a system temporary directory. Keep durable tools in `scripts/` and evidence in the relevant docs directory. Clean up only your own temporary files.

## Complete or hand off

Report the result, exact validation scope, pending decisions, and remaining gaps. Record follow-up work with evidence; close findings only when the fix has been verified. External tracker updates follow the same authorization rules as other outward actions.
