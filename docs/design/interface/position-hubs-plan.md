# Position hubs — one place per position, for the operator and for the being

**Status:** slice 1 built and tested, uncommitted (2026-11-14). **Asked by:** Design note, 2026-11-14. **Ledger:** `docs/work/position-hubs.md`.

## The problem, measured

A position's work is scattered three ways:

1. **Its screens.** Sales alone is in four places: COMPANY LINE → SALES and LEAD ENGINE,
   SETTINGS → API → Email, Connections (the mailbox watch), MARKETING → LEADS.
2. **Its seat.** Each position is filled in a different window with a different control
   (Mercator and Logista in COMPANY LINE, CMO in MARKETING, CSO in SECURITY, CLO in LEGAL,
   CFO in TREASURY, Optio in CHIEF OF STAFF). HOUSE → POSITIONS changes a member's *title*
   only; it seats nobody. A house can read "Mercator" on a member's card while the sales seat
   is empty.
3. **What the being is told.** Its seat's briefing is one section, but the acts and tools the
   seat unlocks are spread across the whole catalog with no map.

## The shape

**One window: POSITIONS.** It leads the WORK band.

- **Left: every position of the house**, one row each: a light (held / empty), the plain
  name first (SALES), the title second (Mercator), who holds it, and the count waiting on
  the operator. An empty seat is loud.
- **Right: the chosen position's hub.**
  - **Head** — who holds it, SEAT / UNSEAT (the same control for every position), TALK (the
    stream with the holder).
  - **WAITING ON YOU** — only this position's decisions, each a door to its card.
  - **Function tabs** — everything the position handles, each rendered in place from the
    screen that exists today. Nothing is rewritten and nothing is lost.
  - **SWITCHES** — the connections this position needs, with their state and the door to
    turn them on.
  - **THEIR EYES** — the exact briefing the being reads at the top of its turn, and the map
    of acts it may file. The operator sees what the being sees.

**One source of truth:** `backend/services/positions/position-map.js`. Each position names
its functions, the acts behind each function, the connections it needs and which waiting
items are its own. The window reads it; the being's prompt reads it. They cannot disagree.

**The being's side:** the holder of a seat reads one short section, YOUR POSITION, before
its office briefing: each function it handles and the acts that do it. Every other lane
reads nothing (the empty-string law holds).

## What each hub holds

| Position | Functions (rendered from) |
| --- | --- |
| SALES · Mercator | LEADS (lead engine) · DEALS (pipeline, delivery) · MAILBOX (the house email account, its watch) |
| MARKETING · CMO | MARKETING (campaigns, accounts, brand, leads, mandate) · GALLERY |
| LAW · CLO | LEGAL (posture, matters, watch, second reader) |
| SECURITY · CSO | SECURITY (watch, findings) |
| TREASURY · CFO | TREASURY · WALLET |
| BOOKS · Logista | THE BOOKS |
| MANAGEMENT · Optio | CHIEF OF STAFF · HOUSE CLOCK |

## Slices

1. **The hub stands (this slice).** The position map, `GET /api/v1/positions`, the POSITIONS
   window with every position, seating in one place, each position's waiting items, switches,
   THEIR EYES, and its functions in place (large windows open through a door until slice 3).
   The being's YOUR POSITION section. Additive: no existing window changes.
2. **Nothing a position owes is missed.** The lead engine's audiences and fact sheets that
   wait for approval join WAITING ON YOU. HOUSE member cards gain an OFFICE door. A title
   change in HOUSE → POSITIONS offers to seat the office of the same name.
3. **The old doors close.** The seat windows leave the dock one by one as their hub tab
   proves whole (COMPANY LINE keeps the company stages only); their ids keep opening the hub
   at the right tab (`retired-windows.js`), so no link breaks.
4. **The guard.** A test fails when a seat-gated act, a seat's connection or a seat's waiting
   kind is not on the position map — new work for a position cannot land anywhere else.

## Defaults taken (say if any is wrong)

- The hub is a window of its own, not a page inside HOUSE: HOUSE is who the members are;
  POSITIONS is the work they hold. HOUSE links to it.
- Positions with no built office yet (Faber, Aedile, Scriba, Curator and the growth seats)
  are not listed until they have a function to show.
- Old windows stay until their hub tab is proven; nothing is removed in slice 1.
