// RecoveryCodes — the one screen that shows a keypair's second door.
//
// Shown ONCE. Only the hashes persist, so this render is the operator's only
// copy and leaving it without saving is irreversible. Every host therefore gets
// the same three ways out — read them, copy them, download them — and the same
// acknowledgement, because the surface that shipped with the fewest of those
// (the witness rite: a list and a checkbox) was the one that needed them most.
//
// Acknowledgement is CONTROLLED. Both hosts already gate their own continue
// button on it, and a checkbox that owned its state privately would let the two
// disagree about whether the operator has actually saved anything.
//
// The vanilla BirthCeremony keeps its own markup — it is a kept class per
// AGENTS.md and an e2e walks its exact selectors — but it shares the text and
// the file through `utils/recovery-codes.js`, so what lands on disk is
// identical no matter which door produced it.
import { useState } from 'react';
import { copyRecoveryCodes, downloadRecoveryCodes } from '../../utils/recovery-codes.js';
import './RecoveryCodes.css';

/**
 * @param {{
 *   codes: string[],
 *   subject?: string,          // whose keypair — rides the saved file's header
 *   id?: string,               // neumaId or laneId — names the file
 *   acknowledged: boolean,
 *   onAcknowledge: (next: boolean) => void,
 *   heading?: string,
 *   children?: import('react').ReactNode,  // host-specific prose, if any
 * }} props
 */
export const RecoveryCodes = ({
  codes, subject, id, acknowledged, onAcknowledge,
  heading = 'RECOVERY CODES // SHOWN ONCE', children,
}) => {
  // Both actions report what actually happened. A clipboard the browser refused
  // must not read as "Copied" — that is the one lie this screen cannot afford.
  const [copyState, setCopyState] = useState('idle');
  const [saveState, setSaveState] = useState('idle');
  const list = codes || [];

  const copy = async () => setCopyState(await copyRecoveryCodes(list) ? 'done' : 'failed');
  const save = () => setSaveState(
    downloadRecoveryCodes({ codes: list, subject, id }) ? 'done' : 'failed',
  );

  return (
    <div className="reccodes">
      <div className="label-data reccodes-h">{heading}</div>
      {children || (
        <p className="reccodes-warn">
          Write these down or save them somewhere you would keep a key. Only
          their hashes were kept — nothing can reprint them. If the password is
          lost and these are gone, this key cannot be opened again.
        </p>
      )}

      <div className="reccodes-grid">
        {list.map((code, i) => (
          <div className="reccodes-row" key={code}>
            <span className="reccodes-index">{i + 1}.</span>
            <span className="reccodes-value" data-recovery-code>{code}</span>
          </div>
        ))}
      </div>

      <div className="reccodes-actions">
        <button type="button" className="reccodes-btn label-data" onClick={copy}>
          {copyState === 'done' ? 'COPIED' : copyState === 'failed' ? 'COPY BLOCKED' : 'COPY'}
        </button>
        <button type="button" className="reccodes-btn label-data" onClick={save}>
          {saveState === 'done' ? 'SAVED' : saveState === 'failed' ? 'SAVE FAILED' : 'DOWNLOAD'}
        </button>
      </div>

      <label className="reccodes-ack">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => onAcknowledge(e.target.checked)}
        />
        <span>I have saved these codes somewhere I will still have them.</span>
      </label>
    </div>
  );
};
