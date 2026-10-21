// CampaignQueueSection — the campaign lane's decision board, inside a
// platform's window (MARKETING layer for open platforms).
//
// Staged posts wait here for the witness: a draft is not egress, and nothing
// publishes without an explicit approval. The scheduler sends approved posts
// at their time, re-checking the channel binding at send — this board is the
// witness's window onto that lane, never a bypass of it. Sent history is
// permanent; decisions are final.

import { useEffect, useRef, useState } from 'react';
import { uiSound } from '../../services/ui-sound.js';
import { useVisibleInterval } from './use-visible-interval.js';
import {
  AWAITING_LABEL, QUEUE_LANES, QUEUE_SECTIONS, filterQueueToDay, isSettled, sectionOf, shiftDayKey,
  splitLaneIntoGroups, splitQueueIntoSections,
  replyNeedsAttention,
  queueById,
} from './campaigns-helpers.js';
import { QueueCalendar } from './QueueCalendar.jsx';
import { QueueEntry } from './QueueEntry.jsx';
import { QueueComposer } from './QueueComposer.jsx';
import { RepliesBoard } from './RepliesBoard.jsx';
import {
  getChannelBoard, getRosterForBinding,
  getPostQueue, getReplyCandidates,
} from '../../services/social-channels-client.js';
import { getCampaigns } from '../../services/campaigns-client.js';

