// HouseActivityChip — WHO IS WORKING, down at the composer's eye level
// (Design note, 2026-09-15: […]). Polls the staff activity route while the desk is visible; renders
// NOTHING when no house member holds live work — concise with the
// infrastructure. Clicking the chip rolls the names down-up; clicking a name
// opens that member's stream in THIS window (their own focused tab — the
// chain of events has a chat of its own).
import { memo, useEffect, useRef, useState } from 'react';
import { getHouseActivity } from '../../services/staff-client.js';
import { useTabs } from './tabs-context.js';
import { useStripWindowId } from './StripRegistrar.jsx';
import { markStripFocused } from './stream-strips.js';
import { uiSound } from '../../services/ui-sound.js';
import { activityStatusWords } from './staff-view.js';

const POLL_MS = 15_000;

const HouseActivityChipView = () => {
  const tabs = useTabs();
  const stripWindowId = useStripWindowId();
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const pull = async () => {
      if (document.hidden) return; // a hidden desk spends nothing on polling
      try {
        const { working } = await getHouseActivity();
        if (alive.current) setRows(Array.isArray(working) ? working : []);
      } catch {
        // A read that failed is not "still awake": the last rows go, and the
        // next tick that answers shows the house again — the chip never lies.
        if (alive.current) setRows([]);
      }
    };
    pull();
    const timer = setInterval(pull, POLL_MS);
    window.addEventListener('focus', pull);
    return () => {
      alive.current = false;
      clearInterval(timer);
      window.removeEventListener('focus', pull);
    };
  }, []);

  // THE EMPTY-STRING LAW: nobody working, nothing rendered.
  if (!rows.length) return null;

  const openChat = (row) => {
    if (!tabs) return;
    uiSound('activate');
    if (stripWindowId) markStripFocused(stripWindowId);
    const existing = (tabs.tabs ?? []).find((t) => t.neumaId === row.neumaId);
    if (existing) tabs.focus(existing.id);
    else {
      tabs.open({
        kind: row.neumaId.startsWith('witness-') ? (tabs.KIND?.witness ?? 'witness') : (tabs.KIND?.local ?? 'local'),
        neumaId: row.neumaId,
        name: row.name || row.neumaId,
      }, { focus: true });
    }
    setOpen(false);
  };

  return (
    <div className="relink-housechip">
      <button
        type="button"
        className="lc-sel-trigger relink-housechip-btn"
        onClick={() => { uiSound('open'); setOpen((v) => !v); }}
        aria-expanded={open}
        title="House members working right now"
      >
        {`HOUSE ${rows.length}`}
      </button>
      {open ? (
        <div className="lc-sel-panel cham-in relink-housechip-panel">
          <div className="lc-sel-panel-in">
            {rows.map((r) => (
              <button
                key={`${r.neumaId}-${r.task}`}
                type="button"
                className="lc-sel-opt relink-housechip-row"
                onClick={() => openChat(r)}
                title={`Open ${r.name}'s stream`}
              >
                <span className="relink-housechip-name">{r.name}</span>
                <span className="relink-housechip-task">{`"${r.task}" · ${activityStatusWords(r.status)}`}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};

// Memoized: the composer re-renders on every keystroke; this does not need to
// (2026-09-28 smoothness pass).
export const HouseActivityChip = memo(HouseActivityChipView);
