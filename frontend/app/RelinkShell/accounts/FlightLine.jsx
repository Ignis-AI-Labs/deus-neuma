// FlightLine — one connection's live proof (ruling, 2026-07-28): a key being
// SET is a claim; the flight test is the proof — the platform accepted it,
// answered, named the account. PROVEN with the account, FAILING with the
// honest reason, unconfigured said as nothing-to-prove (never an error).

import { useTranslation } from 'react-i18next';

/** @param {{test: ?object}} props */
export const FlightLine = ({ test }) => {
  const { t } = useTranslation('settingsApi');
  if (!test) return <span className="settings-v flight-line is-idle">{t('channelKeys.flight.untested')}</span>;
  if (test.ok === true) {
    // A passing flight may still carry a warning — LinkedIn's mortal token
    // rides its expiry note here.
    const account = test.account?.name ? `@${test.account.name}` : t('channelKeys.flight.proven');
    return (
      <span className="settings-v flight-line is-live" title={test.detail}>
        {test.detail
          ? t('channelKeys.flight.liveDetail', { account, detail: test.detail })
          : t('channelKeys.flight.live', { account })}
      </span>
    );
  }
  if (test.ok === false) {
    return (
      <span className="settings-v flight-line is-down" title={test.detail}>
        {t('channelKeys.flight.down', { detail: test.detail })}
      </span>
    );
  }
  return <span className="settings-v flight-line is-idle">{t('channelKeys.flight.unconfigured')}</span>;
};
