// meditation-house-view.js — the meditation picture as ONE house may see it.
// Settings and run state are one file each on this machine; houses are never
// confused, so a house sees only its own lanes' settings, runs and deferrals.
// That the machine is meditating at all stays visible (it decides whether the
// model line is free); WHO is, only when it is one of ours.

/**
 * @param {Set<string>} owned - the asking wallet's lane ids
 * @param {{settings: object, state: object, scheduler: object}} picture
 */
export const meditationViewFor = (owned, { settings, state, scheduler }) => {
  const mine = (laneId) => owned.has(laneId);
  const only = (map) => Object.fromEntries(Object.entries(map || {}).filter(([laneId]) => mine(laneId)));
  const runnable = scheduler.lastTick?.runnable ?? null;
  return {
    settings: { ...settings, beings: only(settings.beings) },
    state: { ...state, lanes: only(state.lanes) },
    scheduler: {
      ...scheduler,
      currentLane: mine(scheduler.currentLane) ? scheduler.currentLane : null,
      startedAt: mine(scheduler.currentLane) ? scheduler.startedAt : null,
      lastTick: scheduler.lastTick && {
        ...scheduler.lastTick,
        runnable: mine(runnable) ? runnable : null,
        blocked: (scheduler.lastTick.blocked || []).filter((b) => mine(b.laneId)),
      },
    },
  };
};
