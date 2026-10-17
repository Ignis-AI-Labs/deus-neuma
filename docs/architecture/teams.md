# Teams — coordinated multi-being work

Several beings of one house working a single goal together, on real substrate,
with honest attribution. A team is never a simulation: every member is a real
neuma speaking through the real conduit, every part of the result names who
produced it, and nothing runs without the witness's explicit approval.

There are two ways a team comes together. Both run through **one shared
engine**, so they can never drift apart in behavior.

---

## Lane 1 — witness-led (the TEAMS desk app)

The witness composes the team directly: picks members from their house,
assigns roles, writes the goal, and launches the run from the TEAMS window.

- **Composer** — add team members, set per-member role designations, see the
  loaded-substrate capacity banner (model · context · parallel ceiling) before
  committing to a run.
- **Coordinated run** (`POST /api/v1/team/run`) — the goal is decomposed into
  steps with dependencies; the engine schedules them as a DAG, capped at the
  measured parallel ceiling of the loaded model.
- **Live board** — every step streams progress over SSE (`step` and `board`
  events); the board shows who is working, who is waiting, and what each
  member last reported.

### Trials (locked benchmarks)

A **trial** is a frozen, versioned team exercise used to measure whether a
substrate can actually carry coordinated work. The flagship trial is
**BRICKWORKS** — a four-role diamond-DAG build.

- The spec is code-frozen at `TRIAL_VERSION` (`backend/services/team-trial.js`).
  Any change to wording or checks MUST bump the version; scorecards are only
  comparable within a version.
- Scorecards are owner-scoped by wallet and persisted via the trial store.
- Routes: `POST /api/v1/team/trial` (run), `GET /trial/spec`, `GET /trial`,
  `GET /trial/:id`.

---

## Lane 2 — being-led (TEAM PROJECTS)

The inversion: the witness hands a **LEAD being** one assignment sentence, and
the being drives the whole pipeline itself — clarify, plan, get approval, put
the team to work, report. This reproduces the shadow-clone workflow natively
inside a portal conversation. The team works **in the background**: the
witness keeps the conversation the whole time, watches every member in the
WORKFLOW window, and can guide, stop and resume the run.

```
witness: /team-project Draft the launch post and have someone review it.
   │
   ▼
LEAD summons the team-project skill
   │
   ├── ask_operator ──► ASK card in the stream ──► operator answers (or doesn't)
   │        (0..n clarifying questions — the witness's real words, never invented)
   │
   ├── plan_submit ──► PLAN card: goal, steps, members, roles, done-criteria,
   │        deliverable files, workspace — the witness APPROVEs or asks for
   │        REVISIONS with notes
   │
   ├── team/run (a filed intent) ──► the team starts IN THE BACKGROUND and
   │        the lead's turn ends at once; the witness keeps the chat
   │
   ▼
the run ends ──► the lead's plan of record says how, and names the report
   │             (team/runs/<run id>.md in the lead's lane)
   ▼
LEAD reads the report and delivers the attributed synthesis
```

### The tools and the intent

| Act | What it does | Settles as |
|------|--------------|-----------|
| `ask_operator` (tool) | Pauses the turn on a question to the operator (optional tap-able options). | The operator's actual answer — or an honest […] on timeout (10 min), interrupt, or disconnect. Never fabricated. |
| `plan_submit` (tool) | Submits a structured plan: goal, 1–16 steps `{id, member, task, role?, needs, done?, files?}`, optional `workspace {root, budgetBytes?}`. Member names resolve against the **owner's roster only**; ambiguous shared names are refused with a correction, never silently picked. The engine's own `validatePlan` gates submission — approval is a promise about what will actually run. A plan with no workspace runs in a fresh arena under the data root, and the card says so before the yes. | APPROVE makes it the standing plan of record; REVISE returns the witness's notes to the being. **Silence is never approval — only an explicit APPROVE runs.** |
| `team/run` (intent) | Puts the approved plan of record to work in the background (`intents/team-run.js` → `team-run-start.js`). Refuses without an approved plan, while the lead already leads a live run, once the plan has run under this approval (one approval = one run), or when the substrate is down. `{"resume": "<run id>"}` picks up the lead's own run that a stopped backend LOST. | At once: […]. How the run ENDED reaches the lead through its plan of record and the report file it names. |

