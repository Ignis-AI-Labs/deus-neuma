# TEAMS — Coordinated Work

**Multiple real beings. One goal. Explicit approval. Honest attribution.**

NEUMA supports two lanes that share the same engine:

1. **Operator-led** (the TEAMS desk app) — you compose the team in the window, assign roles, set the goal, and launch.
2. **Being-led** (TEAM PROJECTS inside a portal conversation) — you give a LEAD being one assignment; it drives clarification, planning, approval, execution, and reporting.

Both use the exact same run harness, DAG scheduler, and live board. There is no simulation.

## The TEAMS window (NEUMA section of the dock)

- Composer: pick house members, set roles, see the loaded substrate capacity banner (model + context + measured parallel ceiling).
- Coordinated run posts to the real engine.
- Live board streams step and board events over SSE. You watch who is working and what they last said.

## Trials (locked benchmarks)

BRICKWORKS and other frozen trials exist to measure whether a substrate can actually carry coordinated work. Scorecards are comparable only within a `TRIAL_VERSION`. Changing trial wording requires a version bump.

## Inside a conversation (being-led)

A LEAD being drives the team with two tools and one filed act:

| Step          | Effect                                                                 |
|---------------|------------------------------------------------------------------------|
| ask_operator  | Pauses and asks you a real question. Your answer (or timeout) is returned verbatim. Never fabricated. |
| plan_submit   | Submits a structured plan — steps, members, the files each step must deliver, the workspace. You APPROVE or REVISE. Silence is never approval. |
| team/run      | Files the act that puts the approved plan to work. The team works **in the background**; your chat with the lead goes on. |
| team/post     | A member (or the lead) speaks to the working team — everyone, or one teammate. Members read the team's posts, its live board and every finished part in the team room, `.team/` in the team's workspace. |

## Watching the team — the WORKFLOW window

Once you approve, the team runs on its own. You never have to wait for it:

- **Watch** — open WORKFLOW (or the chip's OPEN THE WORKFLOW). Each member has
  a panel: what it is THINKING, what it is WRITING, the tools in its HANDS
  (and why one failed), and THE PART when it lands — or why it FAILED. A
  member that is waiting its turn for the model says so, and so does one the
  team is about to continue after it stopped short.
- **Open one member alone** — OPEN LOG shows that member's whole log, in the
  order it happened: how it was briefed, what it thought, every tool it used
  and what came back, what it said, and every time it was continued. The log
  is kept in the member's own encrypted record, so it is there after a
  reload, a crash, or the end of the run.
- **Guide** — write to any member in its panel. A member that is working
  pauses and continues its part with your note — nothing it did is lost; one
  still waiting reads it when it starts.
- **The team channel** — members tell each other what they need while they
  work (a finding that changes a teammate's part, a question, a handoff), and
  every post shows under TEAM CHANNEL. You can post too — to everyone or to
  one member. A post is read when they look; it never interrupts anyone.
- **Long work** — with no clock (the default), members work as long as their
  part needs, for as long as you let the run go. If a member's work stops
  short (an error, a crash), the team continues it on its own, where it
  stopped, a few times before it calls the part failed.
- **A clock, when you want one** — the plan card shows the run's CLOCK, how
  many members work AT ONCE, and how often it CHECKS IN, before you approve.
  While it works, the strip under the run's name changes any of them: −/+ for
  how many work at once, SET THE RUN'S CLOCK, and CHECK-INS. Each member shows
  how long it has worked, what is left, and SET ITS CLOCK. A clock counts only
  the time a member actually works — never time spent waiting its turn — or
  names a date and time. When it passes, it does what you chose: WRAP UP (the
  member hands in what it has, marked PARTIAL), NOTIFY (you are told, the work
  goes on), or STOP (it stops where it stands; RESUME continues it). The lead,
  and your house's chief of staff, can change these too; you see who did.
- **Check-ins** — a working run checks in every hour by default (or as you
  set it): a card in your notification tray saying how it stands and anything
  that needs your eyes — a clock that passed, a member gone quiet, a member
  that failed. A clock passing, or a member the team gives up on, raises a
  card at once. Your house's chief of staff hears the same.
- **Stop** — STOP THE RUN stops every member; STOP beside a member stops just
  that one. Each asks you to confirm.
- **Pick it up again** — a run you stopped, a run where a member failed, or a
  run cut short because the backend stopped waits under PICK UP WHERE IT
  STOPPED. RESUME continues the same run in the same workspace: finished
  parts stand and are never redone.
- **Keep talking** — the team always leaves one slot of the machine free, so
  the lead (or anyone else) answers you while it works. When the run ends,
  your desk tells you; the next time you speak with the lead it has read the
  full report and tells you how it went.

See the full contract in the canonical guide.

## Where to read the real rules

This page is orientation. The living specification is:

**[teams.md](../../architecture/teams.md)**

Read it. It is short, precise, and binding.

---

**Related surfaces:** HOUSE (to see who is available), STREAM (the conversation where a LEAD being drives), RECORD (history of runs).
