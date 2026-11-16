// ContactBook — every person the house knows, one record each, under the company they belong to (Founder,
// 2026-11-16: […]). One line for
// the book (people, companies, how many addresses stand at each strength), one line per company; open, each
// person with their title, their address and HOW SURE it is (read on a page, verified by a provider,
// confirmed because they wrote from it, or bounced), where it was found, and what they are on the lead list.
// A search narrows it; SAVE AS A SPREADSHEET writes the whole book to a file. Read from the house's own
// records every time (backend sales/contact-book.js). Pure rendering but for the search words.

import { useState } from 'react';
import { Fold } from '../fold/Fold.jsx';
import { STATE_WORDS, bookLine, contactGroups, companyLine, contactsCsv } from './contact-book-view.js';
import { KIND_WORDS } from './lead-list-view.js';

const SourceOf = ({ source }) => (/^https:\/\//.test(String(source))
  ? <a className="cline-link" href={source} target="_blank" rel="noreferrer noopener">{source}</a>
  : <span className="cline-exact">{source}</span>);

const Person = ({ c }) => {
  const [words, tone] = STATE_WORDS[c.state] ?? [String(c.state).toUpperCase(), null];
  return (
    <li className="cline-person" data-contact={c.email ?? c.name} data-contact-state={c.state}>
      <p className="cline-lead-who"><b>{c.name || c.email}</b>{c.title ? <span className="cline-lead-last"> · {c.title}</span> : null}</p>
      <p className="cline-lead-state">
        {c.email ? <span className="cline-exact">{c.email} </span> : c.reach ? <span className="cline-exact">{c.reach} </span> : null}
        <span className={`cline-chip${tone ? ` is-${tone}` : ''}`}>{words}</span>
      </p>
      <p className="cline-lead-state">
        {c.lead ? <span className="cline-chip">{KIND_WORDS[c.lead.kind]?.[0] ?? c.lead.kind} · {String(c.lead.status).toUpperCase()}</span> : <span className="cline-lead-last">NOT ON THE LEAD LIST</span>}
        {c.source ? <span className="cline-lead-last"> · FOUND: <SourceOf source={c.source} /></span> : null}
      </p>
    </li>
  );
};

/** @param {{contacts: object[], stats: ?object}} props */
export const ContactBook = ({ contacts = [], stats = null }) => {
  const [query, setQuery] = useState('');
  const groups = contactGroups(contacts, query);
  return (
    <Fold id="leads:contacts" title="THE CONTACT BOOK" stats={bookLine(stats)}>
      <p className="cline-move-t">Everyone the house has read, found or heard from, one record each. A record gets stronger as proof arrives: the strongest is a person who wrote back from the address.</p>
      {contacts.length ? (
        <div className="cline-open">
          <input className="cline-input" aria-label="Search the contact book by name, title, company or address" placeholder="search a name, a title, a company, an address" value={query} onChange={(e) => setQuery(e.target.value)} />
          <a className="sec-scan label-data pos-step-link" download="contacts.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(contactsCsv(contacts))}`}>SAVE AS A SPREADSHEET</a>
        </div>
      ) : null}
      {groups.map((g) => (
        <Fold key={g.key} id={`contacts:${g.key}`} level={2} title={g.company.toUpperCase()} stats={companyLine(g)}>
          <ul className="cline-lead-list" aria-label={`people at ${g.company}`}>
            {g.people.map((c) => <Person key={`${c.email ?? ''}|${c.name}`} c={c} />)}
          </ul>
        </Fold>
      ))}
      {contacts.length && !groups.length ? <p className="cline-move-t">NOBODY MATCHES THAT SEARCH</p> : null}
    </Fold>
  );
};
