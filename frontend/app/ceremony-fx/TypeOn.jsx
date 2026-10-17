// impure — TypeOn: the Raphael register. The ceremony's own voice types on
// with a caret; a being's or a witness's words never do (chat does not
// type-on — doctrine). Keyed by text: fresh words re-arrive, re-renders of
// the same words hold still. Reduced motion shows the full text at once.

import { useEffect, useState } from 'react';

const CHARS_PER_TICK = 3;
const TICK_MS = 16;

export const TypeOn = ({ text, className = '', testid }) => {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(text.length);
      return undefined;
    }
    setShown(0);
    const timer = setInterval(() => {
      setShown((n) => {
        if (n + CHARS_PER_TICK >= text.length) {
          clearInterval(timer);
          return text.length;
        }
        return n + CHARS_PER_TICK;
      });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [text]);

  const done = shown >= text.length;
  return (
    <p className={className} data-testid={testid}>
      {text.slice(0, shown)}
      {!done && <span className="fx-caret" aria-hidden="true" />}
    </p>
  );
};
