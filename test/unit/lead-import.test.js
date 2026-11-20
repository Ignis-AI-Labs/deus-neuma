/**
 * LEADS FROM ANOTHER TOOL, ONTO THE HOUSE'S OWN LIST (leads/lead-import.js, lead-ledger.js addMany) — Design note, 2026-11-18,
 * after Explee signed his emails with invented people and pitched a product he does not run: […] A file (the import JSON, or any CSV with an email column) becomes one lead a
 * person, standing where the conversation stands, every message on its history, and what the tool did in the house's
 * name said plainly. Pure parsing and planning, then the real ledger on a real temp file.
 */
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';
import { parseCsv, parseLeadFile, planImport } from '../../backend/services/leads/lead-import.js';
import { createLeadLedger } from '../../backend/services/leads/lead-ledger.js';
import { leadThread } from '../../backend/services/sales/lead-thread.js';
import { upkeepDue } from '../../backend/services/sales/lead-upkeep.js';

const OUT = (at, from, signedAs, subject, text) => ({ at, way: 'out', from, signedAs, subject, text });
const IN = (at, text) => ({ at, way: 'in', text });
const file = {
  kind: 'lead-import', source: 'explee', people: [
    { name: 'Andreas Saplaouras', email: 'Andreas@Slas.gr', title: 'Producer', company: 'Slas Productions Ltd', campaign: 'Video producers', project: 'Deus Neuma', outcome: 'interested', flags: ['invented-sender'],
      messages: [IN('2026-11-18T11:26:33Z', 'Could you share your website, a demo, hardware requirements and pricing?'), OUT('2026-11-18T10:57:38Z', 'cory@helloorbitline.com', 'Cory Richards', 'Storyboards', 'Hi Andreas,\n\nI am Cory at DEUS NEUMA.')] },
    { name: 'Dima Horshkov', email: 'dima@limitless.exchange', company: 'Limitless Labs', campaign: 'Base Ecosystem Apps', project: 'Umbrae', outcome: 'interested', flags: ['told-yield-product'],
      messages: [OUT('2026-11-13T09:00:00Z', 'e@getlift.ink', null, 'Prediction markets', 'steadier yield on the capital'), IN('2026-11-14T12:12:00Z', 'Hey. Yeah, curious about it.')] },
    { name: 'Tim Rikmenspoel', email: 'tim@huma.nl', campaign: 'Solo consultants', outcome: 'not_interested', messages: [OUT('2026-11-18T08:11:00Z', 'sophie@myscaledapi.co', 'Sophie Marshall', 'Growth Phase Check', 'Hallo Tim')] },
    { name: 'Gone', email: 'gone@nowhere.io', outcome: 'bounced', messages: [OUT('2026-11-13T08:00:00Z', 'e@x.co', null, 's', 'hello')] },
    { name: 'Hidden', email: 'g****@metalex.tech', outcome: 'none' },
    { name: 'Again', email: 'andreas@slas.gr', campaign: 'Creative studios', outcome: 'none', flags: ['told-yield-product'], messages: [OUT('2026-11-13T07:00:00Z', 'e@y.co', 'Eric Knight', 'Studios', 'An earlier email')] },
    { name: 'Known', email: 'known@house.io', outcome: 'none' },
  ],
};
const plan = () => {
  const parsed = parseLeadFile(JSON.stringify(file));
  return planImport(parsed.people, { source: parsed.source, onLedger: new Set(['known@house.io']), suppressed: () => false, by: 'operator' });
};

