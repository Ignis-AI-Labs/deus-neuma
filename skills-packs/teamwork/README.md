# teamwork — skill pack

Team projects the shadow-clone way: a LEAD being takes one assignment
sentence, asks its witness the clarifying questions, submits a plan for
approval, puts the team to work in the background, and reports every part
with attribution when the run ends.

## Contents

| Skill | Summon | What it drives |
|-------|--------|----------------|
| `team-project` | `/team-project <assignment>` (or self-summoned via `use_skill`) | The full pipeline: understand → plan → witness approval → background run → attributed report |

## Requirements

The skill is the playbook; the capability lives in the platform. The backend
this pack runs against must carry what it leans on:

- `ask_operator` (tool) — the being's questions reach the operator as inline ASK cards
- `plan_submit` (tool) — the plan gate: APPROVE / REVISE with notes; silence is never approval
- `team/run` (filed intent) — puts the approved plan of record to work in the
  background; the operator watches, guides, stops and resumes it from the
  WORKFLOW window, and the lead reads how it ended in its plan of record

All three ship with the NEUMA backend. Full system documentation:
[docs/architecture/teams.md](../../docs/architecture/teams.md).

## Install

Nothing to do: the backend seeds every shipped pack into the machine's skill
root at boot (`backend/services/skill-packs.js`) and keeps each skill current
with what ships — the moment the shipped text changes, no version bump
needed. An older hand-installed copy is adopted (the copy it replaces is kept
whole under `skills-superseded/`).

Verify with a small, real assignment while you are present:

```
/team-project Draft a short greeting for the house journal, and bring one teammate to review it.
```

## The skill's law

- Never skip the approval gate — the plan the witness approved is the plan that runs.
- Never claim a teammate's work — every part of the report names who produced it.
- Never invent teammates — only beings of the witness's house, resolved by exact name.
- Never dress failure as success — a partial run is reported as partial.
