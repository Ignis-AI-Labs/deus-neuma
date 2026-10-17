# Coding Shell Recovery

If the shell reports an overlay freshness conflict, the participant can call:

```text
coding/sandbox_recover {}
```

It remains discoverable when shell preparation fails. You can also ask in plain
language: "Recover your coding shell, preserve the old work, then run the build."

## One Existing Approval

Recovery uses the existing Allow / Always / Revoke interface. Its card names
the project and the location where prior shell work will remain.

- **Allow:** perform this recovery.
- **Always:** grant this capability until you revoke it; AUTO does not demand
  another approval for an explicitly granted capability.
- **Revoke:** withdraw the grant and interrupt current work that might still
  carry old authority. A later use must obtain permission again.

No extra confirmation layer is introduced. Execution and network permissions
remain their existing separately named capabilities; recovery does not broaden
either one, change secret masks, or grant Git permissions.

## What Recovery Does

1. Prepares a fresh shell generation from the live project and current masks.
2. Keeps the prior upper layer and work directory at their original paths.
3. Activates the prepared generation with an atomic pointer update.
4. Refreshes tool availability so the same turn can inspect, build or test again.

The result reports `preservedUpper` and `activeUpper`. Prior files remain
readable through the normal filesystem tools for inspection and selective
harvest. Recovery does **not** delete them, copy them into the project, or merge
old shell edits into live source automatically. Changes authored only in the old
upper therefore do not silently become part of the new build.

Git status/history/sync use their own governed backend path and remain
available during an overlay conflict; they do not require an executable shell.

## Boundaries

An active or unidentifiable stale command lock is not forcibly stolen. Let the
running command end or have the operator inspect the stale process/lock.
An interrupted recovery before publication leaves the old generation selected.
The final rename is the commit boundary; already-committed effects are not
rolled back by a later interrupt or revocation.

Control files and generation selection are platform-managed. Ordinary file
tools cannot forge the pointer or move its control ancestors. Preserved upper
artifacts remain accessible; management state changes go through recovery.

These capabilities are backend code. After installing a code update, fully
restart Neuma's backend once; a renderer refresh alone cannot load new modules.
Subsequent shell recovery does not require another backend restart.
