// CollisionPrompt — the switch-vs-reconnect question, presentational only.
//
// Raised when an opened folder already belongs to another project: switch to
// the owning project, or reconnect the folder into the active one. Shared by
// every surface that opens folders (Projects window, REPO MAP, the composer's
// attach menu), so the witness meets ONE prompt wherever the collision arises.

import './ProjectsApp.css';

import { baseName } from '../../../utils/path.js';

/**
 * @param {{
 *   folder: string,
 *   ownerName: string,
 *   hereName: string|null,
 *   canReconnect: boolean,
 *   onSwitch: () => void,
 *   onReconnect: () => void,
 *   onCancel: () => void,
 * }} props
 */
export const CollisionPrompt = ({ folder, ownerName, hereName, canReconnect, onSwitch, onReconnect, onCancel }) => (
  <div className="picker-overlay" onMouseDown={onCancel}>
    <div className="proj-collide cham" onMouseDown={(e) => e.stopPropagation()}>
      <div className="proj-collide-in cham-in">
        <span className="label-data proj-collide-title">«FOLDER ALREADY IN A PROJECT»</span>
        <p className="proj-collide-body">
          <span className="proj-collide-folder">{baseName(folder)}</span> belongs to
          {' '}<span className="proj-collide-owner">{ownerName}</span>. Switch to that project{hereName ? (
            <>, or reconnect this folder into <span className="proj-collide-owner">{hereName}</span></>
          ) : null}?
        </p>
        <div className="proj-collide-acts">
          <button type="button" className="proj-create" onClick={onSwitch}>SWITCH TO «{ownerName.toUpperCase()}»</button>
          <button type="button" className="proj-act" onClick={onReconnect} disabled={!canReconnect}>RECONNECT HERE</button>
          <button type="button" className="proj-act" onClick={onCancel}>CANCEL</button>
        </div>
      </div>
    </div>
  </div>
);
