// CompanySources — a company's SITE & CODE: the site on record, the code
// repositories it is built from, and which of them the house's CMO may read.
//
// The owner, 2026-10-24: the CMO must be able to […]. So the
// picture first (how many repos, how many the CMO can read), each repo with a
// mark that says what it is to the CMO, and one card per repo for the owner's
// yes. PROPOSED repos are only proposals: nothing is recorded until the owner
// confirms the ticked ones.

import { useState } from 'react';
import { useCompanySources } from './use-company-sources.js';
import { useLinkChanges } from './use-link-changes.js';
import {
  repoState, sourcesTally, cmoName, storedRepo, typedRepoRefusal, withTicked,
} from './company-sources-view.js';
import { cmoHandTo, listsRepo } from './link-change-view.js';
import { LinkChangeCard } from './LinkChangeCard.jsx';
import { approveLinkChange, declineLinkChange } from '../../../services/company-sources-client.js';
import { handOver } from '../doors/hand-over.js';
import { DoorButton } from '../doors/DoorButton.jsx';
import { useWindows } from '../../windowing/use-windows.js';
import { uiSound } from '../../../services/ui-sound.js';
import { EmptyState } from '../empty-state.jsx';
import './CompanySources.css';

const EMPTY_TYPED = Object.freeze({ path: '', remote: '', role: '' });

// The one card for the owner's yes: what the CMO gets, and what it never gets.
const GrantCard = ({ repo, who, busy, onYes, onNo }) => (
  <div className="bk-src-card cham" role="dialog" aria-label="let the CMO read this repo" data-src-card>
    <div className="cham-in">
      <h5 className="label-data">LET {who.toUpperCase()} READ THIS REPO?</h5>
      <p className="bk-note"><b>{repo.role || 'This repo'}</b> — <code>{repo.path}</code></p>
      <p className="bk-note">
        {who} can read its files and its history, so it can report on what changes. It can never
        change anything there. The walls stay shut: .env files, keys, credential stores and git
        internals are never read. You can take it back here or in PERMISSIONS.
      </p>
      <div className="bk-modal-acts">
        <button type="button" onClick={onNo} disabled={busy}>NOT NOW</button>
        <button type="button" className="is-go" onClick={onYes} disabled={busy}>LET IT READ</button>
      </div>
    </div>
  </div>
);

const RepoRow = ({ repo, cmo, who, busy, onAsk, onRevoke, onRemove }) => {
  const state = repoState(repo, cmo);
  return (
    <li className={`bk-src-repo is-${state.key}`} data-src-repo={repo.path || repo.remote}>
      <span className="bk-src-mark" aria-hidden="true" />
      <div className="bk-src-what">
        <b>{repo.role || 'NO ROLE WRITTEN'}</b>
        {repo.path ? <code>{repo.path}</code> : null}
        {repo.remote ? <a href={repo.remote} target="_blank" rel="noreferrer">{repo.remote}</a> : null}
        <small className="label-data" data-src-state>{state.label}</small>
        <small>{state.note}</small>
      </div>
      <div className="bk-src-acts">
        {state.key === 'closed' ? <button type="button" className="is-go" disabled={busy} onClick={onAsk}>LET {who.toUpperCase()} READ</button> : null}
        {state.key === 'granted' ? <button type="button" disabled={busy} onClick={onRevoke}>TAKE BACK</button> : null}
        <button type="button" className="bk-list-del" aria-label={`remove ${repo.path || repo.remote}`} disabled={busy} onClick={onRemove}>×</button>
      </div>
    </li>
  );
};

