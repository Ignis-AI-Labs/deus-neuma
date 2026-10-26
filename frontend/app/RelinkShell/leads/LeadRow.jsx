// LeadRow — one lead as one inventory row (show-dont-tell-audit.md finding
// 5): its stage as a mark, who they are (the platform's mark beside the name
// where they surfaced on one), how to reach them, who holds them by name, the
// last note. The acts fold behind the row's ⋯ (the desk's one CtxMenu, as the
// BOARD's panels do): move to a stage, add a note, remove. A lead no one holds
// is one press to the house's CMO (HAND TO, the ask drafted, never sent).
// Every change lands as one recorded touch on the lead's history.
//
// impure — the ledger's acts, sound, the hand-over.

import { useState } from 'react';
import { uiSound } from '../../../services/ui-sound.js';
import { touchLead, removeLead } from '../../../services/leads-client.js';
import { useWindows } from '../../windowing/use-windows.js';
import { CtxMenu } from '../CtxMenu.jsx';
import { BrandMark } from '../brand-marks.jsx';
import { handOver } from '../doors/hand-over.js';
import { LeadStageMark } from './LeadStageMark.jsx';
import { holderOf, lastTouchOf, leadMenuItems, platformOf } from './lead-view.js';

/**
 * @param {{lead: object, stages: string[], roster: object[], handTo: ?{neumaId: string, name: string, prompt: string},
 *   onChanged: () => Promise<void>}} props
 */
export const LeadRow = ({ lead, stages, roster, handTo, onChanged }) => {
  const windows = useWindows();
  const [menu, setMenu] = useState(null);
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [handed, setHanded] = useState(false);
  const holder = holderOf(lead, roster);
  const { note: lastNote } = lastTouchOf(lead);
  const platform = platformOf(lead);
  const who = lead.name || lead.contact;

  const act = async (fn) => {
    uiSound('toggle');
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };
  const onAct = (id) => {
    if (id.startsWith('stage:')) {
      const status = id.slice('stage:'.length);
      if (status !== lead.status) act(() => touchLead(lead.id, { status }));
    } else if (id === 'note') {
      setNoting(true);
    } else if (id === 'remove' && window.confirm(`Remove lead "${who}"? This drops it and its history from the ledger.`)) {
      // A removal is permanent — the whole touch history goes with it.
      act(() => removeLead(lead.id));
    }
  };
  const saveNote = () => act(async () => {
    await touchLead(lead.id, { note: note.trim() });
    setNote('');
    setNoting(false);
  });
  const hand = async () => {
    uiSound('open');
    if (await handOver(handTo, windows)) setHanded(true);
  };
  const via = [platform ? `via ${platform}` : lead.channelId === 'email' ? 'via email' : null, lead.source || null].filter(Boolean).join(' · ');

  return (
    <li className="lead-row" data-lead={lead.id} data-stage={lead.status}>
      <LeadStageMark stage={lead.status} />
      <span className="lead-who acm" title={via || undefined}>
        {platform ? <BrandMark id={platform} /> : null}
        <span className="acm-name">{who}</span>
      </span>
      {lead.name && lead.contact ? <span className="lead-contact">{lead.contact}</span> : <span className="lead-contact" />}
      <span className="lead-holder">
        {holder ? <span title={holder.title}>{holder.name}</span>
          : handTo && windows?.dispatch ? (
            <button type="button" className="settings-set door-btn" disabled={busy}
              title={`${handTo.name}'s chat opens with the ask drafted; you send it`} onClick={hand}>
              HAND TO {handTo.name.toUpperCase()}
            </button>
          ) : <span className="lead-unheld" title="no one holds it">—</span>}
        {handed ? <span className="door-handed" role="status" title="nothing is sent until you send it">DRAFTED</span> : null}
      </span>
      <span className="lead-note" title={lastNote || undefined}>{lastNote || ''}</span>
      <button type="button" className="lead-more" aria-haspopup="menu" aria-expanded={Boolean(menu)} disabled={busy}
        aria-label={`${who}: stage, note, remove`} title="stage, note, remove"
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 2 }); }}>⋯</button>
      {menu ? <CtxMenu className="lead-menu" at={menu} items={leadMenuItems(stages, lead.status)} onAct={onAct} onClose={() => setMenu(null)} /> : null}
      {noting ? (
        <span className="lead-noting">
          <input className="settings-input" placeholder="What happened?" value={note} autoFocus
            onChange={(e) => setNote(e.target.value)} disabled={busy} />
          <button type="button" className="settings-set" disabled={busy || !note.trim()} onClick={saveNote}>TOUCH</button>
          <button type="button" className="settings-set" disabled={busy} onClick={() => { uiSound('toggle'); setNoting(false); }}>CLOSE</button>
        </span>
      ) : null}
      {error ? <p className="settings-err lead-err">{error}</p> : null}
    </li>
  );
};
