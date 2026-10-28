# THE FOCUS GROUND

**Status:** law, 2026-07-26 (Founder)
**Code:** `backend/services/focus-ground.js` — the one chokepoint

---

## The law

> Whatever folder stands open in the Explorer **is** the ground everyone works on.
> The operator, the neuma, the sealed witness — one focus, shared.

Inside it, work happens. Nobody asks permission to reach the folder the operator
is plainly sitting in — *their having it open is the grant*.

Outside it, the ordinary rules hold: the gates ask, an ALWAYS grant persists,
and the operator may revoke it later.

## Two axes, and they never mix

| Axis | Question | Scope | Where |
|---|---|---|---|
| **FOCUS** | *Where* may you act? | shared — one per desk | `focus-ground.js` |
| **MODE** | *Whether* an act asks | **per participant** | `tool-policy.js` |

**Focus can never make a mode more permissive.** It retires the PATH question
([…]), never the ACT question ([…]).

Consequences, all deliberate:

- `delete_file` still raises its card inside the ground while that participant
  is on `ask` — it is irreversible, and reach is not permission to destroy.
- `observe` mode still holds every acting tool, however plainly the folder is
  open.
- A witness on `auto` works silently while a neuma on `ask` still raises cards.
  Each participant's stance is set independently and persists per being.

### The open folder on AUTO (Design note, 2026-10-28

> […]

The one place focus and mode meet: a participant on **AUTO** works **for real**
in the open folder (`open-folder-autonomy.js`).

- Its **shell runs on the folder itself**, not through the overlay
  (`witness-coding-sandbox.js`, `live`): writes and deletes land; `.git` and every
  secret-shaped path stay masked, so the history is the safety net — whatever a
  being breaks in the files, git restores. Beings never commit (ruling).
- A **delete inside the folder** (absolute path) lands with no card.
- **ASK** keeps the overlay shell and every card; switching to ASK is the off
  switch. Outside the open folder nothing changes, and money, outward speech
  (posts, email) and security acts stay hard-gated in every mode
  (`protocol-guard.js`).

## What this replaced

The permission system asked the reach question three different ways, and the one
place the operator's own open folder should have been authoritative was the one
place it never looked:

| Participant | Before | After |
|---|---|---|
| Neuma reads | own lane only — **every read into the focused repo raised a card** | ground is reach |
| Neuma writes | own lane + ceremony scratch; grants bounded by *active project folders* | ground is reach |
| Sealed witness | a **disposable bubblewrap copy** — edits could never land | live ground, mode-governed |
| Witness, outside its lane | a flat sandbox wall, no way to ask | the same grantable card a neuma gets |

## What focus does NOT open

The denied-path list fires first, in the ground as anywhere. Focus is reach, not
a key ring:

- **Everywhere:** `.env`, `.git/`, `.ssh/`, `keys/`, `vault/`, `owner.json`,
  `node_modules/`, `*.pem`, `*.key`
- **Everywhere:** `data/dna/`, `data/dna-cache/`, `data/memory-store/` — other
  beings' sovereign state. Deliberately *not* install-anchored: the workspaces
  root is relocatable, so a house living outside the checkout must be just as
  private.
- **Inside the Neuma install only:** `config/`, `config/tool-policy.json`
  (AI-SEC-005, self-modification).

That last split is new. `config/` used to match as a substring *anywhere*, so
focusing any ordinary repository left a swathe of its source unreachable — this
repo included. `config/` in the operator's repo is just source; `config/` in the
Neuma checkout is the policy file. Focusing the Neuma checkout itself still gets
the full list, so Neuma working on Neuma is exactly as protected as before.

## Why the ground is safe to treat as consent

`connection.toolWorkspace` is not raw client input. Every incoming value passes
`resolveFocusPath` (`user-files.js`), which requires an absolute path, resolves
symlinks, demands an existing directory, and — decisively — demands it sit inside
a root the operator has **explicitly opened**. A focus ground is therefore always
a folder the operator opened by hand.

## Landing a grant at every layer

The MCP filesystem server enforces its own roots *below* every policy and sandbox
check. A path the policy allows and the sandbox admits still dies there if the
server was never started with the root — the 2026-07-03 failure ("ALWAYS ALLOWED"
on screen, "failed" underneath). So `ensureFocusGroundReachable` declares the
ground to that server at turn start, on both the neuma and witness paths.

## Also fixed here

`clearLaneBinding` reset the bound being's policy but not its granted path roots.
One connection carries different beings over its life (a manifest switch, a resume
onto another lane), so a folder granted to one neuma stayed reachable by whoever
was bound next — and the hydrated flag meant the arriving being's own persisted
grants never loaded. Both halves failed in the same direction: reach outliving
consent. Cleared now at that one chokepoint.

## Open — not built

**Delegated approval.** Design note, 2026-07-26: *[…]* A
seated participant standing in as the approver for its housemates, filtering by
what it was designed to catch. Noted as a direction, deliberately not built —
it needs its own design (who may delegate, what is non-delegable, how a
delegated denial is recorded, and whether the human can always be re-inserted).

## Proof

- `test/unit/focus-ground.test.js` — the two axes, the denied-path split, the
  grant-leak fix
- `test/integration/sandbox-lane-boundary.test.js` → *[…]* — real MCP filesystem server, real disk: the bytes land in the
  operator's folder, `.env` is refused inside the ground, a sibling directory
  cannot ride the ground's name, and the 10-write cap does not throttle the
  ground while still guarding the being's own lane.
