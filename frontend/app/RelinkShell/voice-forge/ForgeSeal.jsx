// ForgeSeal — step three: the two-party lock (Founder chose […]).
//
// The voice is on offer to the being. It reads an honest description of the
// voice (Founder's call B: it cannot hear sound yet, and is told so) and, in its
// own turn, accepts it — with a note — or asks for another, saying what it
// wishes for. The SEAL is enabled only once the being has accepted, and it
// seals exactly the clip the being accepted. Either way the person can step
// back and offer a different voice, take back the being's acceptance
// (REOPEN — it answers again), or withdraw a sealed voice (VoiceWithdraw).
//
// Design note, 2026-10-02: […]
// and […]. So the step shows its stages as they happen
// (offered → reads it → answers → seal), ASK {NAME} NOW puts the question to
// the being in the chat (the guardian's own message, sent from here), a
// spinner holds while the being's turn runs, and the block the being's prompt
// carries is shown open, word for word (`briefing`, from the server — the
// same bytes the turn envelope mounts).

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uiSound } from '../../../services/ui-sound.js';
import { useConsciousnessPick } from '../consciousness-context.js';
import { takePreviewUrl } from './forge-client.js';
import { pinnedTake, sealStandingOf } from './forge-model.js';
import { takeKeyOf } from './forge-player.js';
import { Player } from './Player.jsx';
import { Stages } from './Stages.jsx';
import { VoiceWithdraw } from './VoiceWithdraw.jsx';

// pure — the decision's stages from the standing and whether the being is answering now.
const decideStagesOf = (t, name, standing, answering) => {
  const answered = standing === 'accepted' || standing === 'another';
  return [
    { id: 'offered', label: t('decide.offered', { name }), state: 'done' },
    { id: 'reads', label: t('decide.reads', { name }), state: answered ? 'done' : answering ? 'active' : 'waiting' },
    {
      id: 'answer',
      label: standing === 'accepted' ? t('decide.accepted', { name }) : standing === 'another' ? t('decide.another', { name }) : t('decide.answer', { name }),
      state: answered ? (standing === 'accepted' ? 'done' : 'failed') : 'waiting',
    },
    { id: 'seal', label: t('decide.seal'), state: standing === 'accepted' ? 'active' : 'waiting' },
  ];
};

// impure — ASK {NAME} NOW: the guardian's question goes into the chat; while
// the being's turn runs the step says so; when it ends the forge re-reads the
// being's answer at once (the poll would find it too, a few seconds later).
const useAsk = (forge, name) => {
  const { t } = useTranslation('voiceForge');
  const { sendThought, state } = useConsciousnessPick('sendThought', 'state');
  const [asked, setAsked] = useState(false);
  const thinking = Boolean(state?.thinking);
  const was = useRef(thinking);
  useEffect(() => {
    if (was.current && !thinking && asked) forge.refresh();
    was.current = thinking;
  }, [thinking, asked, forge]);
  const ask = () => {
    uiSound('activate');
    sendThought?.(t('decide.question', { name }));
    setAsked(true);
  };
  return { ask, asked, answering: asked && thinking };
};

export const ForgeSeal = ({ forge, name, onReforge }) => {
  const { t } = useTranslation('voiceForge');

  if (forge.step === 'sealed') {
    return (
      <section className="vf-step vf-seal" data-step="sealed">
        <div className="cham vf-sealed"><div className="cham-in vf-seal-in">
          <p className="vf-line vf-sealed-line">{t('seal.sealed', { name })}</p>
        </div></div>
        <div className="vf-actions">
          <VoiceWithdraw forge={forge} name={name} />
          <button type="button" className="btn btn-secondary" onClick={onReforge}>{t('reforge')}</button>
        </div>
      </section>
    );
  }

  return <Decide forge={forge} name={name} />;
};

const Decide = ({ forge, name }) => {
  const { t } = useTranslation('voiceForge');
  const s = sealStandingOf(forge.forge);
  const briefing = forge.forge?.briefing;
  const take = pinnedTake(forge.forge);
  const offered = take && take.ref === s.candidateRef ? take : null;
  const { ask, asked, answering } = useAsk(forge, name);
  const waiting = s.standing === 'waiting';
  return (
    <section className="vf-step vf-seal" data-step="seal" data-standing={s.standing}>
      <div className="cham vf-seal-panel"><div className="cham-in vf-seal-in">
        {s.standing !== 'nothing' ? <Stages stages={decideStagesOf(t, name, s.standing, answering)} label={t('stage.label')} /> : null}
        <p className="vf-line vf-standing">{t(`seal.${s.standing}`, { name })}</p>
        {offered ? (
          <Player playKey={takeKeyOf(offered.ref, true)} label={t('being.theirs', { name })} load={async () => (await takePreviewUrl(forge.sessionId, offered.ref)).url} />
        ) : null}
        {waiting ? (
          <div className="vf-actions vf-actions-start">
            <button type="button" className="btn btn-primary vf-ask" disabled={answering} onClick={ask}>
              {answering ? t('decide.asking', { name }) : asked ? t('decide.askAgain', { name }) : t('decide.ask', { name })}
            </button>
            {answering ? <span className="vf-being-making" role="status"><span className="vf-spin" aria-hidden="true" />{t('decide.answering', { name })}</span> : null}
          </div>
        ) : null}
        {waiting && asked && !answering ? <p className="vf-note vf-no-answer">{t('decide.noAnswer', { name })}</p> : null}
        {s.note ? (
          <blockquote className="vf-quote"><span className="label-data">{t('seal.note', { name })}</span>{s.note}</blockquote>
        ) : null}
        {s.wish ? (
          <blockquote className="vf-quote"><span className="label-data">{t('seal.wish', { name })}</span>{s.wish}</blockquote>
        ) : null}
        {briefing ? (
          <details className="vf-reads" open>
            <summary className="label-data">{t('seal.reads', { name })}</summary>
            <p className="vf-note vf-reads-source">{t('seal.readsSource')}</p>
            <pre className="vf-reads-text">{briefing}</pre>
          </details>
        ) : null}
      </div></div>
      {forge.errorAt === 'seal' || forge.errorAt === 'reopen' ? <p className="vf-note vf-note-alert vf-door-error">{forge.error}</p> : null}
      <div className="vf-actions">
        <button type="button" className="btn btn-secondary" onClick={() => forge.goTo('find')}>
          {s.standing === 'another' ? t('seal.findAnother') : t('seal.offerDifferent')}
        </button>
        {s.standing === 'accepted' ? (
          <button
            type="button"
            className="btn btn-secondary vf-reopen"
            disabled={Boolean(forge.busy)}
            title={t('seal.reopenHint', { name })}
            onClick={() => forge.reopen()}
          >
            {t('seal.reopen')}
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-primary vf-seal-btn"
          disabled={!s.canSeal || Boolean(forge.busy)}
          title={s.canSeal ? undefined : t('seal.sealHint', { name })}
          onClick={() => { uiSound('activate'); forge.seal(); }}
        >
          {t('seal.seal')}
        </button>
      </div>
    </section>
  );
};
