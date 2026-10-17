// StreamingSpeech — the consciousness's words, revealed as they arrive.
//
// The reducer holds the full streamed text (server truth); this component
// paces its appearance character by character so the witness watches the
// speech being typed instead of lumping in network chunks. While characters
// are appearing it holds a reference on the shared typing bed
// (typing-sound.js), so the sound of typing lasts exactly as long as the
// typing itself. Pacing math is pure (stream-reveal.js); this is the rAF
// + audio IO boundary. Formatting settles DURING the stream, not after it:
// the visible text splits into a closed block prefix (rendered through the
// real <Markdown>, memoized so it reparses once per block close — never per
// frame) and an open tail (verbatim + lightweight inline spans, the pure
// live-markdown.js view-model). Full Markdown still lands at settle.
// Segments that mount already complete (history, resumed sessions) render
// instantly — no reveal, no sound.

import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Markdown } from './Markdown.jsx';
import { createPacer, paceStep, isRevealing } from './stream-reveal.js';
import { LiveSpeech } from './LiveSpeech.jsx';
import { acquireTypingSound, releaseTypingSound } from './typing-sound.js';

const StreamingSpeechView = ({ text, live, onReveal }) => {
  const [visible, setVisible] = useState(() => (live ? 0 : text.length));
  // Refs mirror the changing props so the single rAF loop reads current
  // values without re-arming on every chunk.
  const liveRef = useRef(live);
  liveRef.current = live;
  const textRef = useRef(text);
  textRef.current = text;
  const onRevealRef = useRef(onReveal);
  onRevealRef.current = onReveal;
  // Pacer state (jitter buffer) persists across re-arms of the loop so the
  // cushion keeps its memory of the stream's delivery shape; visible is
  // mirrored so the tick computes outside the setState updater (purity).
  const pacerRef = useRef(null);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  const revealing = isRevealing(visible, text.length);

  // rAF pacing loop — alive only while there is backlog to reveal. New
  // chunks grow the target; the loop persists across renders because the
  // dependency only flips when revealing starts or stops.
  useEffect(() => {
    if (!revealing) return undefined;
    let raf;
    const tick = (now) => {
      if (pacerRef.current === null) pacerRef.current = createPacer(now);
      const { state, next } = paceStep(
        pacerRef.current, visibleRef.current, textRef.current.length, now, liveRef.current
      );
      pacerRef.current = state;
      setVisible(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [revealing]);

  // Follow only after React has committed the newly visible text. Calling the
  // scroll callback from inside rAF used to measure the previous frame's DOM,
  // then force another layout after the text commit.
  useLayoutEffect(() => {
    if (visible > 0 && onRevealRef.current) onRevealRef.current();
  }, [visible]);

  // The typing bed plays exactly while characters are appearing — and no
  // longer (the one-shot it replaces died out mid-response).
  useEffect(() => {
    if (!revealing) return undefined;
    acquireTypingSound();
    return releaseTypingSound;
  }, [revealing]);

  const shown = revealing ? text.slice(0, visible) : text;
  return live || revealing
    ? <LiveSpeech shown={shown} />
    : <Markdown text={text} />;
};

// Settled transcript rows retain the same primitive props across stream
// chunks, so they never re-enter the renderer while the live row grows.
export const StreamingSpeech = memo(StreamingSpeechView);
