// TabStrip — the desk's parallel sittings, side by side.
//
// Session tabs, slice 3. Design note, 2026-07-30: […]
//
// ONE DOOR (ruling, 2026-07-30): […]
//
// So the strip does not ask the operator to pick a KIND. It reads who is in the
// chair and opens another sitting with them. The two budgets are still real and
// still enforced — the tab simply inherits which one it spends instead of making
// that a question. A tab still WEARS its kind, because the operator should be
// able to see which budget each sitting costs: a LOCAL sitting takes a slot on
// this machine's GPU, a WITNESS sitting is a network call.
//
// OPENING IS FREE; RUNNING IS WHAT THE CEILING BOUNDS (Design note, 2026-08-29: […]).
//
// So `+ TAB` never refuses. A tab is a row of state until something connects a
// portal for it, and the server counts sittings by CONNECTION — charging the
// open was charging an act with no cost. The budget is asked where a portal
// would really open: the FIRST FOCUS of a dormant tab, and the TEAR-OUT of one
// that is not already running. A refused tab keeps its place on the strip,
// wears a HELD mark, and starts by itself the moment a sitting closes.
//
// When the budget the act would spend is full, the strip says so with the
// measured number and names the way through — a refusal that teaches beats a
// disabled button.
//
// LINE & CYCLE: hairline rules, monochrome at rest, SIGNAL only where something
// is live, --font-data for labels, var(--token) throughout.

import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './TabStrip.css';
import { useTabDrag } from './use-tab-drag.js';

const CloseGlyph = () => (
  <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
    <path d="M1 1 L7 7 M7 1 L1 7" stroke="currentColor" strokeWidth="1.2" fill="none" />
  </svg>
);

/** The kind mark. A being on this machine reads as a filled node; a witness
 *  reached over the network reads as an open one — the same vocabulary the
 *  desk's two lights already use for local vs remote. */
const KindMark = ({ kind }) => (
  <svg width="6" height="6" viewBox="0 0 6 6" aria-hidden="true" className={`tabstrip-mark is-${kind}`}>
    {kind === 'local'
      ? <circle cx="3" cy="3" r="2.5" fill="currentColor" />
      : <circle cx="3" cy="3" r="2" fill="none" stroke="currentColor" strokeWidth="1" />}
  </svg>
);

/**
 * @param {object} p
 * @param {string} p.nextKind - the kind the door would open: whoever is in the
 *   chair decides it, so the budget shown is the one this press would spend.
 * @param {string} [p.nextName] - who that is, named on the control so the
 *   operator knows who the new tab arrives holding.
 * @param {Object<string, {short: string, full: string}>} [p.grounds] - where a
 *   sitting is working, keyed by tab id, and ONLY for the sittings that chose
 *   a ground of their own. A tab riding the window's lens has no entry and
 *   wears nothing — the strip stays exactly as clean as it was.
 * @param {string} [p.windowId] - WHICH stream window this strip belongs to.
 *   Rides on every drag so a drop can tell a reorder from a transfer between
 *   two streams (Design note, 2026-08-30: […]).
 *   Null on a strip with no window of its own: it can still reorder and tear
 *   out, and simply never sends or receives a transfer.
 */
