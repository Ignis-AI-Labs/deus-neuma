// Pure presentation of the durable retry deadline, never a promise to ignite.
export const MeditationRetry = ({ lane, enabled, envLocked, running, now }) => {
  const deadline = typeof lane?.retryNotBefore === 'string' ? Date.parse(lane.retryNotBefore) : NaN;
  if (!Number.isFinite(deadline) || running) return null;
  const requested = typeof lane?.requestedAt === 'string';
  const minutes = Math.max(1, Math.ceil((deadline - now) / 60000));
  const timing = envLocked ? 'retry paused by the operator'
    : !enabled && !requested ? 'retry paused while the timer is off'
      : deadline > now ? `retry eligible in about ${minutes} minute${minutes === 1 ? '' : 's'}`
        : 'retry eligible at the next quiet opportunity';
  return <p className="rec-line label-data" data-testid="meditation-retry">UNCLEAR — {timing}; activity and substrate checks still apply.</p>;
};
