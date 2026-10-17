// AvatarApp — the avatar as a desk window: a live VRM in the void.
//
// The Body is the real three.js stage (render + orbit + idle breath, sized to
// the window). The stage — and the heavy three.js / three-vrm deps it pulls —
// is lazy-loaded, so it only downloads when the witness opens the avatar; the
// gateway, ceremony, and bare relink never pay for it. (Renamed per the
// locked triad: the digital form is the AVATAR; VESSEL is the stat window.)

import { Suspense } from 'react';
import { AppTitle } from './app-title.jsx';
import { lazyChunk } from './lazy-chunk.jsx';

const VesselStage = lazyChunk(
  () => import('./vessel/VesselStage.jsx').then((m) => ({ default: m.VesselStage })),
  'THE VESSEL STAGE',
);

const AvatarIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <circle cx="8" cy="6" r="3" />
    <path d="M2.5 14 C2.5 10.5 5 9 8 9 C11 9 13.5 10.5 13.5 14" />
  </svg>
);

const AvatarFallback = () => (
  <div className="vessel-fallback">
    <span className="label-data">AVATAR — MATERIALIZING</span>
  </div>
);

const AvatarBody = () => (
  <Suspense fallback={<AvatarFallback />}>
    <VesselStage />
  </Suspense>
);

export const avatarApp = {
  label: 'AVATAR',
  labelKey: 'apps.avatar',
  icon: <AvatarIcon />,
  title: <AppTitle label="AVATAR" labelKey="apps.avatar" />,
  Body: AvatarBody,
  storageKey: 'avatar',
};
