// DoorUpload — any audio file. The backend reads whatever ffmpeg can, keeps
// the best 10–30 s of speech, and writes its words down; the browser sends
// the file as picked (nothing is decoded or held here). The verdict comes
// back on the take below; a refusal is shown here.

import { useTranslation } from 'react-i18next';
import { foundTakes, pinnedTake } from './forge-model.js';
import { TakeCard } from './TakeCard.jsx';
import { Stages, readingStagesOf } from './Stages.jsx';

export const DoorUpload = ({ forge, name }) => {
  const { t } = useTranslation('voiceForge');
  const busy = Boolean(forge.busy);
  const error = forge.errorAt === 'upload' ? forge.error : null;
  const take = foundTakes(forge.forge, forge.foundBy.upload)[0] ?? null;
  const picked = (e) => {
    const file = e.target.files?.[0];
    // Clear the input so the same file can be picked again after a refusal.
    e.target.value = '';
    if (file) forge.upload(file);
  };
  return (
    <div className="vf-door vf-door-upload">
      <p className="vf-lead">{t('upload.lead')}</p>
      <div className="vf-actions vf-actions-start">
        <label className="btn btn-primary vf-file" data-disabled={busy}>
          {forge.busyAt === 'upload' ? t('upload.working') : t('upload.pick')}
          <input type="file" accept="audio/*" disabled={busy} onChange={picked} />
        </label>
      </div>
      {forge.busyAt === 'upload' ? <Stages stages={readingStagesOf(t, name)} label={t('stage.label')} /> : null}
      {error ? <p className="vf-note vf-note-alert vf-door-error">{error}</p> : null}
      {take ? (
        <TakeCard take={take} label={t('chosen.doors.upload')} pinned={take.ref === pinnedTake(forge.forge)?.ref}
          sessionId={forge.sessionId} busy={forge.busy} onPick={forge.pick} name={name} previews={forge.previews} onRetry={(ref) => forge.preparePreview(ref, { autoplay: true })} />
      ) : null}
    </div>
  );
};
