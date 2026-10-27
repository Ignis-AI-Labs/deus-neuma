// use-board — one MARKETING level's saved board (marketing-panel-plan.md §4):
// read on open and whenever another window (or the CMO) changes it
// (board-change.js). A change from elsewhere is background news: it waits on
// the calm gate while the operator is at the window (calm-gate.js), so no
// panel moves under the pointer. The operator's own levers land at once, and
// are announced to every other window. Each level read is kept, so going
// back to a level draws its board at once (and is re-read beneath).
//
// impure — network, window events.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getBoard, saveBoard, resetBoard } from '../../../services/marketing-board-client.js';
import { announceBoardChange, onBoardChange, EVERY_LEVEL } from './board-change.js';

/**
 * impure — {ready, saved, dropped, kinds, spans, error, busy, save(panels), reset()}.
 * `saved` null: the level shows its default board.
 * @param {{level: string, calm: ?{offer: Function, now: Function}}} opts
 */
export const useBoard = ({ level, calm }) => {
  const self = useMemo(() => `board-${Math.random().toString(36).slice(2)}`, []);
  const [reads, setReads] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const land = useCallback((r) => setReads((m) => ({ ...m, [r.level]: { saved: r.board, dropped: r.dropped || [], kinds: r.kinds, spans: r.spans } })), []);

  const read = useCallback(async ({ background = false } = {}) => {
    try {
      const r = await getBoard(level);
      if (background && calm) calm.offer(`board:${level}`, () => land(r));
      else land(r);
      setError(null);
    } catch (err) {
      setError(err.message);
      // A board that cannot be read shows the default, and says why.
      if (!background) setReads((m) => (m[level] ? m : { ...m, [level]: { saved: null, dropped: [], kinds: null, spans: null } }));
    }
  }, [level, calm, land]);

  useEffect(() => { read(); }, [read]);
  useEffect(() => onBoardChange(self, (changed) => { if (changed === level || changed === EVERY_LEVEL) read({ background: true }); }), [self, level, read]);

  // impure — the operator's own change: it lands at once and is told to every other window.
  const commit = useCallback(async (panels) => {
    setBusy(true);
    try {
      const r = panels ? await saveBoard(level, panels) : await resetBoard(level);
      if (calm) calm.now(`board:${level}`, () => land(r));
      else land(r);
      setError(null);
      announceBoardChange(level, self);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [level, calm, land, self]);

  const here = reads[level];
  return {
    ready: Boolean(here), saved: here?.saved ?? null, dropped: here?.dropped ?? [], kinds: here?.kinds ?? null, spans: here?.spans ?? null, error, busy,
    save: commit, reset: () => commit(null),
  };
};
