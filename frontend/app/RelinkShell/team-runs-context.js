// team-runs-context.js — share the desk's team-run store (use-team-runs.js)
// with every window: the same law as the council and consciousness streams.
//
// The store lives OUTSIDE React's state: members stream several frames a
// second, and a store held in the desk host's state re-rendered the whole
// desk on every one of them. Here the context carries a stable store; only
// the components that read it (useTeamRunsStore, useTeamRunPhase) re-render,
// and only when what they read changed.

import { createContext, useContext, useSyncExternalStore } from 'react';
import { teamRunsReducer, initialTeamRuns } from './team-runs-reducer.js';

export const TeamRunsContext = createContext(null);

/**
 * The desk's run store: the pure reducer behind a subscribe/getState pair.
 *
 * @param {Object} [initial] - a starting state (a test renders from one)
 * @returns {{getState: Function, subscribe: Function, dispatch: Function}}
 */
export const createTeamRunsStore = (initial = initialTeamRuns) => {
  let state = initial;
  const listeners = new Set();
  return Object.freeze({
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch: (action) => {
      const next = teamRunsReducer(state, action);
      if (next === state) return;
      state = next;
      listeners.forEach((listener) => listener());
    },
  });
};

const unsubscribed = () => () => {};
const nothing = () => null;

/** The whole store state, or null outside a desk. Re-renders on every change. */
export const useTeamRunsStore = () => {
  const store = useContext(TeamRunsContext);
  return useSyncExternalStore(
    store ? store.subscribe : unsubscribed,
    store ? store.getState : nothing,
    store ? store.getState : nothing,
  );
};

/**
 * One run's standing as the desk knows it — `phase|status`, or null when the
 * desk has not seen the run. A string, so a reader re-renders only when the
 * run actually moves between phases, never per streamed word.
 *
 * @param {string} id - the run id
 * @returns {?string}
 */
export const useTeamRunPhase = (id) => {
  const store = useContext(TeamRunsContext);
  const read = () => {
    const run = store?.getState().runs[id];
    return run ? `${run.phase}|${run.status ?? ''}` : null;
  };
  return useSyncExternalStore(store ? store.subscribe : unsubscribed, read, read);
};
