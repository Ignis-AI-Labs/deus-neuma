// SocialCheckParts — the SOCIAL CHECK drawn (SHOW, DON'T TELL, 2026-10-24):
// a check is a mark shaped by its state (filled clear, struck triangle for a
// fix, broken ring not proven, a bar where nothing is reported), named on
// hover; an account is one card; a FIX opens as a short title and its door;
// the guided path numbers every fix across the house. The marks are the
// house's own: ● clear and ◐ not clear, the MARKETING tiles' (overview-words.js).
// Pure rendering — the acts arrive as props.

import { useState } from 'react';
import { BrandMark } from '../brand-marks.jsx';
import { AccountMark } from '../accounts/AccountMark.jsx';
import { MARK } from '../marketing-overview/overview-words.js';
import {
  accountTone, accountName, checkHover, doorLabel, doorPlace, fixesOf, TONE_WORDS,
} from './social-check-view.js';

/** One check's state as a shape — the same four shapes wherever a check is drawn. */
const CheckMark = ({ verdict }) => (
  <svg className={`sc-mark is-${verdict}`} width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    {verdict === 'pass' ? <circle className="sc-fill" cx="7" cy="7" r="5.5" /> : null}
    {verdict === 'fail' ? <><path className="sc-fill" d="M7 1 L13.5 13 H0.5 Z" /><path className="sc-cut" d="M7 5 V8.6 M7 10.2 V11" /></> : null}
    {verdict === 'unknown' ? <circle className="sc-ring" cx="7" cy="7" r="5.25" strokeDasharray="3 2.5" /> : null}
    {verdict === 'na' ? <path className="sc-line" d="M2 7 H12" /> : null}
  </svg>
);

const VERDICT_GLYPH = Object.freeze({ clear: MARK.clear.glyph, fail: MARK.failing.glyph, unknown: MARK.failing.glyph, optional: MARK.idle.glyph });

/** The account's own verdict: ● clear, ◐ not clear (needs you / not proven). */
const AccountVerdict = ({ row }) => {
  const tone = accountTone(row);
  return <span className={`sc-verdict is-${tone}`} aria-hidden="true">{VERDICT_GLYPH[tone]}</span>;
};

/** The guided path: every fix the house owes, numbered, each a door. */
export const GuidedPath = ({ steps, channelNames, onStep }) => (
  <ol className="sc-path" aria-label="What needs you, in order">
    {steps.map((s) => (
      <li key={s.key}>
        <button type="button" className="sc-step" data-step={s.n} data-accounts={s.accounts.join(' ')} onClick={() => onStep(s)}
          title={`${s.title} — ${doorPlace(s.door, channelNames[s.door.channelId])} · ${s.accounts.join(', ')}`}>
          <b className="sc-step-n">{s.n}</b>
          <span className="sc-step-t">{s.title}</span>
          {s.accounts.length > 1 ? <span className="sc-step-x" aria-label={`${s.accounts.length} accounts`}>×{s.accounts.length}</span> : null}
        </button>
      </li>
    ))}
  </ol>
);

// The expected @handle, recorded here: the field holds what the keys answered as, when they did.
const HandleFix = ({ door, busy, canOpen, onRecord, onKeys }) => {
  const [value, setValue] = useState(door.seen || '');
  const clean = value.trim().replace(/^@/, '');
  return (
    <span className="sc-handle-fix">
      <span className="sc-at" aria-hidden="true">@</span>
      <input className="settings-input sc-handle-in" value={value} onChange={(e) => setValue(e.target.value)}
        aria-label={`expected @handle of ${door.accountId}`} placeholder="handle" disabled={busy} data-handle-for={door.accountId} />
      <button type="button" className="settings-set sc-door" disabled={busy || !clean} onClick={() => onRecord(door.accountId, clean)}>
        {busy ? 'RECORDING…' : 'RECORD'}
      </button>
      <button type="button" className="settings-set sc-door-alt" disabled={!canOpen} title={`Settings → API → Channel keys → ${door.accountId}`}
        onClick={() => onKeys({ kind: 'keys', channelId: door.channelId, accountId: door.accountId })}>KEYS →</button>
    </span>
  );
};

