// DoorRecord — talk for about 20 seconds; the forge keeps the best of it.
//
// Natural speech, not reading: a few prompts to talk about, one big record
// button, a live level meter, a timer against the ~20 s aim. When the person
// is done the recording goes to the record door, and the plain verdict (too
// short · noisy · clipped · good) comes back on the take below, with a retake.

import { useTranslation } from 'react-i18next';
import { uiSound } from '../../../services/ui-sound.js';
import { RECORD_TARGET_SECONDS } from './forge-audio.js';
import { foundTakes, pinnedTake } from './forge-model.js';
import { useForgeRecorder } from './use-forge-recorder.js';
import { TakeCard } from './TakeCard.jsx';
import { Stages, readingStagesOf } from './Stages.jsx';

const PROMPTS = Object.freeze(['place', 'morning', 'sound']);

export const DoorRecord = ({ forge, name }) => {
  const { t } = useTranslation('voiceForge');
  const rec = useForgeRecorder({ onRecorded: ({ audioB64 }) => forge.find({ door: 'record', audioB64 }) });
  const recording = rec.phase === 'recording';
  const progress = Math.min(1, rec.seconds / RECORD_TARGET_SECONDS);
  const error = forge.errorAt === 'record' ? forge.error : null;
  const take = foundTakes(forge.forge, forge.foundBy.record)[0] ?? null;
  const label = recording ? t('record.stop')
    : rec.phase === 'opening' ? t('record.opening')
      : forge.busyAt === 'record' ? t('record.working')
        : rec.phase === 'done' || take ? t('record.again') : t('record.start');

  return (
    <div className="vf-door vf-door-record">
      <p className="vf-lead">{t('record.lead')}</p>
      <ul className="vf-prompts">
        {PROMPTS.map((p) => <li key={p} className="vf-prompt">{t(`record.prompts.${p}`)}</li>)}
      </ul>
      <div className="vf-record-row">
        <button
          type="button"
          className="vf-record-btn"
          data-live={recording}
          disabled={!recording && (Boolean(forge.busy) || rec.phase === 'opening')}
          onClick={() => { uiSound('activate'); if (recording) rec.stop(); else rec.start(); }}
        >
          <span className="vf-record-dot" aria-hidden="true" />
          <span className="vf-record-label">{label}</span>
        </button>
        <div className="vf-record-gauges">
          <div className="vf-meter-row">
            <span className="label-data">{t('record.level')}</span>
            <span className="vf-meter" aria-hidden="true">
              <span className="vf-meter-fill" data-live={recording} style={{ width: `${Math.round(rec.level * 100)}%` }} />
            </span>
          </div>
          <div className="vf-meter-row">
            <span className="label-data vf-meter-time">{t('record.seconds', { seconds: Math.floor(rec.seconds) })}</span>
            <span className="vf-progress" aria-hidden="true"><span className="vf-progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} /></span>
          </div>
        </div>
      </div>
      {rec.error ? <p className="vf-note vf-note-alert">{t('record.micError', { error: rec.error })}</p> : null}
      {forge.busyAt === 'record' ? <Stages stages={readingStagesOf(t, name)} label={t('stage.label')} /> : null}
      {error ? <p className="vf-note vf-note-alert vf-door-error">{error}</p> : null}
      {take ? (
        <TakeCard take={take} label={t('chosen.doors.record')} pinned={take.ref === pinnedTake(forge.forge)?.ref}
          sessionId={forge.sessionId} busy={forge.busy} onPick={forge.pick} name={name} previews={forge.previews} onRetry={(ref) => forge.preparePreview(ref, { autoplay: true })} />
      ) : null}
    </div>
  );
};
