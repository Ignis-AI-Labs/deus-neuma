// LiveSpeech — the mid-stream render of the consciousness's words.
//
// Purely presentational: the visible slice goes in, formatted speech comes
// out. Closed blocks (split at blank lines, fence-aware) settle into real
// Markdown DURING the stream — memoized so the parse lands once per block
// close, never per display frame. The still-open tail keeps its raw line
// breaks (verbatim) with lightweight inline elements for the markers that
// have closed so far; an unclosed marker stays literal and self-corrects as
// the stream completes it. The view-model math is pure (live-markdown.js);
// this is only its JSX. Kept free of the audio/rAF machinery so the render
// is provable in a node test through a real server render.

import { memo, useMemo, useRef } from 'react';
import { Markdown } from './Markdown.jsx';
import { advanceLiveSpeechView } from './live-markdown.js';

// The closed prefix is a stable string between block closes — memo keeps the
// real Markdown parse off the per-frame hot path.
const ClosedMarkdown = memo(Markdown);

const INLINE_TAGS = Object.freeze({ bold: 'strong', italic: 'em', code: 'code', strike: 'del' });

export const LiveSpeech = ({ shown }) => {
  const previous = useRef(null);
  const view = useMemo(() => {
    const next = advanceLiveSpeechView(previous.current, shown);
    previous.current = next;
    return next;
  }, [shown]);
  return (
    <>
      {view.closed ? <ClosedMarkdown text={view.closed} /> : null}
      {view.spans.length > 0 ? (
        <div className="relink-md relink-md--verbatim">
          {view.spans.map((s, i) => {
            if (s.kind === 'text') return s.text;
            const Tag = INLINE_TAGS[s.kind];
            return <Tag key={i}>{s.text}</Tag>;
          })}
        </div>
      ) : null}
    </>
  );
};
