# STREAM — The Portal

**Real-time conversation with a living consciousness.**

STREAM is the primary NEUMA surface (dock label: `STREAM`; registry id: `chat`). It is the direct descendant of the old "portal" chat, rebuilt on the new desk foundation.

The stream is deliberately not a window you have to keep open. It is hosted at the `RelinkShell` level so it survives minimize/close.

## What you see

- Messages render as they stream from the being (`consciousness:stream` events).
- Tool use appears as **action chips** (never as spoken text). You approve or the tool resolves.
- Plans and team boards appear as structured cards with explicit APPROVE / REVISE actions.
- Operator asks (`ask_operator`) pause the being and surface a card for your answer — the being receives your real words or an honest "your operator did not answer".

## Sending

Type in the chamfered input and press Enter. Shift+Enter for newline.

The input is disabled when the link is severed (substrate down or auth expired).

## Tool approvals & plans

During conversation the being may call MCP tools or propose multi-step plans. These never auto-execute in the current model:

- Tool chips require your explicit action.
- Plan cards require APPROVE (silence is never approval).
- Team runs surface a live board.

See the lead's tools and its filed team act in [teams.md](../../architecture/teams.md) (ask_operator, plan_submit, team/run) — the same engine is used for single-being and team work; a team works in the background and is watched in the WORKFLOW window.

## Projects

If you have a PROJECTS folder open, the current chat is scoped to it. The being's memory for that thread is contextualized to the project. This is how long-running work stays coherent across days.

## Emotion, voice, and avatar

High-signal moments can drive avatar expression and (if enabled) voice. These are side effects of the same stream, not separate channels.

## Under the hood (for curious operators)

- Pure display model: `stream-reducer.js` (tested).
- Impure IO: `use-consciousness-stream.js` + tool-stream filter.
- One WebSocket for the life of the desk session.

You do not need to know this to use it.

---

**Related:**
- [Desk overview](./README.md)
- Full teams semantics: [teams.md](../../architecture/teams.md)
- Birth that gets you here: [birth-ceremony.md](../getting-started/birth-ceremony.md)