// The decision board, scoped to ONE platform's space when channelId is
// given (its queue, its composer, its campaigns) — or the whole lane bare.
export const CampaignQueueSection = ({ channelId = null, channelName = null }) => {
  const [channels, setChannels] = useState(null);
  const [campaigns, setCampaigns] = useState(null);
  const [queue, setQueue] = useState(null);
  const [replies, setReplies] = useState(null);
  const [roster, setRoster] = useState([]);
  const [loadError, setLoadError] = useState(null);
  // A refused act's honest reason, at the board's head — the card that threw
  // it may leave its lane on the very refresh that follows the refusal.
  const [actNotice, setActNotice] = useState(null);
  const [folded, setFolded] = useState(false);
  // THE SECTION SPLIT (Design note, 2026-08-06: […]). KIND first, STANDING
  // second — the two axes the old five-tab strip confused.
  const [section, setSection] = useState('posts');
  const [lane, setLane] = useState('queued');
  // THE COUNTDOWN (Design note, 2026-07-28: […]). The meta line's `now` was frozen at render;
  // a 30s tick keeps GOES OUT IN counting down to zero. Same calm rhythm as
  // the self-refresh poll — the label's own granularity is the minute.
  const [now, setNow] = useState(() => Date.now());
  const [seed, setSeed] = useState(null);
  // THE MONTH ⇄ DAY VIEW (ruling, 2026-07-28): […] The calendar is the navigator — the month is
  // where you start, a click drills into the SAME board filtered to that day,
  // BACK returns to the month. `dayKey` null is the UNSCHEDULED bucket — a
  // day view like any other, it just has no date. The key is kept when going
  // back, so the month marks the day you came from.
  const [view, setView] = useState('month'); // 'month' | 'day'
  const [dayKey, setDayKey] = useState(null);
  const [monthCursor, setMonthCursor] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  // A successful read always clears a stale error — the board never shows a
  // failure it has already recovered from. The bench read is soft: a queue
  // without campaign names is still a queue. The inbound read is soft the
  // same way: a lane without the replies record is still the lane.
  const refresh = async () => {
    const [board, staged, bench, inbound] = await Promise.all([
      getChannelBoard(), getPostQueue(), getCampaigns().catch(() => ({ campaigns: [] })),
      getReplyCandidates().catch(() => ({ replies: [] })),
    ]);
    setChannels(board.channels);
    setQueue(staged.queue);
    setCampaigns(bench.campaigns);
    setReplies(inbound.replies);
    setLoadError(null);
  };

  useEffect(() => { getRosterForBinding().then(setRoster).catch(() => {}); }, []);

  // The board must SEE the send (Design note, 2026-07-27: a post that had already
  // gone out still read APPROVED — the transition worked, the desk's read
  // was stale). A calm 30s poll, the same rhythm doctrine as the two-lights
  // health probes: a scheduler publish or a being's own staging lands within
  // half a minute, no manual REFRESH. Only the first read may paint an error
  // — a transient blip must not paint one over a board that was true a moment
  // ago; the next success clears whatever stands. The same beat moves the
  // countdowns' clock. Both run only while the queue is seen
  // (use-visible-interval.js) and read at once on return.
  const loaded = useRef(false);
  const watch = useVisibleInterval(() => {
    refresh().then(
      () => { loaded.current = true; },
      (e) => { if (!loaded.current) setLoadError(e.message); },
    );
    setNow(Date.now());
  }, 30000);

  // A platform's space sees exactly its own lane, SPLIT BY STANDING — the
  // sorted single pile was still a single pile (Design note, 2026-07-27: […]). Each tab is one
  // question; the split is total, so no post can fall between two of them.
  // In the day view the SAME lanes run over the day's slice — the calendar is
  // a navigator over the whole board, so every lane sees the same day filter,
  // and the calendar's own counts come from the same channel-scoped queue.
  const scoped = queue
    ? queue.filter((e) => !channelId || e.channelId === channelId)
    : null;
  // The thread's parent join — a self-reply reads beneath its parent, so
  // every card can name the entry it follows.
  const scopedById = scoped ? queueById(scoped) : null;
  // THE DAY FILTER IS A CLOCK, AND ONLY POSTS RIDE ONE (Wave-2 review):
  // filtering replies by a day silently emptied the whole REPLIES section —
  // a reply has no day — so the section always carries its whole pile, and
  // the calendar and the day walk govern POSTS alone.
  const sectionsAll = scoped ? splitQueueIntoSections(scoped) : null;
  const sections = sectionsAll
    ? (view === 'day'
      ? { posts: splitQueueIntoSections(filterQueueToDay(scoped, dayKey)).posts, replies: sectionsAll.replies }
      : sectionsAll)
    : null;
  const lanes = sections?.[section] ?? null;
  const here = lanes?.[lane] ?? [];
  const laneSpec = QUEUE_LANES.find((l) => l.id === lane);
  // THE DECISION COMES FIRST (Design note, 2026-08-06: […]). The
  // awaiting block is the SECTION's — every draft owed a decision in this
  // section stands at the top whichever lane is open, so SENT or WITHDRAWN
  // can never hide what is owed. The record follows. (REPLIES keeps the same
  // promise in its own strip — RepliesBoard.jsx.)
  const awaitingAll = (lanes?.queued ?? []).filter((e) => e.status === 'draft');
  // THE STAGING KIND (the CoS audit's G4): placeholders hold slots — they
  // render AFTER real copy and say so, so signal is never mistaken for
  // staging at a glance.
  const readyEntries = awaitingAll.filter((e) => !e.placeholder);
  const placeholderEntries = awaitingAll.filter((e) => e.placeholder === true);
  const awaitingEntries = [...readyEntries, ...placeholderEntries];
  const record = splitLaneIntoGroups(section, lane, here)
    .filter((g) => !(lane === 'queued' && g.key === 'awaiting'));
  // A pending decision never folds, so it is never counted as foldable.
  const foldable = here.filter((e) => e.status !== 'draft').length;
  // THE INBOUND (ruling, 2026-07-28): the REPLIES section meets WHO KNOCKED,
  // not just what was staged — the replies to the house's own posts. The
  // listener is X's today, so a platform's space meets the knock on its own
  // lane only.
  const inboundAll = (!channelId || channelId === 'x') ? (replies || []) : [];
  const inboundWaiting = inboundAll.filter(replyNeedsAttention).length;
  // The section tabs carry their whole standing pile + the unanswered knock
  // — UNFILTERED by the day, so the badge says where attention is owed even
  // from a quiet day's view.
  const sectionCount = (id) => {
    const pile = sectionsAll ? Object.values(sectionsAll[id]).reduce((n, l) => n + l.length, 0) : 0;
    return pile + (id === 'replies' ? inboundWaiting : 0);
  };

  // The navigator's acts. Picking a day (or walking to one) also moves the
  // month cursor, so BACK TO MONTH always lands on the month you were in.
  const showMonthOf = (key) => {
    if (!key) return;
    const d = new Date(`${key}T00:00:00`);
    setMonthCursor({ year: d.getFullYear(), month: d.getMonth() });
  };
  const pickDay = (key) => {
    uiSound('toggle');
    showMonthOf(key);
    setDayKey(key);
    setView('day');
  };
  const walkDay = (delta) => {
    uiSound('toggle');
    const next = shiftDayKey(dayKey, delta);
    showMonthOf(next);
    setDayKey(next);
  };
  const shiftMonth = (delta) => {
    uiSound('toggle');
    const d = new Date(monthCursor.year, monthCursor.month + delta, 1);
    setMonthCursor({ year: d.getFullYear(), month: d.getMonth() });
  };
  const goToday = () => {
    uiSound('toggle');
    const d = new Date();
    setMonthCursor({ year: d.getFullYear(), month: d.getMonth() });
  };
  const dayLabel = dayKey
    ? new Date(`${dayKey}T00:00:00`)
      .toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
      .toUpperCase()
    : 'UNSCHEDULED';

  // The section strip rides BOTH views — the month is the POSTS section's
  // navigator (a reply has no month), so picking REPLIES from it steps into
  // the section directly, and BACK TO MONTH is a POSTS act.
  const pickSection = (id) => {
    uiSound('toggle');
    setSection(id);
    setLane('queued');
    // From the month, REPLIES steps straight into the section — there is no
    // reply month to stand in. POSTS keeps whichever view it was in.
    if (id === 'replies' && view === 'month') setView('day');
  };
  const sectionStrip = (
    <div className="queue-sections" role="tablist" aria-label="Queue sections">
      {QUEUE_SECTIONS.map((s) => (
        <button
          key={s.id}
          type="button"
          role="tab"
          aria-selected={section === s.id}
          className={`queue-section-tab label-data${section === s.id ? ' is-on' : ''}`}
          onClick={() => pickSection(s.id)}
        >
          {s.label}
          <span className="queue-lane-n">
            {/* The REPLIES badge counts the unanswered knock too — an
                inbound reply awaiting the house IS something in the
                section asking for attention. */}
            {sectionCount(s.id)}
          </span>
        </button>
      ))}
    </div>
  );

  // REVISE carries declined copy back to the composer, which lives in POSTS'
  // QUEUED — so the press also moves you there. Replies never take this path
  // (a fresh answer is the being's to stage, with the exchange in front of
  // it). A fresh object every time, so revising the same post twice re-seeds
  // instead of doing nothing.
  const revise = (entry) => {
    setSeed({ text: entry.text, campaignId: entry.campaignId || '', from: entry.status });
    setSection('posts');
    setLane('queued');
  };

  // EDIT (#208) carries a LIVE entry — draft or approved — into the same
  // composer, but the seed names the entry (editId) so SAVE stages an update
  // against it rather than a new draft. The slot rides along: an edit that
  // silently dropped the schedule would be a change the operator never made.
  // The KIND rides too — a reply's edit keeps the composer's schedule field
  // closed, because a reply cannot be given one.
  const edit = (entry) => {
    setSeed({
      editId: entry.id, from: entry.status, channelId: entry.channelId,
      kind: entry.kind || null,
      text: entry.text, campaignId: entry.campaignId || '',
      // A reply's seed NEVER carries a slot — even a legacy entry's stale
      // one — or SAVE EDIT would re-send the very field the store refuses.
      scheduledFor: entry.kind === 'reply' ? null : (entry.scheduledFor || null),
    });
    setSection(sectionOf(entry));
    setLane('queued');
  };

  // One card, wherever it stands on the board — the decision block above and
  // the record below render the SAME entry, so the two can never drift apart.
  const card = (entry) => (
    <QueueEntry key={entry.id} entry={entry} byId={scopedById} roster={roster} channels={channels}
      campaigns={campaigns} onChanged={refresh} onRevise={revise} onEdit={edit}
      onNotice={setActNotice} folded={folded}
      // Declined copy IS the work when you are looking at it — you are there
      // to read and revise it, so it opens. Other finished copy folds.
      startOpen={(lane === 'withdrawn' && entry.status === 'rejected') || !isSettled(entry.status)}
      now={now} />
  );

  return (
    <section className="settings-sec" ref={watch}>
      <div className="label-data settings-h">
        {channelName ? `QUEUE — ${channelName.toUpperCase()}` : 'CAMPAIGN QUEUE'}
      </div>
      {loadError ? <p className="settings-err">{loadError}</p> : null}
      {actNotice ? <p className="settings-err">{actNotice}</p> : null}
      {!lanes && !loadError ? <p className="settings-note">Reading the queue…</p> : null}

      {lanes ? (
        view === 'month' ? (
          <>
            {/* KIND first, even over the calendar: the month is the POSTS
                navigator — a reply has no month — so REPLIES here steps
                straight into its section. */}
            {sectionStrip}
            <QueueCalendar
              year={monthCursor.year}
              monthIndex={monthCursor.month}
              entries={scoped ? scoped.filter((e) => sectionOf(e) === 'posts') : scoped}
              now={now}
              selectedKey={dayKey}
              onPick={pickDay}
              onPrevMonth={() => shiftMonth(-1)}
              onNextMonth={() => shiftMonth(1)}
              onToday={goToday}
            />
          </>
        ) : section === 'replies' ? (
          <>
            {/* KIND first, then the being's own buckets — one strip, no
                calendar (a reply has no day). RepliesBoard.jsx. */}
            {sectionStrip}
            <RepliesBoard lanes={lanes} inbound={inboundAll} card={card} now={now} onChanged={refresh} />
          </>
        ) : (
        <>
          <div className="queue-daynav">
            <button type="button" className="settings-set"
              onClick={() => { uiSound('toggle'); setSection('posts'); setView('month'); }}>
              ‹ BACK TO MONTH
            </button>
            <span className="label-data queue-daynav-label" aria-live="polite">{dayLabel}</span>
            {/* The bucket has no neighbours — a dateless pile cannot walk to
                a day it never had. */}
            <button type="button" className="settings-set" disabled={!dayKey}
              onClick={() => walkDay(-1)}>
              ‹ PREV DAY
            </button>
            <button type="button" className="settings-set" disabled={!dayKey}
              onClick={() => walkDay(1)}>
              NEXT DAY ›
            </button>
          </div>
          {/* KIND first: POSTS | REPLIES — the two sections that must never
              be confused (ruling, 2026-08-06). Standing second, inside. */}
          {sectionStrip}
          <div className="queue-lanes" role="tablist" aria-label={`${section} lanes`}>
            {QUEUE_LANES.map((l) => (
              <button
                key={l.id}
                type="button"
                role="tab"
                aria-selected={lane === l.id}
                className={`queue-lane label-data${lane === l.id ? ' is-on' : ''}`}
                onClick={() => { uiSound('toggle'); setLane(l.id); }}
              >
                {l.label}
                <span className="queue-lane-n">{lanes[l.id].length}</span>
              </button>
            ))}
          </div>
          <p className="settings-note">{laneSpec.note[section]}</p>
          {here.length === 0
            ? <p className="settings-note">{laneSpec.empty[section]}</p> : null}
          {/* WHAT IS OWED, AT THE TOP — the whole SECTION's open decisions,
              whichever lane is showing, with the count said out loud. */}
          {awaitingEntries.length ? (
            <div className="queue-decisions">
              <div className="label-data queue-decisions-h">
                <span>{AWAITING_LABEL}</span>
                <span className="queue-decisions-n">
                  {readyEntries.length} WAITING ON YOU
                </span>
              </div>
              {placeholderEntries.length ? (
                <p className="settings-note label-data">
                  {placeholderEntries.length} PLACEHOLDER{placeholderEntries.length === 1 ? '' : 'S'} —
                  STAGING BELOW, NOT COPY AWAITING A DECISION
                </p>
              ) : null}
              {awaitingEntries.map(card)}
            </div>
          ) : null}
          {foldable > 0 ? (
            <div className="settings-control queue-fold-bar">
              <button type="button" className="settings-set"
                onClick={() => { uiSound('toggle'); setFolded(!folded); }}>
                {folded ? `EXPAND ALL (${foldable})` : `COLLAPSE ALL (${foldable})`}
              </button>
              <span className="settings-note">
                Anything awaiting your decision stays open.
              </span>
            </div>
          ) : null}
          {record.map((group) => (
            <div key={group.key} className="queue-group">
              {group.label ? (
                <div className="label-data queue-group-h">
                  {group.label}
                  <span className="queue-group-n">{group.entries.length}</span>
                </div>
              ) : null}
              {group.entries.map(card)}
            </div>
          ))}
        </>
        )
      ) : null}

      {/* The composer belongs to POSTS' QUEUED — staging is post work, and a
          bare composer in REPLIES would stage a post from the wrong section.
          It shows in REPLIES only when an EDIT seed carries a reply's copy
          there. In the month view it waits hidden — mounted, so a
          half-written post survives a zoom out to the calendar and back. */}
      <QueueComposer channels={channels} campaigns={campaigns} seed={seed}
        fixedChannelId={channelId}
        hidden={view !== 'day' || lane !== 'queued' || (section === 'replies' && !seed?.editId)}
        onChanged={async () => { setSeed(null); await refresh(); }} />
      <div className="settings-control">
        <button type="button" className="settings-set" onClick={() => refresh().catch((e) => setLoadError(e.message))}>
          REFRESH
        </button>
      </div>
    </section>
  );
};
