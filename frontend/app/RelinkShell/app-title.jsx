// app-title — the shared desk-window title: LABEL // BEING.
//
// Identity comes from the reactive context — a house switch must retitle
// every window. The app registry holds each title as a constant element,
// which bails out of plain re-renders, so the being's name must arrive
// through context (never props) for the retitle to propagate.
//
// The label is a catalog KEY (labelKey into the `desk` namespace) with the
// verbatim English `label` as the in-code fallback; the being's name is
// identity data and never translates.

import { useTranslation } from 'react-i18next';
import { useActiveCompanion } from './consciousness-context.js';

export const useCompanionName = () =>
  (useActiveCompanion()?.name || 'NEUMA').toUpperCase();

export const AppTitle = ({ label, labelKey, name }) => {
  const { t } = useTranslation('desk');
  const companionName = useCompanionName();
  const resolved = labelKey ? t(labelKey, { defaultValue: label }) : label;
  return <span className="label-data relink-title-name">{resolved} // {name ?? companionName}</span>;
};
