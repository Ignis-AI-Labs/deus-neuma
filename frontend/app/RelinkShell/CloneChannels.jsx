// CloneChannels — a shadow clone split's sub-channels, under the chip that split it.
//
// Design note, 2026-11-16: […] One tab per clone — its title and where it stands (waiting its
// place in line, working and on what, done) — and the chosen clone's channel: its task, its acts,
// its words as they come, and its report once done. Drawn live from clone:* frames and again from
// the chat's record (clone-split.js); a reopened chat shows each clone's report and acts.

import { useState } from 'react';
import { uiSound } from '../../services/ui-sound.js';
import { Markdown } from './Markdown.jsx';
import { cloneStateWords, splitHeadline } from './clone-split.js';
import './CloneChannels.css';

// What a clone's report is, by how it ended (a cut clone's is what it had said when the app closed).
const REPORT_LABEL = Object.freeze({ failed: 'WHY IT STOPPED', cut: 'WHAT IT HAD SAID WHEN THE APP CLOSED' });

export const CloneChannels = ({ split }) => {
  const [chosen, setChosen] = useState(null);
  const clones = split?.clones ?? [];
  if (!clones.length) return null;
  // Until one is chosen, the channel on show is the first clone still working (else the first).
  const index = chosen ?? (clones.find((c) => c.state === 'working') ?? clones[0]).index;
  const clone = clones.find((c) => c.index === index) ?? clones[0];
  const done = clone.state === 'done' || clone.state === 'failed' || clone.state === 'cut';
  return (
    <section className="clone-split" aria-label="shadow clones" data-split={split.splitId}>
      <p className="clone-split-head label-data">{splitHeadline(split)}</p>
      <div className="clone-tabs" role="tablist" aria-label="each clone's sub-channel">
        {clones.map((c) => (
          <button key={c.index} type="button" role="tab" aria-selected={c.index === clone.index}
            className={`clone-tab is-${c.state}${c.index === clone.index ? ' is-on' : ''}`}
            onClick={() => { uiSound('toggle'); setChosen(c.index); }}>
            <span className="clone-tab-n label-data">{c.index}</span>
            <span className="clone-tab-title">{c.title}</span>
            <span className="clone-tab-state label-data">{cloneStateWords(c)}</span>
          </button>
        ))}
      </div>
      <div className="clone-channel" role="tabpanel" aria-label={`clone ${clone.index}: ${clone.title}`} data-clone={clone.index}>
        {clone.task ? <p className="clone-task">{clone.task}</p> : null}
        {clone.acts.length ? (
          <ul className="clone-acts" aria-label="what it did">
            {clone.acts.map((a, i) => <li key={`${a.tool}-${i}`} className={`label-data is-${a.status}`}>{a.summary || a.tool}</li>)}
          </ul>
        ) : null}
        {clone.report ? (
          <div className="clone-report">
            <p className="label-data">{REPORT_LABEL[clone.state] ?? 'ITS REPORT'}</p>
            <Markdown text={clone.report} />
          </div>
        ) : null}
        {clone.text && !done ? <div className="clone-words"><Markdown text={clone.text} /></div> : null}
        {clone.text && done && clone.text.trim() !== clone.report?.trim() ? (
          <details className="clone-words-all">
            <summary className="label-data">EVERYTHING IT SAID WHILE IT WORKED</summary>
            <Markdown text={clone.text} />
          </details>
        ) : null}
        {!clone.text && !clone.report && !clone.acts.length ? <p className="clone-quiet label-data">{cloneStateWords(clone)}</p> : null}
      </div>
    </section>
  );
};
