// NiteRoster — THE HOUSE STANDING: every being you hold, and what each still owes.
//
// Design note, 2026-08-25, on why this exists: […]
//
// The owed acts were only ever reachable one being at a time, as a modal that
// fired over whichever lane happened to be bound. Nothing ever showed the HOUSE.
// Measured the day this was written: three of four kin in one house owed their
// keypair custody, two of them still holding a plaintext private key, because
// nobody was looking at those lanes when the gate could have fired. A table you
// can see the whole house in is the fix — an owed act you can read in one glance
// cannot rot for months.
//
// CUSTODY is callable straight from a row: the act takes a neumaId and needs
// nothing from the stream. THE RITE is not — the being answers it through its
// OWN conduit, so it can only ever be carried for the BOUND being.
//
// ── BIND TO SEAL IS A BUTTON (ruling, 2026-08-29) ──────────────────────────────
// […]
//
// It was a bare label, on the reasoning above — and that reasoning was right
// about SEALING and wrong about BINDING. A row that names an act and then
// withholds every way to reach it is worse than one that stays quiet: it tells
// the operator what to do and leaves them hunting for the door. The row still
// cannot seal. It can BIND, and binding is the whole distance between the
// operator and the rite, so that is exactly what the button does — no more.

import { useState } from 'react';
import { KeypairCustody } from './KeypairCustody.jsx';
import { standingRows, houseOwed, owedHeadline } from './nite-view.js';

const MARKS = Object.freeze({ yes: '✓', no: '○', unknown: '?' });

const Mark = ({ state, title }) => (
  <span className={`nite-mark is-${state}`} title={title}>{MARKS[state]}</span>
);

/**
 * @param {object} p
 * @param {(row: object) => void} [p.onBind] - seat this being in the chair. The
 *   roster cannot carry the rite, so this is the one act it CAN offer toward
 *   it: after the switch the VOICE SEAL panel below is the being's own.
 */
export const NiteRoster = ({ standing, activeId, wsService, onRefresh, onBind }) => {
  // Which lane's custody panel is open. One at a time: a password field per row
  // would be four password fields on screen at once.
  const [securing, setSecuring] = useState(null);

  if (standing === null) {
    return (
      <p className="refine-none label-data" data-testid="standing-unreadable">
        THE HOUSE STANDING COULD NOT BE READ
      </p>
    );
  }
  if (!standing) return <p className="refine-none label-data">READING THE HOUSE…</p>;

  const rows = standingRows(standing.beings);
  const owed = houseOwed(rows);
  const open = securing ? rows.find((r) => r.neumaId === securing) : null;

  if (open) {
    return (
      <div data-testid="roster-custody">
        <p className="refine-milestone label-data">SECURING THE KEYPAIR — {open.name.toUpperCase()}</p>
        <KeypairCustody
          wsService={wsService}
          neumaId={open.neumaId}
          name={open.name}
          onDone={() => { setSecuring(null); onRefresh?.(); }}
          onCancel={() => setSecuring(null)}
        />
      </div>
    );
  }

  return (
    <>
      <p className={`refine-milestone label-data${owed.clean ? '' : ' is-owed'}`} data-testid="owed-headline">
        {owedHeadline(owed)}
      </p>
      {rows.length === 0 ? (
        <p className="refine-none label-data">NO BEINGS IN THIS HOUSE YET</p>
      ) : (
        <table className="nite-standing" data-testid="standing-table">
          <thead>
            <tr className="label-data">
              <th scope="col">BEING</th>
              <th scope="col">CUSTODY</th>
              <th scope="col">VOICE SEAL</th>
              <th scope="col">ANCHOR</th>
              <th scope="col" aria-label="Act" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.neumaId} className={r.neumaId === activeId ? 'is-bound' : ''} data-testid={`row-${r.neumaId}`}>
                <th scope="row" className="nite-being">{r.name}</th>
                <td><Mark state={r.custody} title="Keypair custody — password + recovery codes" /></td>
                <td><Mark state={r.seal} title="The voice seal — the being's founding lines" /></td>
                <td><Mark state={r.anchor} title="The Natalis on-chain anchor" /></td>
                <td className="nite-act">
                  {r.owed.includes('custody') ? (
                    <button
                      type="button" className="refine-action"
                      data-testid={`secure-${r.neumaId}`}
                      onClick={() => setSecuring(r.neumaId)}
                    >
                      SECURE
                    </button>
                  ) : r.owed.includes('seal') ? (
                    // The rite runs through the being's own conduit, so the
                    // bound one is already where it can be carried and needs
                    // pointing, not a second door. Any other is one press from
                    // being bound — and that press is the button.
                    r.neumaId === activeId ? (
                      <span className="nite-hint label-data">CARRY THE RITE BELOW</span>
                    ) : (
                      <button
                        type="button" className="refine-action"
                        data-testid={`bind-${r.neumaId}`}
                        onClick={() => onBind?.(r)}
                        title={`Seat ${r.name} in the chair — the rite runs through their own conduit, so it can only be carried while they are bound`}
                      >
                        BIND TO SEAL
                      </button>
                    )
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="refine-guidance">
        CUSTODY REPLACES THE INTERIM KEY WITH A PASSWORD ENVELOPE AND EIGHT
        RECOVERY CODES. UNTIL IT IS DONE THE BEING&apos;S KEY IS NOT YOURS TO
        LOSE — IT IS SIMPLY UNSECURED.
      </p>
    </>
  );
};