const Proposals = ({ proposals, setProposals, busy, onConfirm }) => (
  <div className="bk-src-proposals" data-src-proposals>
    <h5 className="label-data">PROPOSED — TICK WHAT IS THIS COMPANY'S, THEN CONFIRM</h5>
    <ul>
      {proposals.map((p, i) => (
        <li key={p.path} data-src-proposal={p.path}>
          <label>
            <input type="checkbox" checked={p.ticked}
              onChange={(e) => setProposals(proposals.map((q, j) => (j === i ? { ...q, ticked: e.target.checked } : q)))} />
            <code>{p.path}</code>
          </label>
          <input type="text" value={p.role} placeholder="what is it? (the app, the website…)" aria-label={`role of ${p.path}`}
            onChange={(e) => setProposals(proposals.map((q, j) => (j === i ? { ...q, role: e.target.value } : q)))} />
          {p.remote ? <small>{p.remote}</small> : null}
        </li>
      ))}
    </ul>
    <div className="bk-modal-acts">
      <button type="button" onClick={() => setProposals(null)} disabled={busy}>DISMISS</button>
      <button type="button" className="is-go" disabled={busy || !proposals.some((p) => p.ticked)} onClick={onConfirm}>
        CONFIRM {proposals.filter((p) => p.ticked).length} REPO(S)
      </button>
    </div>
  </div>
);

// What the site and repos lack goes to the house's CMO, the ask drafted in its
// chat (never sent): it proposes, the operator approves. No CMO: the door to seat one.
const HandToCmo = ({ handTo, seated }) => {
  const windows = useWindows();
  const [handed, setHanded] = useState(false);
  if (!seated) return <DoorButton door={{ kind: 'marketing', tab: 'seat' }} label="SEAT A CMO" title="a seated CMO can find and propose these for you" />;
  if (!handTo || !windows?.dispatch) return null;
  const hand = async () => { uiSound('open'); if (await handOver(handTo, windows)) setHanded(true); };
  return (
    <span className="bk-lc-hand">
      <button type="button" className="settings-set door-btn" data-hand-cmo title={`${handTo.name}'s chat opens with the ask drafted; you send it`} onClick={hand}>
        HAND TO {handTo.name.toUpperCase()}
      </button>
      {handed ? <span className="door-handed" role="status" title="nothing is sent until you send it">DRAFTED · {handTo.name.toUpperCase()}</span> : null}
    </span>
  );
};