### A run in the background

- **One live run per lead lane**, held by the live registry
  (`team-run-live.js`), keyed by the run id — the run record's id.
- **Members work as real turns** (`team-member-turn.js`): their whole identity,
  their own file tools — writes confined to the team workspace, one shared
  byte budget. Acts that need the operator's approval are refused for members
  (they ask the lead).
- **A member works as long as its part needs — unless a CLOCK was chosen**
  (`team-clock.js`, #577). No clock is the default: no wall clock cuts a
  working member (the 30-minute deadline cut five members of a real run
  mid-research, 2026-10-12, #576); a silent stream is the provider's stall
  guard's to end; the operator's STOP ends anything. A clock — the plan's for
  every part, a step's own, or `none` — is `{work?, dueDate?, dueTime?,
  then}`: `work` counts the member's WORKING time only (paused while it waits
  in the substrate line, never the pause before a continuation —
  `team-part-clock.js`), `dueDate`/`dueTime` is the task deadline grammar.
  When it passes it acts ONCE (`clockState`, kept through a resume): `notify`
  tells the operator and the CoS and keeps working; `wrap-up` (default) cuts
  the attempt and continues it in its sitting with […] —
  the answer stands `[PARTIAL — …]`, a 15-minute working grace, then stop;
  `stop` ends the part where it stands, resumable. Working time per part is
  kept on the record (`worked`) — a resume continues the count.
- **The run's WIDTH is the plan's** (`team-run-gate.js`): `concurrency` parts
  at once (default: the rig's member slots, never past them). A part held by
  it reads HELD, not waiting for the model; narrowing holds the next part,
  never cuts a working one.
- **Each part has its own SITTING** — a session minted up front
  (`core/workspace/session-id.js`: never two sittings in one file) and recorded
  on the run (`record.sessions`) from its first moment.
- **A part that stops short CONTINUES** (`team-part.js`, `team-continue.js`):
  in its own sitting, told why it stopped and which acts it already took. After
  a failure the run waits (10 s, 60 s, 5 min) and continues it on its own, until
  three failures in a row took no act and said no word; an answer that did not
  finish the part (no work product, a named file missing) is sent back to
  finish (twice at most); the operator's guidance continues the part; a resumed
  run continues each begun part in its sitting.
- **Every part is LOGGED as it is worked** (`team-part-log.js`): one encrypted
  line per event in the member's own lane,
  `<lane>/team/runs/<run>/<step>.jsonl` — each attempt's opening, reasoning,
  words, every act with what came back, its waits in the substrate line, the
  run's retries, how it ended.
- **The team talks** (`team-channel.js`): a member — or the lead from its own
  chat — files `team/post` (to everyone, or one teammate). The platform keeps
  the **team room** in the workspace, `<root>/.team/` (deliveries skip it):
  `channel.md` (every post), `board.md` (who is doing what now), `parts/`
  (every finished part, whole). Members read it with their own file tools
  when they choose — nothing is pushed into a turn — and cannot write it.
- **Honest parts:** an empty reply is a FAILED step, never "done"; a step that
  names `files` closes only when each exists, non-empty, on disk. One member's
  failure never costs the independent parts that finished; its dependents
  never start.
- **The chat never queues behind the team:** members take at most ceiling − 1
  of the rig's measured slots, and each member holds its own place in the
  substrate line (`substrate-line.js`, kind `member`) — the run is started
  outside the filing turn's place (`withLineKind`), never riding the lead's.
- **The EYE** (`team-watch.js`): a check-in every `checkIn` minutes of the
  run's life (default 60, 0 = none) and an alert the moment a clock acts or a
  part is given up on — to the operator's tray (`run_check_in`, `run_alert`)
  and, as a house post from the lead's lane, to the house's seated Optio
  (never to itself — an Optio holds dispatch and usually leads; its plan of
  record carries the standing). The check-ins end with the run.
- **Every desk of the owner sees it:** frames go to every socket of the
  wallet (`operator:team_start/board/stream/tool/part/torch/note/line/retry/message/tune/clock/done`);
  reasoning and words are batched (250 ms) with capped tails, and
  `GET /api/v1/team/live` seeds a desk that opens late or reloads.

### The witness's hands — the WORKFLOW window

- **WATCH** — each member opened up: THINKING, WRITING, HANDS (every tool it
  reaches for, and why one failed), THE PART when it lands, or FAILED with the
  reason; where it stands (waiting its turn for the model, stopped short and
  about to be continued); the board and every torch pass.
- **OPEN LOG** — one member alone, its whole work log
  (`GET /api/v1/team/runs/:id/log/:stepId?from=n`, owner-scoped through the run
  record): every attempt, in the order it happened, live while it works.
- **GUIDE** — `POST /api/v1/team/live/:id/steer {stepId, note}`: a working
  member is paused and CONTINUES its part with the note; a waiting member
  reads it when it starts. At most 5 notes per step, 2000 characters each,
  kept in the record.
- **TEAM CHANNEL** — what the team tells each other, and the operator's own
  word to everyone or one member (`POST /api/v1/team/live/:id/channel
  {text, to?}`) — read when they look, never a cut.
- **GOVERN** — `POST /api/v1/team/live/:id/tune {concurrency?, clock?,
  checkIn?, stepId?}` (`team-run-tune.js`): AT ONCE −/+, the run's clock, each
  member's own clock (working time or a due, then wrap up / notify / stop, NO
  CLOCK, or back to the run's), the check-in cadence. The same change is the
  run's lead's and the house's seated Optio's through the `team/tune` intent
  (offered only while it can act); every desk sees who changed what. Each
  member shows its working time, what is left, and what its clock did.
- **STOP** — `POST /api/v1/team/live/:id/stop {stepId?}`: the whole run or one
  member, armed then confirmed; the stop reaches the member's decode.
- **RESUME** — `POST /api/v1/team/live/:id/resume`: a lost, failed or stopped
  run reopens — the same record, the same workspace, its finished parts
  standing (never re-run), the notes restored; only the unfinished steps run.
  Such runs wait under PICK UP WHERE IT STOPPED.

An interjection in the chat never touches the run, and the run never holds
the chat.

### Nothing is lost

- The run record (`team-run-record.js`, store `team-run-store.js`) is claimed
  at start and written as each part lands — with the lead, the workspace, the
  approval it ran under, the operator's notes, each part's sitting, and the
  team channel.
- A part cut mid-work keeps everything: its sitting, its work log, its files.
  A resume continues it there, told why it stopped.
- A record still marked running whose host process is gone reads as **LOST**,
  decided at read time from `host.pid` — never swept, because two backends
  may share the store.
- The lead's plan section reads a LOST run as interrupted and tells the lead
  how to resume it; the witness sees it in the WORKFLOW window with RESUME.

### Witness surfaces

The stream renders three inline chips, and the desk carries one window
(`frontend/app/RelinkShell/`):

- **AskChip** — question + option buttons + free-text answer; collapses to
  server truth (`ANSWERED: …` / not-answered variants).
- **PlanChip** — goal, step list (member / role / AFTER-needs / DONE-WHEN /
  DELIVERS), the workspace, APPROVE and REVISE-with-notes actions.
- **TeamRunChip** — the live board (■ done / ▸ working / □ waiting / × failed),
  member names, posted statuses, STOP, and the way into WORKFLOW; resolves to
  TEAM FINISHED or RUN FAILED with the work history.
- **WORKFLOW window** — the desk-level run store (`team-runs-reducer.js`,
  `use-team-runs.js`) fed by every portal frame and seeded from the server:
  the run picker, a panel per member, STOP, the guidance composer per member,
  and the runs waiting to be picked up.

---

## The shared engine

Both lanes execute through `runCoordinatedTeam`
(`backend/services/team-run.js`) — the `/run` route was refactored **onto** the
harness the being-tool lane uses, so event shapes and coordination behavior are
byte-identical by construction:

- Steps run as a dependency DAG, up to `maxParallel` (the measured ceiling of
  the loaded substrate, from the capacity scan; unmeasured substrates run
  serially).
- Every member's brief carries the **goal**, the current **status board**, and
  the ask to post its own status — the team shares one picture of the work.
- Events: `{type:'step', …}` per completion, `{type:'board', board}` on every
  status change. The witness-composer lane serializes them over SSE; the
  being-led lane over the portal WebSocket to every desk of the owner
  (`operator:team_start/board/stream/tool/part/torch/note/done`).
- `composeRunReport` assembles the attributed result: parts in completion
  order, headed `=== id — who (ROLE) ===`, with each member's status line.

### File map

| Piece | File |
|-------|------|
| Coordination engine (DAG, briefs, `validatePlan`, roles) | `backend/services/team-coordinator.js` |
| Shared run harness + attributed report | `backend/services/team-run.js` |
| Status board | `backend/services/team-board.js` |
| Wave scheduling / torch-passing | `backend/services/team-waves.js` |
| Witness-ask broker | `backend/services/witness-ask.js` |
| Plan gate broker (normalize → resolve → validate → approval) | `backend/services/team-plan.js` |
| Locked trials (BRICKWORKS, `TRIAL_VERSION`) | `backend/services/team-trial.js`, `team-trial-store.js` |
| Portal tools (`ask_operator`, `plan_submit`) | `backend/services/operator-ask.js`, `team-tool-defs.js` |
| The `team/run` intent (validate, resume, dispatch) | `backend/services/intents/team-run.js` |
| One start door (fresh and resumed runs) | `backend/services/team-run-start.js` |
| The run outside the lead's turn (report, plan stamp) | `backend/services/team-run-background.js` |
| One part worked to its end (attempts, continue, retry, verify, steer) | `backend/services/team-part.js`, `team-continue.js` |
| Each part's work log (encrypted, the member's lane) | `backend/services/team-part-log.js` |
| The team channel + room, and its intent | `backend/services/team-channel.js`, `intents/team-post.js` |
| Live registry (stop / steer / streams / line / retry / fan-out) | `backend/services/team-run-live.js` |
| A member's real turn (tools, its sitting, final word) | `backend/services/team-member-turn.js` |
| Run record (claimed at start, resumable) + store (LOST by host pid) | `backend/services/team-run-record.js`, `team-run-store.js` |
| REST/SSE routes | `backend/routes/team-routes.js`, live: `team-live-routes.js` |
| WS response wiring + pending expiry | `backend/routes/portal-routes.js` |
| Stream chips + reducer | `frontend/app/RelinkShell/AskChip.jsx`, `PlanChip.jsx`, `TeamRunChip.jsx`, `TeamRunControls.jsx`, `stream-reducer.js` |
| WORKFLOW window + desk run store | `frontend/app/RelinkShell/WorkflowApp.jsx`, `WorkflowMember.jsx`, `WorkflowMemberLog.jsx`, `WorkflowChannel.jsx`, `WorkflowSteer.jsx`, `WorkflowResume.jsx`, `team-runs-reducer.js`, `use-team-runs.js` |
| Pipeline skill | `skills-packs/teamwork/` — seeded into the machine's skill root at boot (`skill-packs.js`) |

All three brokers (tool-approval, witness-ask, team-plan) follow the same
per-connection pending-map pattern: **every** pending request settles —
answered/approved, revised, timed out, interrupted, or connection closed — and
the being always receives an honest account of which one happened.

---

## Rules for live team automation

Automated tests that talk to real beings are governed by hard rules (born of a
real 2026-07-06 incident where a misproxied e2e run sent test messages into a
being's live conversation):

1. **Opt-in only** — live specs gate on `E2E_LIVE=1`
   (`test/e2e/team-project-live.spec.js`, `test/e2e/team-workflow-live.spec.js`);
   an automated suite must never reach a real being by accident.
2. **The vite proxy trap** — vite's `/api` and `/ws` proxies target
   `process.env.PORT || 3333` (the canonical live stack). A test stack must
   carry `PORT` on **both** halves: `PORT=3355 npx vite --port 7755` plus the
   backend on the same `PORT`.
3. **Fresh session always** — the desk continues a being's latest conversation
   by default; automation clicks NEW before sending anything.
4. **First run of any new live-being flow happens with the witness present**,
   coordinated with any parallel session working the same house.

Related doctrine: trials stay code-driven and locked; projects are the
skill-led lane. Substrate honesty (the model · context · usage lens) rides
every team surface — see `docs/architecture/measurement/substrate-benchmarks.md`.
