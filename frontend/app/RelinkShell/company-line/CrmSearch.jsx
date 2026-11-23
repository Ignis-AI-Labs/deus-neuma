// CrmSearch — FIND ANYTHING, at the top of LEADS: one search across the house's people, deals, invoices and companies
// (backend/services/leads/crm-search.js). Every word typed must be in a record for it to show. A person found opens
// in the sheet below; the rest say where they live. impure — network.

import { useState } from 'react';
import { Sheet } from '../sheet/Sheet.jsx';
import { searchCrm } from '../../../services/crm-client.js';

const KIND_WORDS = Object.freeze({ person: ['PERSON', 'LEADS, below'], deal: ['DEAL', 'DEALS'], invoice: ['INVOICE', 'TREASURY, INVOICES'], company: ['COMPANY', 'COMPANY'] });

/** @param {{onPerson: (name: string) => void}} props */
export const CrmSearch = ({ onPerson }) => {
  const [q, setQ] = useState('');
  const [found, setFound] = useState(null);
  const [said, setSaid] = useState(null);
  const find = async (e) => {
    e.preventDefault();
    if (!q.trim()) { setFound(null); return; }
    try { setFound(await searchCrm(q)); setSaid(null); } catch (err) { setSaid(err.message); }
  };
  const columns = [
    { head: 'FOUND', cell: (h) => (h.kind === 'person' ? <button type="button" className="cline-link" aria-label={`Show ${h.name} in the sheet below`} onClick={() => onPerson(h.name)}>{h.name}</button> : h.name) },
    { head: 'WHAT', cell: (h) => KIND_WORDS[h.kind][0] },
    { head: 'DETAIL', cell: (h) => h.sub || null },
    { head: 'WHERE', cell: (h) => KIND_WORDS[h.kind][1] },
  ];
  const more = found ? Object.entries(found.more ?? {}).map(([k, n]) => `${n} more ${KIND_WORDS[k][0]}${n === 1 ? '' : 'S'}: add a word`) : [];
  return (
    <form className="cline-open cline-ppl-find" role="search" aria-label="find anything in the house's records" onSubmit={find} data-crm-search="">
      <input className="cline-input" aria-label="Find a person, a deal, an invoice or a company by any word" placeholder="find anything: a person, a deal, an invoice, a company, a tag" value={q} onChange={(e) => setQ(e.target.value)} />
      <button type="submit" className="sec-scan cline-mini label-data">FIND</button>
      {said ? <p className="sec-error" role="alert">{said}</p> : null}
      {found ? <Sheet label="found" columns={columns} rows={found.hits} rowKey={(h) => `${h.kind}:${h.id}`} rowName={(h) => h.name}
        empty={<p className="cline-move-t" data-crm-found-none="">NOTHING HOLDS EVERY WORD OF "{found.words.join(' ')}"</p>} /> : null}
      {more.length ? <p className="cline-move-t">{more.join(' · ')}</p> : null}
    </form>
  );
};
