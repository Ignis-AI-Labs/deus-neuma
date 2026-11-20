// AtlasReader — one memory opened: its own words in full, when it happened,
// where it came from, how it stands, and the memories nearest to it. Pressing
// a near memory opens that one, so a thread can be followed from memory to
// memory; BACK returns along the way taken.

import { EmptyState } from '../empty-state.jsx';
import { dayWords, kindWords, sourceTurns, stateWords, topicWords } from './atlas-view.js';

const SOURCE_WORDS = Object.freeze({
  live: 'READ FROM THE CONVERSATION IT HAPPENED IN',
  archive: 'READ FROM THE ARCHIVE',
});

// The memory's own words. A conversation reopens with the turns around it; a
// note is whole as written; a record from before the archive has only its line.
const WHO = Object.freeze({ said: 'SAID TO IT', answered: 'IT ANSWERED', other: 'THE PLATFORM' });

const Source = ({ memory, source }) => {
  if (source?.content) {
    const turns = source.kind === 'exchange' ? sourceTurns(source.content) : null;
    return (
      <>
        <p className="atlas-read-h label-data">
          {source.kind === 'exchange' ? (SOURCE_WORDS[source.via] || 'THE CONVERSATION') : 'AS WRITTEN'}
          {source.heldBack ? ' · LONG — THE START IS SHOWN' : ''}
        </p>
        {turns ? (
          <ol className="atlas-turns" aria-label="the conversation, with the remembered part marked">
            {turns.map((t, i) => (
              <li key={i} className={`atlas-turn is-${t.who}${t.focus ? ' is-kept' : ''}`}>
                <span className="atlas-turn-who label-data">{WHO[t.who]}{t.focus ? ' · REMEMBERED' : ''}</span>
                <span className="atlas-turn-words">{t.words}</span>
              </li>
            ))}
          </ol>
        ) : <div className="atlas-read-text">{source.content}</div>}
      </>
    );
  }
  return (
    <>
      <p className="atlas-read-h label-data">WHAT IS KEPT</p>
      <div className="atlas-read-text">{memory.line}</div>
      <p className="atlas-none">
        {source?.error
          ? `The conversation it came from could not be reopened (${source.error}). Its one line is all that shows.`
          : 'Only this line was kept: the memory is from before conversations were archived.'}
      </p>
    </>
  );
};

/**
 * @param {{atlas: Object, opened: (undefined|null|{ok:boolean, status?:number, data?:Object}), canGoBack: boolean,
 *   onBack: () => void, onClose: () => void, onOpen: (id: string) => void, onToggle: (key: string, value: any) => void}} props
 *   opened: null = none chosen · undefined = being read · {ok:false} = the read failed · {ok:true, data} = the record
 */
export const AtlasReader = ({ atlas, opened, canGoBack, onBack, onClose, onOpen, onToggle }) => {
  if (opened === null) {
    return (
      <aside className="atlas-reader is-empty" aria-label="the opened memory">
        <p className="atlas-none">Press a memory to read it in full and see what lies nearest to it.</p>
      </aside>
    );
  }
  const bar = (
    <div className="atlas-read-bar">
      <button type="button" className="atlas-btn label-data" disabled={!canGoBack} onClick={onBack}>← BACK</button>
      <button type="button" className="atlas-btn label-data" onClick={onClose}>CLOSE</button>
    </div>
  );
  if (opened === undefined) {
    return <aside className="atlas-reader" aria-label="the opened memory" aria-busy="true">{bar}<EmptyState title="OPENING…" /></aside>;
  }
  if (!opened.ok) {
    return (
      <aside className="atlas-reader" aria-label="the opened memory">
        {bar}
        <EmptyState title={`THIS MEMORY COULD NOT BE OPENED${Number.isFinite(opened.status) ? ` — HTTP ${opened.status}` : ''}`} tone="error" />
      </aside>
    );
  }
  const { memory, topic, lifecycle, source, near } = opened.data;
  const aside = memory.state !== 'active';
  return (
    <aside className="atlas-reader" aria-label="the opened memory" data-atlas-opened={memory.id}>
      {bar}
      <dl className="atlas-facts">
        <div><dt className="label-data">WHEN</dt><dd>{dayWords(memory.at)}</dd></div>
        <div><dt className="label-data">KIND</dt><dd>{kindWords(memory.kind)}</dd></div>
        <div>
          <dt className="label-data">STANDING</dt>
          <dd className={aside ? 'is-alert' : undefined}>
            {stateWords(lifecycle?.state || memory.state)}
            {aside && lifecycle?.invalidatedAt ? ` ON ${dayWords(lifecycle.invalidatedAt)}` : ''}
            {aside ? ' · KEPT ON THE RECORD, NO LONGER RECALLED' : ''}
          </dd>
        </div>
        <div>
          <dt className="label-data">TOPIC</dt>
          <dd>
            {topic
              ? <button type="button" className="atlas-link" onClick={() => onToggle('topic', topic.id)}>{topic.name}</button>
              : 'None'}
          </dd>
        </div>
        {memory.people?.length ? (
          <div>
            <dt className="label-data">SPEAKS OF</dt>
            <dd>{memory.people.map((p) => <button key={p} type="button" className="atlas-link" onClick={() => onToggle('person', p)}>{p}</button>)}</dd>
          </div>
        ) : null}
        {memory.ref ? (
          <div><dt className="label-data">REFERENCE</dt><dd className="atlas-exact" title="The address the being itself opens this memory by">{memory.ref}</dd></div>
        ) : null}
      </dl>
      <Source memory={memory} source={source} />
      <p className="atlas-read-h label-data">NEAREST MEMORIES{near.length ? ` · ${near.length}` : ''}</p>
      {near.length === 0 ? (
        <p className="atlas-none">{aside ? 'A memory that was set aside is no longer linked to the others.' : 'Nothing else shares enough with this memory to lie near it.'}</p>
      ) : (
        <ol className="atlas-near">
          {near.map((n) => (
            <li key={n.id}>
              <button type="button" className="atlas-near-row" onClick={() => onOpen(n.id)}>
                <span className="atlas-near-when label-data">{dayWords(n.at)}{n.topic !== memory.topic ? ` · ${topicWords(atlas, n.topic).toUpperCase()}` : ''}</span>
                <span className="atlas-near-line">{n.line}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
};
