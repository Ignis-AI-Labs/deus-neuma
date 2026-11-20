// CloneChannels — a shadow clone split's sub-channels, under the chip that split it.
//
// Design note, 2026-11-16: […] One tab per clone — its title and where it stands (waiting its
// place in line, working and on what, done) — and the chosen clone's channel: its task, its acts,
// its words as they come, and its report once done. Drawn live from clone:* frames and again from
// the chat's record (clone-split.js); a reopened chat shows each clone's report and acts.
//
// FOLLOWING ONE (Design note, 2026-11-19: […]): a
// clone's channel is its work in the order it happened — what it said, broken by each act where it took it — and it
// follows the newest step as the chat does (StreamFollow: scroll up to read, ▼ LIVE to come back). Each tab says what
// its clone is doing this moment, so all of them are followed at a glance; docked, the tabs stay put while the
// channel scrolls, and EXPAND gives the dock most of the chat's height.

import { useLayoutEffect, useRef, useState } from 'react';
import { uiSound } from '../../services/ui-sound.js';
import { useConsciousnessPick } from './consciousness-context.js';
import { Markdown } from './Markdown.jsx';
import { StreamFollow } from './StreamFollow.jsx';
import { atTail } from './stream-follow.js';
import { cloneStateWords, splitHeadline, isSplitRunning, runningSplits, stoppedClones, feedOf, nowLine } from './clone-split.js';
import './CloneChannels.css';

// How an act's step ended, where that is worth saying (a finished one says nothing more).
const STEP_END = Object.freeze({ executing: ' …', error: ' · FAILED', denied: ' · REFUSED' });

/** A clone's work in order, following its newest step while it works, until the reader scrolls up to read. */
const CloneFeed = ({ clone, live }) => {
  const feed = feedOf(clone);
  const scroller = useRef(null);
  const [following, setFollowing] = useState(true);
  // Every step that lands moves the view while it follows (Design note, 2026-11-20: […]). Following used to key on the feed's length, and a long clone's feed is kept to its last
  // CLONE_FEED_MAX steps: past that its length stood still, a finished act changes none, and the view stopped where it
  // was while the clone kept working — until a tab change drew it again.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && following) el.scrollTop = el.scrollHeight;
  });
  if (!feed.length) return null;
  return (
    <>
      <ol className="clone-feed" ref={scroller} data-clone-feed={clone.index} aria-label={`what clone ${clone.index} said and did, in order`}
        onScroll={(e) => { if (live) setFollowing(atTail(e.currentTarget)); }}>
        {feed.map((step, i) => {
          if (step.k === 'w') return <li key={i} className="clone-step is-words"><Markdown text={step.text} /></li>;
          if (step.k === 'a') return <li key={i} className={`clone-step is-act label-data is-${step.status}`} title={step.tool}>{step.summary || step.tool}{STEP_END[step.status] ?? ''}</li>;
          return <li key={i} className="clone-step is-mark label-data">{step.words}</li>;
        })}
      </ol>
      {live ? <StreamFollow following={following} setFollowing={setFollowing} scroller={scroller} /> : null}
    </>
  );
};

// What a clone's report is, by how it ended (a cut clone's is what it had said when the app closed).
const REPORT_LABEL = Object.freeze({ failed: 'WHY IT STOPPED', cut: 'WHAT IT HAD SAID WHEN THE APP CLOSED' });

/**
 * Where the split was called in the chat: while its clones work it is ONE line there — they are docked at the bottom
 * of the chat (CloneDock) — and once they are done, the whole split stands here again with every report.
 */
export const SplitInChat = ({ split }) => (isSplitRunning(split)
  ? <p className="clone-split-docked label-data" data-split-docked={split.splitId}>{splitHeadline(split)} — DOCKED AT THE BOTTOM OF THE CHAT WHILE THEY WORK</p>
  : <CloneChannels split={split} />);

