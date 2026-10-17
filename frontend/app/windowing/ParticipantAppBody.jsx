import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useActiveCompanion } from '../RelinkShell/consciousness-context.js';
import { isWitness } from '../RelinkShell/house-members.js';
import { EmptyState } from '../RelinkShell/empty-state.jsx';

/** Enforce declared applicability before an app mounts its data-fetching body.
 *  Memoized: its props are the window's own, so it re-renders only when the
 *  window or the bound being does (2026-09-28 smoothness pass). */
export const ParticipantAppBody = memo(({ app, ...props }) => {
  const { t } = useTranslation('desk');
  const companion = useActiveCompanion();
  if (app.appliesTo === 'neuma' && isWitness(companion)) {
    return <EmptyState title={t('participant.neumaOnlyTitle')}>
      <small>{t('participant.neumaOnlyBody', {
        name: companion?.name || t('participant.thisParticipant'),
        app: app.labelKey ? t(app.labelKey) : app.label,
      })}</small>
    </EmptyState>;
  }
  const Body = app.Body;
  return <Body {...props} />;
});
