// use-kit-marks — the artwork on disk, and where to put more of it.
//
// Separate from the draft because marks are FILES, not fields. The kit names
// them; the bytes live beside it. Editing `marks.wordmark.file` in the draft
// does not make a file appear, and uploading a file does not make the kit name
// it — those are two acts, and MarksSection does both deliberately.
//
// Reloaded when the open brand changes, and after an upload.
//
// impure — network.

import { useCallback, useState } from 'react';
import { getBrandMarks } from '../../../services/brands.js';
import { useSettled } from '../use-settled.js';

export const useKitMarks = (brand, detail) => {
  const [marks, setMarks] = useState(null);
  const [tick, setTick] = useState(0);

  // A kit that is not on disk yet has no folder to read — asking would 404 and
  // paint an error for the ordinary case of having just pressed NEW.
  const onDisk = Boolean(brand) && !detail?.unsaved && !detail?.error;

  useSettled((settled) => {
    if (!onDisk) { setMarks(null); return; }
    getBrandMarks(brand)
      .then((answer) => { if (!settled()) setMarks(answer); })
      .catch(() => { if (!settled()) setMarks(null); });
  }, [brand, onDisk, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { marks, reload };
};