// THE DOCK'S THREE SIZES (Design note, 2026-11-19: […]): folded to one line, each clone in it
// with what it does now (the default); open, a third of the chat; tall, most of it. The choice is kept for next time.
const DOCK_SIZES = Object.freeze(['line', 'open', 'tall']);
const DOCK_KEY = 'neuma.cloneDockSize';
const readDockSize = () => { try { const v = globalThis.localStorage?.getItem(DOCK_KEY); return DOCK_SIZES.includes(v) ? v : 'line'; } catch { return 'line'; } };
const keepDockSize = (v) => { try { globalThis.localStorage?.setItem(DOCK_KEY, v); } catch { /* private mode: this window only */ } };

/** The splits of this chat still at work, docked above the composer so they follow the chat as it goes. */
export const CloneDock = ({ messages }) => {
  const [size, setSizeNow] = useState(readDockSize);
  const setSize = (next) => { uiSound('toggle'); setSizeNow(next); keepDockSize(next); };
  const splits = runningSplits(messages);
  if (!splits.length) return null;
  return (
    <div className={`clone-dock is-${size}`} aria-label="shadow clones at work" data-clone-dock="" data-dock-size={size}>
      {splits.map((split) => <CloneChannels key={split.splitId} split={split} dock={{ size, setSize }} />)}
    </div>
  );
};

