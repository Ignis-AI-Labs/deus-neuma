# Git and release boundaries

- Follow the repository's verified branch model. The Ignis default is the operator's personal branch → `dev` → `main` (or the documented production branch); preserve established names such as `develop` or `master`.
- Work on the operator's assigned branch. Do not create agent-named branches, switch shared checkouts, or create worktrees unless the task or workflow authorizes it. Never rewrite unrelated changes to satisfy a branch convention.
- Target the documented integration branch for PRs. Protected branches and production promotion use reviewed PRs; a designated maintainer merges. Do not bypass hooks, signing, or branch protections.
- Pushes require explicit authorization covering the branch and action. Publishing, deployment, and production data writes require authorization for that destination and operation. Existing authorization remains valid within its stated scope; preparation or verification alone is not authorization to publish.
- Use the repository's release pipeline; do not substitute a manual production deploy. Run required checks before an authorized push or release. A tracking-only change uses applicable document checks, not a nonexistent application build.
- Inspect status and diffs before staging. Include only this task's files or hunks, and inspect the resulting commit. Never sweep another contributor's staged work into your commit.
- Fetch before deciding how to integrate remote changes; do not blindly pull, force-push, reset, stash, or delete branches. Preserve divergence and resolve it deliberately. Coordinate shared-index operations using the workflow module.