describe('a file becomes leads', () => {
  it('reads the import JSON and any CSV with an email column (quotes, commas and line breaks inside quotes); refuses what it cannot read', () => {
    expect(parseCsv('Email,Name,Last Reply\n"a@b.io","Doe, Jane","line one\nline two"\n')).toEqual([{ email: 'a@b.io', name: 'Doe, Jane', last_reply: 'line one\nline two' }]);
    const csv = parseLeadFile('person_id,name,email,job_title,company_name,emails_sent,first_sent_at,status,replied,bounced,unsubscribed,last_reply_at,last_reply\n1,Jan Pärnik,jan@jopp.ee,Director,Jopp Creative,1,2026-11-18T06:01:20Z,,false,false,false,,\n2,Keith Driver,keith@nl.ca,COO,Nature\'s Ledger,1,2026-11-13T09:00:00Z,Hot,true,false,false,2026-11-15T14:49:00Z,Interested in learning more.\n');
    expect(csv).toMatchObject({ ok: true, source: 'csv', people: [{ name: 'Jan Pärnik', email: 'jan@jopp.ee', outcome: 'none' }, { name: 'Keith Driver', outcome: 'interested', messages: [{ way: 'out' }, { way: 'in', text: 'Interested in learning more.' }] }] });
    expect(parseLeadFile('')).toMatchObject({ ok: false, reason: 'the file is empty' });
    expect(parseLeadFile('{"people": []}').reason).toMatch(/a JSON file must be a lead import/);
    expect(parseLeadFile('name,company\nJo,Acme\n').reason).toBe('the CSV needs an email column');
  });

  it('each person stands where the conversation stands, says what the tool did in our name, and the hidden, the known and the twice-reached are handled', () => {
    const p = plan();
    expect(p.counts).toEqual({ people: 7, add: 4, interested: 2, notInterested: 1, suppress: 1, flagged: 2, skip: 2 });
    const [andreas, dima, tim, gone] = p.add;
    expect(andreas).toMatchObject({ name: 'Andreas Saplaouras, Producer at Slas Productions Ltd', contact: 'andreas@slas.gr', status: 'replied', kind: 'buyer', source: 'imported from explee · Deus Neuma · Video producers + Creative studios' });
    // Reached by two campaigns: one lead, both campaigns' messages in order, every flag.
    expect(andreas.history.map((t) => [t.at.slice(0, 10), t.direction])).toEqual([['2026-11-13', 'out'], ['2026-11-18', 'out'], ['2026-11-18', 'in']]);
    expect(andreas.history[1].note).toBe('emailed by explee as "Cory Richards" <cory@helloorbitline.com>: "Storyboards"\n\nHi Andreas,\n\nI am Cory at DEUS NEUMA.');
    expect(andreas.note).toBe('imported from explee (Video producers + Creative studios): interested — was written to under a name that is not a real person — WAS TOLD OF A YIELD OR MANAGED-LIQUIDITY PRODUCT THE HOUSE DOES NOT RUN — owes a correction');
    expect(dima.note).toMatch(/owes a correction$/);
    expect([tim.status, gone.status]).toEqual(['lost', 'lost']);
    expect(p.suppress).toEqual([{ target: 'gone@nowhere.io', reason: 'bounced', note: 'bounced on explee' }]);
    expect(p.skip.map((s) => s.why)).toEqual(['the tool hid the address (it shows it only once someone replies)', 'already on the lead list']);
  });

  it('the ledger takes them in one write, each with its history at the moments it passed: a reply waits for an answer, every message opens whole', async () => {
    const ledger = createLeadLedger({ path: path.join(await createTempDir('lead-import'), 'leads.json') });
    const written = await ledger.addMany(plan().add.map(({ outcome, flags, ...lead }) => lead));
    expect(written).toHaveLength(4);
    const [andreas] = await ledger.load();
    expect(andreas.touches.map((t) => [t.at.slice(0, 10), t.direction ?? null, t.status ?? null])).toEqual([['2026-11-13', 'out', null], ['2026-11-18', 'out', null], ['2026-11-18', 'in', null], [andreas.createdAt.slice(0, 10), null, null]]);
    expect(leadThread(andreas).map((m) => [m.way, m.channel, m.from])).toEqual([['out', 'email', 'e@y.co'], ['out', 'email', 'cory@helloorbitline.com'], ['in', 'email', null]]);
    expect(upkeepDue({ leads: await ledger.load(), now: Date.now() }).filter((u) => u.kind === 'answer').map((u) => u.name)).toEqual(['Andreas Saplaouras, Producer at Slas Productions Ltd', 'Dima Horshkov at Limitless Labs']);
    // Nothing is written unless every lead stands.
    await expect(ledger.addMany([{ name: 'ok', contact: 'ok@x.io' }, { status: 'nonsense' }])).rejects.toThrow(/lead 2/);
    expect(await ledger.load()).toHaveLength(4);
  });
});
