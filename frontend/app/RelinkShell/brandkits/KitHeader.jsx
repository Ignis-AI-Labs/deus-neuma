// KitHeader — which kit, whether it is saved, and the way to save it.
//
// THE SWITCHER IS IN THE HEADER, not a roster column. Multi-brand is the
// normal case (Canva puts its Brand Kit picker in the header for the same
// reason), and moving it up here frees the left column to become the section
// rail — which is what the panel was actually missing.
//
// SAVE IS ALWAYS VISIBLE. It used to sit at the bottom of a long scroll with no
// indication that anything was unsaved, which is why selecting an owner and
// walking away lost it silently.
//
// AND THE DEAD END IS CLOSED. `writeKit` refuses with […] — true, and previously
// unactionable from the surface that raised it. The band below says it BEFORE
// nine sections are filled in, and carries the button that fixes it.

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Select } from '../Select.jsx';
import { FolderPicker } from '../picker/FolderPicker.jsx';
import { setHouseWorkspace } from '../../../services/house-workspace.js';
import { kitSwitcherOptions } from './brand-kits-view.js';

export const KitHeader = ({
  kits, totals, open, detail, draft, dirty, saving, notice, ground,
  onOpen, onNew, onSave, onGround, onRetryGround,
}) => {
  const [picking, setPicking] = useState(false);
  const [groundError, setGroundError] = useState(null);
  const options = kitSwitcherOptions(kits, open, draft?.name);
  // A read that failed is not "no ground set": no SET form over a ground that may stand.
  const unset = ground.known && !ground.root && !ground.unread;

  const chooseGround = async (root) => {
    setPicking(false);
    try {
      await setHouseWorkspace(root);
      setGroundError(null);
      onGround(root);
    } catch (err) {
      setGroundError(err?.message || 'that folder could not be used as the house ground');
    }
  };

  return (
    <header className="bk-head">
      <div className="bk-head-row">
        <Select
          id="bk-switch"
          ariaLabel="which brand kit"
          className="bk-switch"
          value={open || ''}
          options={options}
          placeholder={options.length ? 'CHOOSE A BRAND KIT' : 'NO BRAND KITS YET'}
          disabled={!options.length}
          onChange={onOpen}
        />
        <button type="button" className="bk-new" onClick={onNew}>NEW</button>

        <span className="bk-head-facts label-data">
          {detail?.brand ? detail.brand : ''}
          {detail?.where === 'repo' ? ' · SHIPPED WITH NEUMA' : detail ? ' · YOURS' : ''}
          {kits ? ` · ${totals.ready}/${totals.total} READY` : ''}
        </span>

        {dirty ? <span className="bk-dirty label-data" title="unsaved changes">● UNSAVED</span> : null}
        <button
          type="button"
          className="bk-save"
          onClick={onSave}
          disabled={saving || !dirty || !draft}
          title={unset
            ? 'no house ground is set, so there is nowhere of your own to keep a brand kit'
            : undefined}
        >
          {saving ? 'SAVING…' : 'SAVE'}
        </button>
      </div>

      {unset ? (
        <p className="bk-band">
          No house ground is set, so there is nowhere of your own to keep a brand
          kit. You can still read and edit — a save needs somewhere to land.
          <button type="button" onClick={() => setPicking(true)}>SET THE GROUND</button>
        </p>
      ) : null}
      {ground.unread ? (
        <p className="bk-band" role="alert">
          {`COULD NOT READ THE HOUSE GROUND — ${ground.unread}`}
          <button type="button" onClick={onRetryGround}>RETRY</button>
        </p>
      ) : null}
      {groundError ? <p className="bk-error">{groundError}</p> : null}

      {detail?.where === 'repo' ? (
        <p className="bk-note">
          This kit ships with the platform. Saving makes a copy of your own that
          takes precedence — the original is never changed.
        </p>
      ) : null}

      {notice ? <p className="bk-notice">{notice}</p> : null}

      {/* Portalled by the caller, the way HouseApp mounts the same picker —
          the overlay must escape this header's stacking context. */}
      {picking ? createPortal(
        <FolderPicker
          initialPath={ground.root || undefined}
          onPick={chooseGround}
          onCancel={() => setPicking(false)}
        />,
        document.body,
      ) : null}
    </header>
  );
};
