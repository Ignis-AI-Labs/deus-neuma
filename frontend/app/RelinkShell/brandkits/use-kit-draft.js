// use-kit-draft — the kit being edited, and every way to change it.
//
// Lifted almost verbatim out of BrandKitsSection.jsx on 2026-08-31. The state
// logic there was already right and is kept rather than rewritten: the
// adopt-from-the-server's-re-read rule, the two-way mirror between the
// structured fields and the raw JSON, and the roster recovery that keeps its
// cache on failure are all decisions with reasons, carried below.
//
// WHAT IS NEW HERE, and why:
//
//   dirty — the old panel had no unsaved indicator and put SAVE at the bottom
//     of a long scroll. Selecting an owner and walking away lost it silently.
//     Compared by canonical string rather than counted, so typing a character
//     and deleting it puts the pip back out.
//
//   ground — `writeKit` refuses with […] and the panel was
//     a dead end: no way to fix it from the surface that raised it. Checked on
//     mount so it can be said BEFORE nine sections are filled in, never after.
//
// impure — network, and the roster's localStorage mirror.

import { useCallback, useState } from 'react';
import {
  getBrandKit, listBrandKits, newBrandKit, saveBrandKit,
} from '../../../services/brands.js';
import { getHouseWorkspace } from '../../../services/house-workspace.js';
import { getRoster } from '../../../utils/companion-data.js';
import { recoverRoster } from '../../roster-recovery.js';
import { useSettled } from '../use-settled.js';
import { uiSound } from '../../../services/ui-sound.js';
import { groundFromRead, setPath, unsetPath } from './brand-kits-view.js';
import { isDirty } from './kit-progress.js';

export const useKitDraft = () => {
  const [kits, setKits] = useState(null);
  const [totals, setTotals] = useState({ total: 0, ready: 0 });
  const [open, setOpen] = useState(null);
  const [detail, setDetail] = useState(null);
  const [draft, setDraft] = useState(null);
  const [raw, setRaw] = useState('');
  const [rawError, setRawError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [roster, setRoster] = useState(getRoster);
  const [ground, setGround] = useState({ known: false, root: null, unread: null });

  // The house roster, for the OWNER picker. Same recovery pass the HOUSE window
  // and the BeingSwitcher run — the backend owns the roster and localStorage is
  // its mirror, so the cache paints immediately and the recovery corrects it. A
  // failed recovery warns and keeps the cache rather than emptying the picker:
  // an owner you cannot re-select is worse than a stale name in the list.
  useSettled((settled) => {
    recoverRoster()
      .catch((err) => console.warn('[BrandKits] roster recovery failed — showing the cached roster', err))
      .finally(() => { if (!settled()) setRoster(getRoster()); });
  }, []);

  // Where a kit can be SAVED. Asked up front, because the refusal it prevents
  // arrives at the end of the work otherwise; asked again on RETRY after a
  // read that failed. getHouseWorkspace never throws: a failure is `unread`.
  const readGround = useCallback((settled = () => false) => getHouseWorkspace()
    .then((answer) => { if (!settled()) setGround(groundFromRead(answer)); }), []);
  useSettled((settled) => { readGround(settled); }, [readGround]);

  const reload = useCallback(async () => {
    const answer = await listBrandKits();
    setKits(answer.kits || []);
    setTotals({ total: answer.total || 0, ready: answer.ready || 0 });
    return answer;
  }, []);

  useSettled((settled) => {
    reload().catch(() => { if (!settled()) setKits([]); });
  }, [reload]);

  // The draft is seeded from the server's re-read, never from what we believed
  // we sent — a save that was normalised on the way in must show as normalised.
  const adopt = useCallback((answer) => {
    setDetail(answer);
    setDraft(answer.kit);
    setRaw(JSON.stringify(answer.kit, null, 2));
    setRawError(null);
  }, []);

  const openKit = useCallback(async (brand) => {
    if (!brand) return;
    setOpen(brand);
    setNotice(null);
    setDetail(null);
    try {
      adopt(await getBrandKit(brand));
    } catch {
      setDetail({ error: `the "${brand}" kit could not be read` });
    }
  }, [adopt]);

  const startNew = useCallback(async (rawName) => {
    const brand = String(rawName || '').trim().toLowerCase();
    if (!brand) return;
    try {
      const seed = await newBrandKit(brand);
      setOpen(seed.brand);
      // Not yet on disk: it becomes real on the first save, so the operator can
      // walk away from a name they mistyped without leaving a folder behind.
      setDetail({ brand: seed.brand, kit: seed.kit, where: 'workspace', unsaved: true, readiness: null });
      setDraft(seed.kit);
      setRaw(JSON.stringify(seed.kit, null, 2));
      setRawError(null);
      setNotice('Not saved yet — fill in what you can and save.');
    } catch (err) {
      setNotice(err?.message || 'that name could not be used');
    }
  }, []);

  /** A structured edit rewrites the raw text too, so the two never diverge. */
  const editField = useCallback((dotted, value) => {
    setDraft((current) => {
      const next = setPath(current, dotted, value);
      setRaw(JSON.stringify(next, null, 2));
      setRawError(null);
      return next;
    });
  }, []);

  /** Un-decide a field: back to absent, which is not the same as empty.
   *  `disclosures: []` says somebody decided there are none; no `disclosures`
   *  key at all says nobody has looked yet. The gate reads those differently
   *  and so must the operator be able to say them differently. */
  const unsetField = useCallback((dotted) => {
    setDraft((current) => {
      const next = unsetPath(current, dotted);
      setRaw(JSON.stringify(next, null, 2));
      setRawError(null);
      return next;
    });
  }, []);

  /** A raw edit only reaches the draft once it parses. */
  const editRaw = useCallback((text) => {
    setRaw(text);
    try {
      const parsed = JSON.parse(text);
      setDraft(parsed);
      setRawError(null);
    } catch (err) {
      setRawError(`not valid JSON yet — ${err.message}`);
    }
  }, []);

  const save = useCallback(async () => {
    if (rawError || !draft || !open) return;
    setSaving(true);
    setNotice(null);
    try {
      const answer = await saveBrandKit(open, draft);
      adopt(answer);
      await reload();
      uiSound('activate');
      setNotice('Saved.');
    } catch (err) {
      // The refusals are the named fields the renderer could not open — far
      // more use than "invalid", which sends the operator back to guess. The
      // route puts the named fields INTO the message, so there is nothing to
      // unpack here — and no second wording to keep in step with the server.
      setNotice(err?.message || 'the brand kit could not be saved');
    } finally {
      setSaving(false);
    }
  }, [adopt, draft, open, rawError, reload]);

  // A kit that is not on disk yet is dirty from birth — there is nothing saved
  // to be identical to, and its SAVE must not read as "nothing to do".
  const dirty = Boolean(draft) && (detail?.unsaved || isDirty(draft, detail?.kit));

  return {
    kits, totals, open, detail, draft, raw, rawError, saving, notice, roster,
    ground, dirty,
    readGround, openKit, startNew, editField, unsetField, editRaw, save, reload, setNotice,
  };
};