export const TabStrip = ({
  tabs, focusedId, onFocus, onClose, onOpen, onMove, onTearOut,
  nextKind = 'local', nextName, activity = null,
  grounds = null, windowId = null,
}) => {
  const { t } = useTranslation('desk');
  // A tear-out the host could not give a window of its own, held so it can be
  // READ rather than flashed. No tab is ever refused for the rig (2026-10-15).
  const [refusal, setRefusal] = useState(null);

  /** Pull a sitting out. `onTearOut` answers with a refusal when the host
   *  cannot give it a window of its own; shown, never swallowed. */
  const tryTearOut = (id) => {
    const refused = onTearOut?.(id);
    setRefusal(refused || null);
  };

  // THE GESTURE (use-tab-drag.js): reorder here, transfer to another stream, or
  // tear out into a window of its own — decided entirely by where it is
  // released. Called after tryTearOut so the hook can hand a release off to it;
  // still top-level and unconditional, as a hook must be.
  const drag = useTabDrag({
    tabs, windowId, onMove, onTearOut: tryTearOut, onRefusal: setRefusal,
  });

  /**
   * Focus a sitting. A CLICK ALWAYS SWITCHES (Design note, 2026-10-10: […]), and its portal always connects — no sitting is held
   * or parked for the rig (2026-10-15); its turns wait their place in the house's line.
   */
  const tryFocus = (id) => {
    setRefusal(null);
    onFocus?.(id);
  };

  // THE DOOR IS ALWAYS OPEN — a new tab opens, takes focus and connects.
  const tryOpen = () => {
    setRefusal(null);
    onOpen?.({ focus: true });
  };

  // No tabs, no strip — the desk before anyone has opened a sitting.
  //
  // It DOES render with a single tab, deliberately: the strip is where the
  // door to a second one lives, and hiding it until there are two would mean
  // the operator could never reach the second.
  if (!tabs?.length) return null;

  const who = nextName ? String(nextName).toUpperCase() : null;
  // What the strip says: a tear-out the host refused.
  const notice = refusal;

  return (
    <div
      className="tabstrip"
      role="tablist"
      aria-label={t('stream.tabsAria')}
      // WHICH stream this strip belongs to, in the DOM. Two strips are
      // otherwise indistinguishable to a test — and a transfer is a claim about
      // WHICH ONE received the sitting, so the marker is what makes it provable.
      data-window-id={windowId || undefined}
      // THE WHOLE STRIP IS THE DROP ZONE, and it has to be.
      //
      // These handlers first sat on the rail alone, which is only as wide as
      // the tabs themselves — so the + TAB control, the empty space past it,
      // and the far side of the strip all refused the drop silently. Founder,
      // 2026-08-30: […] A tab bar
      // that accepts a drop on part of itself reads as broken, because the
      // operator cannot see where the live region ends.
      //
      // A drop landing here (rather than on a tab) appends, which is what
      // dropping past the last tab should mean.
      onDragOver={drag.dragOverStrip}
      onDrop={drag.landDrop}
      onDragLeave={drag.dragLeave}
    >
      <div className="tabstrip-rail">
        {tabs.map((t, i) => {
          const ground = grounds?.[t.id] ?? null;
          return (
          <Fragment key={t.id}>
          {drag.dropGap === i ? <span className="tabstrip-caret" aria-hidden="true" /> : null}
          <div
            // The sitting's identity, in the DOM. Two tabs on the same being
            // wear the same NAME, so nothing else in the markup can tell the
            // strip's order apart — not for a test, and not for a screen reader.
            data-tab-id={t.id}
            className={`tabstrip-tab${t.id === focusedId ? ' is-on' : ''}`
              + `${t.id === drag.dragId ? ' is-dragging' : ''}`}
            draggable
            onDragStart={(e) => drag.startDrag(e, t)}
            onDragOver={(e) => drag.dragOverTab(e, i)}
            onDrop={drag.landDrop}
            onDragLeave={drag.dragLeave}
            onDragEnd={drag.endDrag}
          >
            <button
              type="button"
              role="tab"
              aria-selected={t.id === focusedId}
              className="tabstrip-face label-data"
              onClick={() => tryFocus(t.id)}
              title={`${t.name} — ${t.kind === 'local' ? 'on this machine' : 'a sealed witness'}`
                + (ground ? `\nWorking in ${ground.full}` : '')}
            >
              <KindMark kind={t.kind} />
              <span className="tabstrip-name">{t.name}</span>
              {/* WHERE THIS SITTING IS WORKING — one word, and only when the
                  sitting chose a ground of its own. The whole path lives in
                  the hover; a strip of full paths is the noise Founder asked not
                  to have (2026-08-29: […]). */}
              {ground ? (
                <span className="tabstrip-ground" aria-label={`working in ${ground.full}`}>
                  {ground.short}
                </span>
              ) : null}
              {/* The LIVE mark: this sitting is mid-turn — visible above all on
                  a background tab, so parallel work never looks idle. */}
              {activity?.[t.id] ? (
                <span
                  className="tabstrip-live"
                  role="status"
                  aria-label={`${t.name} is answering`}
                  title={`${t.name} is answering in this sitting`}
                />
              ) : null}
            </button>
            {/* NO POP-OUT BUTTON (Design note, 2026-10-05: […]).
                A sitting gets its own window ONLY by being dragged out of this
                one (use-tab-drag.js). */}
            <button
              type="button"
              className="tabstrip-close"
              onClick={() => onClose?.(t.id)}
              aria-label={`Close ${t.name}`}
              title="Close this sitting"
            >
              <CloseGlyph />
            </button>
          </div>
          </Fragment>
          );
        })}
        {/* …and the far side of the last tab. Without this the caret would
            simply vanish when the operator aimed past the end, which is the one
            place a drop is most obviously meant. */}
        {drag.dropGap === tabs.length ? <span className="tabstrip-caret" aria-hidden="true" /> : null}
      </div>

      <div className="tabstrip-open">
        <button
          type="button"
          className="tabstrip-new label-data"
          onClick={tryOpen}
          data-kind={nextKind}
          title={who
            ? t('stream.newTabTitle', {
              who,
              kind: t(nextKind === 'witness' ? 'stream.tabKindWitness' : 'stream.tabKindLocal'),
            })
            : t('stream.newTabTitleAny')}
        >
          {t('stream.newTab')}
        </button>
      </div>

      {notice ? (
        <div className="tabstrip-refusal" role="status">
          <span className="tabstrip-refusal-word label-data">« NOTICE »</span>
          <span className="tabstrip-refusal-text">{notice.reason}</span>
          {/* The door that is still open. A full GPU does not mean a full desk. */}
          {notice.alternative ? (
            <span className="tabstrip-refusal-alt">{notice.alternative}</span>
          ) : null}
          <button
            type="button"
            className="tabstrip-refusal-dismiss label-data"
            onClick={() => setRefusal(null)}
          >
            DISMISS
          </button>
        </div>
      ) : null}
    </div>
  );
};
