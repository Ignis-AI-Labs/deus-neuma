// CampaignMaterial — the files that belong to a campaign.
//
// Design note, 2026-07-27: […]
// Shared files read by the bounded shared-files reader, so a
// being working this campaign sees the brief and the approved copy without a
// tool call — and works from THOSE rather than inventing positioning.
//
// Attaching is a READ GRANT, not a bookmark: the content enters a being's turn.
// The backend refuses secret-shaped paths (.env, keys, vault, another being's
// DNA) with a 403, and that refusal is shown here rather than swallowed. Each
// file is a chip (its full path on hover); the rule rides the heading's hover
// (show-dont-tell-audit.md finding 14).

import { useState } from 'react';
import { uiSound } from '../../../services/ui-sound.js';
import { attachCampaignFile, detachCampaignFile } from '../../../services/campaigns-client.js';

const RULE = 'files tied to this campaign are always-on context for whoever works it — the brief, the brand voice, the approved copy; untying never deletes the file';

/** @param {{campaign: object, onChanged: () => Promise<void>}} props */
export const CampaignMaterial = ({ campaign, onChanged }) => {
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const files = campaign.sharedFiles || [];

  const act = async (fn) => {
    setBusy(true); setErr(null);
    try { await fn(); setPath(''); await onChanged(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="label-data settings-h" title={RULE}>MATERIAL {files.length}</div>
      {err ? <p className="settings-err">{err}</p> : null}
      {files.length ? (
        <div className="campaign-files">
          {files.map((f) => (
            <span key={f.path} className="settings-tag-dim campaign-file" title={f.path}>
              {f.path.split('/').slice(-2).join('/')}
              <button type="button" className="settings-set" disabled={busy} title="untie — the file stays where it is"
                onClick={() => { uiSound('toggle'); act(() => detachCampaignFile(campaign.id, f.path)); }}>
                UNTIE
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="settings-control">
        <input
          type="text"
          className="settings-input"
          placeholder="/path/to/brief.md"
          aria-label="a file to tie, by its full path"
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
        <button type="button" className="settings-set" disabled={busy || !path.trim()}
          onClick={() => { uiSound('toggle'); act(() => attachCampaignFile(campaign.id, path.trim())); }}>
          TIE FILE
        </button>
      </div>
    </>
  );
};
