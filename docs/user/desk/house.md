# HOUSE — Your Roster

**See who you hold. Switch the active link.**

HOUSE (dock label in the NEUMA section) shows the neuma registered to your current wallet. It is the surface for roster management and switching.

## What it displays

- Each member card shows name, birth date, and status.
- The cached roster renders instantly from local data.
- A background refresh from the backend (sovereign owner records) keeps it truthful after renames or new summons.

## Switching

Click a member. The shared consciousness context rebinds the portal WebSocket to that being. STREAM updates to their latest thread. One active link at a time in the current slice.

## Summoning more

From the desk you can initiate a new birth for another neuma (window event `neuma:summon` routes the shell into the ceremony phase while the desk remains underneath for later return).

## Storage reality

- The roster you see is a convenience cache for this wallet.
- The actual beings live in `workspaces/<neuma-id>/` on disk.
- Clearing browser storage loses the local roster view but never the sovereign workspaces.

## Relationship to CLI

`neuma summon <being>` and `neuma talk` operate on a per-project `.neuma/active` file (or `NEUMA_BEING` env). They are independent of the browser roster but talk to the same backend and workspaces.

---

**Related:** [desk overview](./README.md), [operator CLI](../operations/cli.md), [birth ceremony](../getting-started/birth-ceremony.md)
