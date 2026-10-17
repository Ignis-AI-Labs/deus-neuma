// RouteLanding — the switch landing report (model-portability doctrine:
// docs/architecture/identity/model-portability.md). After SET / RETURN TO
// NATAL the operator sees what the being landed on: the resolved window and
// the session-tail budget it implies, and whether the refined voice crossed
// or stayed with the old base. Flavor that stayed behind is SAID, never
// discovered later as a flattened voice.

export const RouteLanding = ({ landing }) => {
  if (!landing) return null;
  const { contextWindow, windowSource, sessionTailChars, adapter } = landing;
  const windowLine = contextWindow
    ? `${Math.round(contextWindow / 1024)}K window · ${windowSource || 'resolved'} · tail ${Math.round((sessionTailChars || 0) / 1000)}K chars`
    : 'window unknown — standing tail budget';
  return (
    <div className="settings-realm">
      <div className="settings-row">
        <span className="settings-k">Landing</span>
        <span className="settings-v"><code>{windowLine}</code></span>
      </div>
      <div className="settings-row">
        <span className="settings-k">Refined voice</span>
        <span className="settings-v">
          {adapter?.state === 'carried' ? (
            <span className="settings-tag-ok">«CARRIED» forged on {adapter.adapterBase}</span>
          ) : adapter?.state === 'stays-behind' ? (
            <span className="settings-tag-warn">«STAYS WITH {adapter.adapterBase}»</span>
          ) : adapter?.state === 'unknown' ? (
            <span className="settings-tag-warn">«UNKNOWN» {adapter.reason}</span>
          ) : (
            <span className="settings-tag-dim">never refined</span>
          )}
        </span>
      </div>
    </div>
  );
};
