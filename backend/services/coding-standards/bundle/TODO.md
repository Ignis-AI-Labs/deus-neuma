# Task tracker format

Use this format when the repository chooses a local `TODO.md`. Do not add it alongside an existing authoritative issue tracker just to satisfy a template.

```markdown
# Tasks

| ID | Status | Task / acceptance criterion | Owner | Updated |
| --- | --- | --- | --- | --- |
| STD-001 | open | Generate both instruction files from one source | — | YYYY-MM-DD |
```

Statuses: `open`, `in progress`, `blocked`, `done`, `deferred`. Keep IDs stable. A blocked or deferred task names the reason and next action. A completed task links its verification or commit when available.

Group by domain only when useful. Do not maintain manual summary counts that duplicate the rows. Archive completed rows when the file becomes hard to scan; preserve links and history. Work-in-progress context belongs in the work ledger described in [WORKFLOW.md](./WORKFLOW.md).