export const CloneChannels = ({ split, dock = null }) => {
  const [chosen, setChosen] = useState(null);
  const { wsService } = useConsciousnessPick('wsService');
  const clones = split?.clones ?? [];
  if (!clones.length) return null;
  // RESUME (Design note, 2026-11-19: a clone that stopped carries on in its own sitting, where it left off.
  const stopped = stoppedClones(split);
  const resume = (indexes) => {
    if (!wsService?.isConnected) return;
    uiSound('activate');
    wsService.send('clone:resume', { splitId: split.splitId, clones: indexes });
  };
  // STOP (Design note, 2026-11-19: […]): one clone, or all of them.
  const running = isSplitRunning(split);
  const atWork = running ? clones.filter((c) => (c.state === 'waiting' || c.state === 'working') && !c.stopping) : [];
  const stop = (indexes) => {
    if (!wsService?.isConnected) return;
    uiSound('deny');
    wsService.send('clone:stop', { splitId: split.splitId, ...(indexes ? { clones: indexes } : {}) });
  };
  // Until one is chosen, the channel on show is the first clone still working (else the first).
  const index = chosen ?? (clones.find((c) => c.state === 'working') ?? clones[0]).index;
  const clone = clones.find((c) => c.index === index) ?? clones[0];
  const done = clone.state === 'done' || clone.state === 'failed' || clone.state === 'cut';
  // One head line: where the split stands, STOP ALL, and the dock's size.
  const head = (
    <div className="clone-split-head label-data">
      <span className="clone-split-title">{splitHeadline(split)}</span>
      <span className="clone-head-acts">
        {atWork.length ? (
          <button type="button" className="sec-scan clone-stop label-data" aria-label={`STOP ALL ${atWork.length} clones still at work — each keeps what it did and can be resumed`} onClick={() => stop(null)}>STOP ALL ({atWork.length})</button>
        ) : null}
        {dock?.size === 'line' ? (
          <button type="button" className="sec-scan label-data" aria-expanded={false} onClick={() => dock.setSize('open')}>OPEN ▴</button>
        ) : null}
        {dock && dock.size !== 'line' ? (
          <>
            <button type="button" className="sec-scan label-data" onClick={() => dock.setSize(dock.size === 'tall' ? 'open' : 'tall')}>{dock.size === 'tall' ? 'SHRINK' : 'EXPAND'}</button>
            <button type="button" className="sec-scan label-data" aria-expanded onClick={() => dock.setSize('line')}>COLLAPSE ▾</button>
          </>
        ) : null}
      </span>
    </div>
  );
  // Folded: each clone one line — what it is, where it stands, what it does now; a press opens it.
  if (dock?.size === 'line') {
    return (
      <section className="clone-split is-line" aria-label="shadow clones" data-split={split.splitId}>
        {head}
        <div className="clone-line">
          {clones.map((c) => {
            const now = nowLine(c);
            return (
              <button key={c.index} type="button" className={`clone-line-one is-${c.state}`} data-clone-line={c.index}
                title={`${c.title} — ${cloneStateWords(c)}${now ? `\n${now}` : ''}`}
                onClick={() => { setChosen(c.index); dock.setSize('open'); }}>
                <span className="clone-tab-n label-data">{c.index}</span>
                <span className="clone-tab-state label-data">{cloneStateWords(c)}</span>
                <span className="clone-line-title">{c.title}</span>
                {now ? <span className="clone-line-now" data-clone-now={c.index}>{now}</span> : null}
              </button>
            );
          })}
        </div>
      </section>
    );
  }
  return (
    <section className="clone-split" aria-label="shadow clones" data-split={split.splitId}>
      {head}
      {stopped.length > 1 ? (
        <div className="clone-resume-all">
          <button type="button" className="sec-scan label-data" aria-label={`RESUME THE ${stopped.length} STOPPED CLONES where they left off`} onClick={() => resume(stopped.map((c) => c.index))}>RESUME ALL STOPPED ({stopped.length})</button>
        </div>
      ) : null}
      {split.resumeRefused ? <p className="clone-quiet label-data" role="status">{split.resumeRefused}</p> : null}
      <div className="clone-tabs" role="tablist" aria-label="each clone's sub-channel">
        {clones.map((c) => {
          const now = nowLine(c);
          return (
            <button key={c.index} type="button" role="tab" aria-selected={c.index === clone.index}
              className={`clone-tab is-${c.state}${c.index === clone.index ? ' is-on' : ''}`}
              onClick={() => { uiSound('toggle'); setChosen(c.index); }}>
              <span className="clone-tab-n label-data">{c.index}</span>
              <span className="clone-tab-title">{c.title}</span>
              <span className="clone-tab-state label-data">{cloneStateWords(c)}</span>
              {now ? <span className="clone-tab-now" data-clone-now={c.index}>{now}</span> : null}
            </button>
          );
        })}
      </div>
      <div className="clone-channel" role="tabpanel" aria-label={`clone ${clone.index}: ${clone.title}`} data-clone={clone.index}>
        {clone.goal ? <p className="clone-goal"><span className="label-data">GOAL</span> {clone.goal}</p> : null}
        {clone.task ? <details className="clone-task"><summary className="label-data">ITS TASK</summary>{clone.task}</details> : null}
        {atWork.some((c) => c.index === clone.index) ? (
          <button type="button" className="sec-scan clone-stop label-data clone-resume" aria-label={`STOP clone ${clone.index}: ${clone.title} — it keeps what it did and can be resumed`} onClick={() => stop([clone.index])}>STOP THIS CLONE</button>
        ) : null}
        {stopped.some((c) => c.index === clone.index) ? (
          <button type="button" className="sec-scan label-data clone-resume" aria-label={`RESUME clone ${clone.index}: ${clone.title}, where it stopped`} onClick={() => resume([clone.index])}>RESUME WHERE IT STOPPED</button>
        ) : null}
        {done ? null : <CloneFeed key={clone.index} clone={clone} live={clone.state === 'working'} />}
        {clone.report ? (
          <div className="clone-report">
            <p className="label-data">{REPORT_LABEL[clone.state] ?? 'ITS REPORT'}</p>
            <Markdown text={clone.report} />
          </div>
        ) : null}
        {done && feedOf(clone).length ? (
          <details className="clone-words-all">
            <summary className="label-data">EVERYTHING IT SAID AND DID WHILE IT WORKED</summary>
            <CloneFeed key={clone.index} clone={clone} live={false} />
          </details>
        ) : null}
        {!feedOf(clone).length && !clone.report ? <p className="clone-quiet label-data">{cloneStateWords(clone)}</p> : null}
      </div>
    </section>
  );
};
