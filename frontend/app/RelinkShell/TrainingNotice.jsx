// TrainingNotice — every provider outside the operator's custody can train on
// what is sent to it, and some do by default. Users must know, the moment they
// connect one, to turn that off — whichever provider it is. So the gate is
// custody (`sovereign`), not transport: a loopback bridge to a vendor
// subscription carries the same risk as a cloud API. One message for every
// provider; per-vendor settings links would rot.
import { useTranslation } from 'react-i18next';
import './TrainingNotice.css';

/** @param {{provider: {name: string, sovereign?: boolean}|null|undefined}} props */
export const TrainingNotice = ({ provider }) => {
  const { t } = useTranslation('common');
  if (!provider || provider.sovereign) return null;
  return (
    <div className="training-notice" role="note" data-testid="training-notice">
      <span className="label-data">{t('trainingNotice.title')}</span>
      <p>{t('trainingNotice.body', { provider: provider.name })}</p>
    </div>
  );
};
