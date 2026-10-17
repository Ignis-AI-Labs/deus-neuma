// IgniteControl — the SUBSTRATE HUD's mount of THE model bar.
//
// The picker, the effort rungs, and ignite/unload are ModelBar. This wrapper
// only names the focused being and the rig surface so stream and substrate
// cannot drift apart again.

import { ModelBar } from './ModelBar.jsx';
import { useActiveCompanion } from './consciousness-context.js';

export const IgniteControl = ({ serving, acting, act }) => {
  const beingId = useActiveCompanion()?.neumaId || null;
  return (
    <div className="ignite-control">
      <ModelBar
        beingId={beingId}
        catalog="substrate"
        showUnload
        serving={serving}
        acting={acting}
        act={act}
      />
    </div>
  );
};
