// GatewayHost — mounts the kept vanilla Portal gateway inside React.
//
// The Portal class renders entirely into the container it is given and
// binds its listeners to its own children, so cleanup is just clearing
// the node. Mount-once: the latest onComplete is read through a ref so a
// new callback identity never re-instantiates the portal (which would
// replay its entry animation).

import { useEffect, useRef } from 'react';
import { Portal } from '../../components/Portal/Portal.js';

export const GatewayHost = ({ onComplete }) => {
  const ref = useRef(null);
  const cb = useRef(onComplete);
  cb.current = onComplete;

  useEffect(() => {
    const node = ref.current;
    const portal = new Portal(node, { onComplete: () => cb.current() });
    portal.init();
    return () => node.replaceChildren();
  }, []);

  return <div ref={ref} id="portal-container" />;
};
