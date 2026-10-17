// use-team-runs.js — the desk's team-run store, fed by the portal.
//
// Lives at the desk host beside the council stream (one stream state, many
// windows): the WORKFLOW window reads it, whatever tab or lead filed the run.
// Every run frame reaches every desk of the operator (the server fans them
// out by wallet), so the anchor portal hears them all. On every link up the
// store seeds from the server's live list — a run that began before this
// desk opened, or before a reload, arrives whole; a run the desk still holds
// as working that the server no longer lists is not working (its backend
// restarted, or its end was missed while the link was down) and leaves the
// working list for the runs to pick up.
//
// The store is external (team-runs-context.js): the desk host holds a stable
// handle and never re-renders for a streamed word.
//
// impure — subscribes to the portal, reads the live list, stamps the clock.

import { useEffect, useState } from 'react';
import { TEAM_RUN_FRAMES } from './team-runs-reducer.js';
import { createTeamRunsStore } from './team-runs-context.js';
import { listLiveRuns, listRuns } from './team-client.js';

/**
 * @param {Object} wsService - the desk's anchor portal
 * @returns {{getState: Function, subscribe: Function, dispatch: Function}} the stable store
 */
export const useTeamRuns = (wsService) => {
  const [store] = useState(() => createTeamRunsStore());

  useEffect(() => {
    if (!wsService) return undefined;
    let alive = true;
    // What a crash, a failure or a stop left waiting — read after the live
    // list (so a working run never shows as one to pick up) and again as each
    // run ends.
    const pickUps = async () => {
      const { ok, runs } = await listRuns();
      if (alive && ok) store.dispatch({ type: 'RESUMABLE', runs });
    };
    const seed = async () => {
      // The list answers for the moment it was asked: a run that starts while
      // it is in flight is newer than the answer and is never settled by it.
      const asOf = Date.now();
      const { ok, runs } = await listLiveRuns();
      if (alive && ok) store.dispatch({ type: 'SEED', runs, asOf });
      await pickUps();
    };
    const entries = Object.entries(TEAM_RUN_FRAMES).map(([channel, type]) => [
      channel, (frame) => {
        store.dispatch({ ...frame, type, seenAt: Date.now() });
        if (type === 'DONE') pickUps();
      },
    ]);
    entries.forEach(([channel, on]) => wsService.on(channel, on));
    wsService.on('connection', seed);
    if (wsService.isConnected) seed();
    return () => {
      alive = false;
      entries.forEach(([channel, on]) => wsService.off(channel, on));
      wsService.off('connection', seed);
    };
  }, [wsService, store]);

  return store;
};