/** One FIX as a step: its title, its door, and — where a member can do it — the hand-over. */
const FixStep = ({ check, row, acts }) => {
  const { fix } = check;
  const handed = acts.handed?.[`${row.id}:${check.id}`];
  const name = fix.handTo ? (fix.handTo.name || fix.handTo.neumaId) : '';
  return (
    <li className="sc-fix" data-check={check.id}>
      <span className="sc-fix-mark"><CheckMark verdict="fail" /></span>
      <span className="sc-fix-title" title={`${check.words} ${fix.words}`}>{fix.title}</span>
      <span className="sc-fix-acts">
        {fix.door.kind === 'handle' ? (
          <HandleFix door={fix.door} busy={acts.recording === row.id} canOpen={acts.canOpen} onRecord={acts.onRecord} onKeys={acts.onDoor} />
        ) : (
          <button type="button" className="settings-set sc-door" disabled={!acts.canOpen}
            title={acts.canOpen ? doorPlace(fix.door, row.channelName) : 'open the check from the desk to use its doors'}
            onClick={() => acts.onDoor(fix.door)}>
            {doorLabel(fix.door)} →
          </button>
        )}
        {fix.handTo ? (
          <button type="button" className="settings-set sc-hand" disabled={!acts.canOpen}
            title={`${name}'s chat opens with the ask drafted; you send it`} onClick={() => acts.onHand(row.id, check.id, fix.handTo)}>
            HAND TO {name.toUpperCase()}
          </button>
        ) : null}
        {handed ? <span className="sc-handed" role="status" title="nothing is sent until you send it">DRAFTED · {name.toUpperCase()}</span> : null}
      </span>
    </li>
  );
};

/**
 * One account in use: its AccountMark (the door to its account level), its verdict, then one mark per
 * check; its fixes open when it is the one focused (a press anywhere along the head).
 */
export const AccountCard = ({ row, companyName, focused, onPick, acts }) => {
  const tone = accountTone(row);
  const fixes = focused ? fixesOf(row) : [];
  return (
    <article className={`sc-card is-${tone}${focused ? ' is-focused' : ''}`} data-account={row.id}>
      <span className="sc-card-top">
        <AccountMark accountId={row.id} handle={accountName(row) === row.id ? null : accountName(row)} />
        <button type="button" className="sc-card-head" aria-pressed={focused} onClick={() => onPick(row.id)}
          aria-label={`${row.id} ${TONE_WORDS[tone]}`}
          title={`${row.id} · ${row.channelName} · ${companyName || 'no company'} — ${TONE_WORDS[tone]} · in use: ${row.reasons.join(', ')}`}>
          <AccountVerdict row={row} />
        </button>
      </span>
      <span className="sc-marks" role="list" aria-label={`${row.id} checks`}>
        {row.checks.map((c) => (
          <span key={c.id} role="listitem" className={`sc-check is-${c.verdict}`} data-check={c.id} title={checkHover(c)} aria-label={checkHover(c)}>
            <CheckMark verdict={c.verdict} />
          </span>
        ))}
      </span>
      {fixes.length ? (
        <ol className="sc-fixes" aria-label={`${row.id}: what to fix`}>
          {fixes.map((c) => <FixStep key={c.id} check={c} row={row} acts={acts} />)}
        </ol>
      ) : null}
    </article>
  );
};

/** The accounts and platforms nobody uses: apart, folded, never counted — an inventory, so a list. */
export const OptionalGroup = ({ optional, channelNames }) => {
  const [open, setOpen] = useState(false);
  const n = optional.accounts.length + optional.platforms.length;
  if (!n) return null;
  return (
    <details className="sc-optional" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="sc-optional-head" title="accounts not in use and platforms with no account — shown, never counted">
        <span aria-hidden="true">{open ? '▾' : '▸'}</span> OPTIONAL <b>{n}</b> · NOT COUNTED{open ? '' : ' · FOLDED'}
      </summary>
      <ul className="sc-inventory" aria-label="Accounts not in use">
        {optional.accounts.map((id) => <li key={id} title="not in use: no keys, no holder, no active campaign"><span className="sc-verdict is-optional" aria-hidden="true">{MARK.idle.glyph}</span>{id}</li>)}
      </ul>
      <ul className="sc-inventory" aria-label="Platforms with no account">
        {optional.platforms.map((id) => <li key={id} title="no account connected"><BrandMark id={id} />{channelNames[id] || id}</li>)}
      </ul>
    </details>
  );
};
