// GrantProtocol — what the red button grants and whether it may be pressed,
// shown BEFORE anything can be pressed (ruling, 2026-10-24): the grant as
// marks and numbers (GrantMarks.jsx: accounts by company, acts, pace, the day
// it turns itself off), what no mandate ever covers as six chips (a mark and
// at most three words, the whole sentence on hover), and the pre-flight
// checks — each passing one a ✓ in one row, named on hover; only a check that
// failed or could not be proven opens, with its plain line and its door to the
// exact place it is fixed (mandate-preflight.js; show-dont-tell-audit.md
// finding 6). The danger line above and the red button below stand exactly as
// ruled. Presentational: the screen (MandateGrantForm.jsx) hands it everything.

import { DoorButton } from '../doors/DoorButton.jsx';
import { HoldToGrant } from './HoldToGrant.jsx';
import { GrantMarks } from './GrantMarks.jsx';
import { Glyph } from './mandate-glyphs.jsx';

const MARK = Object.freeze({ true: '✓', false: '✗', null: '—' });
const toneOf = (ok) => (ok === true ? 'ready' : ok === false ? 'alert' : 'idle');
const SAID = Object.freeze({ true: 'passed', false: 'failed', null: 'not proven' });

/** @param {{rows: ?Array<object>, last: ?Array<object>, error: ?string}} props - rows null while a check runs */
const PreflightRows = ({ rows, last, error }) => {
  const checking = !rows;
  const shown = rows || (error ? [] : (last || []).map((r) => ({ ...r, ok: null, door: null })));
  if (!shown.length) return <p className="mandate-check-wait">{error ? `THE CHECKS COULD NOT BE READ — ${error}` : 'CHECKING…'}</p>;
  // While a re-check runs, every check holds its place as an unproven mark; settled, only what did not pass opens.
  const marked = shown.filter((r) => checking || r.ok === true);
  const open = checking ? [] : shown.filter((r) => r.ok !== true);
  return (
    <>
      <div className="mandate-check-marks" data-check-marks>
        {marked.map((r) => (
          <span key={r.id} className="mandate-check-mark" data-check={r.id} data-ok={String(r.ok)} data-tone={toneOf(r.ok)} role="img"
            aria-label={`${r.label}: ${checking ? 'checking' : SAID[String(r.ok)]}`} title={checking ? `${r.label} — checking` : `${r.label} — ${r.words}`}>
            {MARK[String(r.ok)]}
          </span>
        ))}
        {checking ? <span className="mandate-check-wait">CHECKING…</span> : null}
      </div>
      {open.length ? (
        <ul className="mandate-checks" data-mandate-checks>
          {open.map((r) => (
            <li key={r.id} data-check={r.id} data-ok={String(r.ok)}>
              <span className="mandate-check-mark" data-tone={toneOf(r.ok)} aria-label={SAID[String(r.ok)]}>{MARK[String(r.ok)]}</span>
              <span className="mandate-check-label">{r.label}</span>
              <span className="mandate-check-words">{r.words}</span>
              {r.door ? <DoorButton door={r.door} /> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
};

/** What no mandate covers: six chips, the whole sentence on hover. @param {{never: Array<{id: string, mark: string, says: string}>}} props */
const NeverChips = ({ never }) => (
  <div className="mandate-never" data-never>
    {never.map((n) => (
      <span key={n.id} className="mandate-never-chip" title={n.says}><Glyph name={n.id} />{n.mark}</span>
    ))}
  </div>
);

/**
 * The protocol's lower half: what is granted, what never is, the checks, and
 * the red button.
 * @param {{marks: object, never: Array<{id: string, mark: string, says: string}>, checks: {rows: ?Array<object>, last: ?Array<object>, error: ?string},
 *   atDesk: boolean, armed: boolean, busy: boolean, onGrant: () => void}} props
 */
export const GrantProtocol = ({ marks, never, checks, atDesk, armed, busy, onGrant }) => (
  <>
    <p className="mandate-h">WHAT YOU ARE GRANTING</p>
    <GrantMarks marks={marks} />
    <p className="mandate-h" title="what no mandate ever covers">NEVER COVERED</p>
    <NeverChips never={never} />
    <p className="mandate-h" title="every check must pass before the button can be pressed">CHECKS</p>
    <PreflightRows {...checks} />
    {checks.rows && !atDesk ? (
      <p className="mandate-desk-only" role="alert">Turn a mandate on from this computer&apos;s own desk. It can be withdrawn from anywhere.</p>
    ) : null}
    <HoldToGrant armed={armed} busy={busy} onGrant={onGrant} />
  </>
);
