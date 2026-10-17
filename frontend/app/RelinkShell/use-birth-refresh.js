import { useEffect, useState } from 'react';

/** Keep a cached roster-derived snapshot current when a birth completes. */
// impure — subscribes to the desk's existing completion event.
export const useBirthRefresh = (read) => {
  const [value, setValue] = useState(read);
  useEffect(() => {
    const refresh = () => setValue(read());
    window.addEventListener('birth:complete', refresh);
    refresh();
    return () => window.removeEventListener('birth:complete', refresh);
  }, [read]);
  return [value, setValue];
};