export const CompanySources = ({ companyId, roster }) => {
  const src = useCompanySources(companyId);
  const links = useLinkChanges(companyId);
  const [typed, setTyped] = useState(EMPTY_TYPED);
  const [asking, setAsking] = useState(null);

  if (src.company === undefined) return src.error ? <EmptyState title="THE SOURCES COULD NOT BE READ" tone="error"><small>{src.error}</small></EmptyState> : <EmptyState title="READING…" />;
  if (src.company === null) return <EmptyState title="SAVE THIS KIT FIRST"><small>A company's sources are recorded once its kit is saved.</small></EmptyState>;

  const { company, cmo } = src;
  const who = cmoName(cmo, roster) || 'the CMO';
  const tally = sourcesTally(company);
  const refusal = typedRepoRefusal(typed, company.repos);
  const save = (repos, done) => src.saveRepos(repos, done);
  const proposer = (laneId) => cmoName({ laneId }, roster) || 'the CMO';
  const decide = (change, approve) => src.run(async () => {
    await (approve ? approveLinkChange : declineLinkChange)(change.id);
    await links.settle();
  }, approve
    ? `Approved — written onto ${company.name}.${listsRepo(change.rows) ? ` ${who} cannot read a new repo until you let it, on its row.` : ''}`
    : 'Declined — nothing was changed.');
  const handTo = links.changes.length ? null : cmoHandTo(cmo, who, company);

  return (
    <div className="bk-section bk-src" data-company-sources={company.id} {...links.handlers}>
      <header className="bk-section-head">
        <h4 className="label-data">SITE &amp; CODE</h4>
        <p className="bk-note">Where {company.name}'s work stands, so {who} can keep on top of every change and report it accurately.</p>
      </header>

      {links.changes.map((change) => (
        <LinkChangeCard key={change.id} change={change} who={proposer(change.laneId)} busy={src.busy}
          onApprove={() => decide(change, true)} onDecline={() => decide(change, false)} />
      ))}
      {links.error ? <p className="bk-modal-hint label-data is-bad">PROPOSED CHANGES COULD NOT BE READ: {links.error}</p> : null}

      <div className="bk-src-tally" data-src-tally>
        <span><b>{tally.repos}</b><small className="label-data">REPOS</small></span>
        <span className={tally.readable ? 'is-live' : ''}><b>{tally.readable}</b><small className="label-data">{who.toUpperCase()} CAN READ</small></span>
        <span><b>{company.site.url ? 1 + company.site.links.length : 0}</b><small className="label-data">SITE PAGES</small></span>
      </div>

      <section className="bk-src-site">
        <h5 className="label-data">THE SITE</h5>
        {company.site.url
          ? <p><a href={company.site.url} target="_blank" rel="noreferrer">{company.site.url}</a>{company.site.links.length ? ` and ${company.site.links.length} more page(s)` : ''}</p>
          : <p className="bk-note">No site is on record for {company.name}.</p>}
        {handTo || (!cmo && !(company.site.url && company.repos.length)) ? <HandToCmo handTo={handTo} seated={Boolean(cmo)} /> : null}
      </section>

      <section>
        <h5 className="label-data">CODE REPOSITORIES</h5>
        {company.repos.length ? (
          <ul className="bk-src-repos">
            {company.repos.map((repo) => (
              <RepoRow key={repo.path || repo.remote} repo={repo} cmo={cmo} who={who} busy={src.busy}
                onAsk={() => setAsking(repo)}
                onRevoke={() => src.revoke(repo.path)}
                onRemove={() => save(company.repos.filter((r) => r !== repo).map(storedRepo), `Removed ${repo.path || repo.remote}.`)} />
            ))}
          </ul>
        ) : <p className="bk-note">No repos are listed yet. Look for them on this computer, or add one by hand.</p>}

        {asking ? (
          <GrantCard repo={asking} who={who} busy={src.busy}
            onNo={() => setAsking(null)}
            onYes={async () => { if (await src.grant(asking.path)) setAsking(null); }} />
        ) : null}

        {src.proposals?.length ? (
          <Proposals proposals={src.proposals} setProposals={src.setProposals} busy={src.busy}
            onConfirm={async () => {
              if (await save(withTicked(company.repos, src.proposals), 'The ticked repos are listed.')) src.setProposals(null);
            }} />
        ) : (
          <button type="button" className="bk-src-look" disabled={src.busy} onClick={src.propose}>LOOK FOR {company.name.toUpperCase()}'S REPOS ON THIS COMPUTER</button>
        )}

        <div className="bk-src-add" data-src-add>
          <input type="text" value={typed.path} placeholder="/the/folder/on/this/computer" aria-label="repo folder"
            onChange={(e) => setTyped({ ...typed, path: e.target.value })} />
          <input type="text" value={typed.remote} placeholder="https://github.com/…" aria-label="repo web address"
            onChange={(e) => setTyped({ ...typed, remote: e.target.value })} />
          <input type="text" value={typed.role} placeholder="what is it? (the app…)" aria-label="repo role"
            onChange={(e) => setTyped({ ...typed, role: e.target.value })} />
          <button type="button" disabled={src.busy || Boolean(refusal)}
            onClick={async () => {
              if (await save([...company.repos.map(storedRepo), storedRepo(typed)], 'Added.')) setTyped(EMPTY_TYPED);
            }}>ADD</button>
        </div>
        {(typed.path || typed.remote) && refusal ? <p className="bk-modal-hint label-data is-bad">{refusal}</p> : null}
      </section>

      {src.notice ? <p className={`bk-src-notice label-data is-${src.notice.tone}`} role="status" data-src-notice>{src.notice.text}</p> : null}
    </div>
  );
};
