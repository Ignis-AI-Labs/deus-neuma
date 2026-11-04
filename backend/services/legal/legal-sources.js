// THE PRAETOR'S SOURCE MAP — where law is read, so research goes straight to
// the source instead of spending its energy finding one.
//
// What the paid legal AI tools (Westlaw/CoCounsel, Lexis+ AI, Harvey, vLex)
// share: they ground answers in PRIMARY law and run every cited case through a
// citator before it is shown. The benchmarks say why: even those tools
// hallucinate 17-33% of the time (Stanford RegLab, "Hallucination-Free?", 2025),
// a real source cited for a point it does not make ("misgrounding") counts as
// a hallucination, and graders reward primary authority over web summaries
// (Vals VLAIR Legal Research, 2025). So the map is the free, official,
// machine-readable sources, with the route that answers the office's own web
// tool (`reach`, measured by a live probe through the real web_fetch path),
// the citation check, and the playbook per question.
//
// Pure data and pure selection; the probe is the only impure part.

export const SOURCES_VERIFIED = '2026-10-20';

export const SOURCE_KINDS = Object.freeze(['statute', 'regulation', 'bill', 'case', 'guidance', 'licence', 'citation-check']);
export const SOURCE_JURISDICTIONS = Object.freeze(['US', 'US-WY', 'US-STATES', 'EU', 'UK', 'INTL']);

// reach: 'web_fetch' = answers the office's web tool as written; 'needs-key' = a
// free key the operator adds; 'search-only' = blocked to fetching, reach it through
// web_search snippets or the Wayback Machine (https://web.archive.org/web/2026/<url>).
const s = (o) => Object.freeze({ official: true, auth: 'none', reach: 'web_fetch', ...o });

export const LEGAL_SOURCES = Object.freeze([
  // ── US federal ──
  s({ id: 'uscode', name: 'US Code (Office of the Law Revision Counsel)', jurisdictions: ['US'], kinds: ['statute'],
    url: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title{T}-section{S}&num=0&edition=prelim',
    probe: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title47-section230&num=0&edition=prelim',
    notes: 'The most current text ("prelim"); say which edition you read.' }),
  s({ id: 'govinfo', name: 'GovInfo (US Code annual edition, CFR, Federal Register, public laws)', jurisdictions: ['US'], kinds: ['statute', 'regulation'],
    url: 'https://www.govinfo.gov/link/uscode/{T}/{S}?link-type=html',
    probe: 'https://www.govinfo.gov/link/uscode/47/230?link-type=html',
    notes: 'Use /link/ or /content/pkg/ — the /app/ pages are a script shell.' }),
  s({ id: 'ecfr', name: 'eCFR (current Code of Federal Regulations)', jurisdictions: ['US'], kinds: ['regulation'],
    url: 'https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-{N}?part={P}  ·  search: https://www.ecfr.gov/api/search/v1/results?query={q}',
    probe: 'https://www.ecfr.gov/api/search/v1/results?query=children%27s%20online%20privacy&per_page=1',
    notes: 'Currency: https://www.ecfr.gov/api/versioner/v1/titles.json (up_to_date_as_of). COPPA = 16 CFR 312; FinCEN BSA rules = 31 CFR 1010.' }),
  s({ id: 'federal-register', name: 'Federal Register API (rules, proposed rules, notices)', jurisdictions: ['US'], kinds: ['regulation', 'guidance'],
    url: 'https://www.federalregister.gov/api/v1/documents.json?conditions[term]={q}&conditions[agencies][]={agency-slug}&order=newest',
    probe: 'https://www.federalregister.gov/api/v1/documents.json?conditions[agencies][]=federal-trade-commission&per_page=1&order=newest',
    notes: 'The way to read the FTC: ftc.gov blocks automated reads.' }),
  s({ id: 'congress', name: 'Congress.gov API (bills, actions, text)', jurisdictions: ['US'], kinds: ['bill'], auth: 'api.data.gov key (DEMO_KEY: ~10/hour)',
    url: 'https://api.congress.gov/v3/bill?api_key={key}&format=json',
    probe: 'https://api.congress.gov/v3/bill?api_key=DEMO_KEY&format=json&limit=1',
    notes: 'The congress.gov website refuses automated reads; only the API answers. The CLO reads it with legal_research_api {api: "congress", path} — the house\'s key is added for you.' }),
  s({ id: 'regulations-gov', name: 'Regulations.gov API (dockets, comments)', jurisdictions: ['US'], kinds: ['regulation'], auth: 'api.data.gov key', reach: 'needs-key',
    url: 'https://api.regulations.gov/v4/documents?api_key={key}&filter[searchTerm]={q}',
    probe: null, notes: 'Read with legal_research_api {api: "regulations", path} once the operator saves the free api.data.gov key (the shared demo key is too slow). Most of what it holds is also in federal-register.' }),
  s({ id: 'courtlistener', name: 'CourtListener (Free Law Project): US case law search', jurisdictions: ['US', 'US-STATES'], kinds: ['case'],
    auth: 'free CourtListener token', reach: 'needs-key',
    url: 'https://www.courtlistener.com/api/rest/v4/search/?q={q}&type=o  (o = opinions, r = federal dockets)',
    probe: null,
    notes: 'Search needs the token too (it answers 401 without one, measured 2026-11-04). With the house\'s CourtListener token saved, legal_research_api {api: "courtlistener", path: "/search/"} searches, {path: "/opinions/<id>/"} reads opinions, and {api: "citations", text} checks every citation in a reading at once. Free tier ~125 calls/day — batch.' }),
  s({ id: 'cap', name: 'Caselaw Access Project (Harvard): official US reporters to ~2018', jurisdictions: ['US', 'US-STATES'], kinds: ['case', 'citation-check'],
    url: 'https://static.case.law/{reporter}/{volume}/CasesMetadata.json  ·  case: /{reporter}/{volume}/cases/{page4}-{nn}.json',
    probe: 'https://static.case.law/f3d/129/cases/0327-01.json',
    notes: 'Historical only. A reporter citation (volume, reporter, page) can be checked here with no key.' }),
  s({ id: 'scotus', name: 'Supreme Court slip opinions', jurisdictions: ['US'], kinds: ['case'],
    url: 'https://www.supremecourt.gov/opinions/slipopinion/{term}  (each opinion is a PDF: read it with {find} or {pages})',
    probe: 'https://www.supremecourt.gov/opinions/slipopinion/24' }),
  s({ id: 'sec', name: 'SEC (EDGAR full-text search, staff guidance)', jurisdictions: ['US'], kinds: ['guidance'],
    url: 'https://efts.sec.gov/LATEST/search-index?q="{q}"',
    probe: 'https://efts.sec.gov/LATEST/search-index?q=%22crypto%20asset%22',
    notes: 'SEC asks for a declared User-Agent ("Org name email"); a refusal here means read it through web_search.' }),
  s({ id: 'fincen', name: 'FinCEN guidance (money transmission, virtual currency)', jurisdictions: ['US'], kinds: ['guidance'],
    url: 'https://www.fincen.gov/resources/statutes-regulations/guidance',
    probe: 'https://www.fincen.gov/resources/statutes-regulations/guidance',
    notes: 'FIN-2019-G001 is the virtual-currency guidance; the rules themselves are 31 CFR 1010 (eCFR).' }),
  s({ id: 'copyright-office', name: 'US Copyright Office (AI reports, Compendium)', jurisdictions: ['US'], kinds: ['guidance'],
    url: 'https://www.copyright.gov/ai/  ·  https://www.copyright.gov/comp3/',
    probe: 'https://www.copyright.gov/ai/' }),
  s({ id: 'uspto', name: 'USPTO (AI guidance, trademarks)', jurisdictions: ['US'], kinds: ['guidance'],
    url: 'https://www.uspto.gov/initiatives/artificial-intelligence',
    probe: 'https://www.uspto.gov/initiatives/artificial-intelligence' }),
  s({ id: 'cornell-lii', name: 'Cornell LII (reading mirror of USC, CFR)', jurisdictions: ['US'], kinds: ['statute', 'regulation'], official: false,
    url: 'https://www.law.cornell.edu/uscode/text/{T}/{S}  ·  /cfr/text/{T}/{part}.{sec}',
    probe: 'https://www.law.cornell.edu/uscode/text/47/230',
    notes: 'For reading; cite the official source.' }),
  // ── US states ──
  s({ id: 'wyoleg', name: 'Wyoming Statutes (whole titles) and session bills', jurisdictions: ['US-WY'], kinds: ['statute', 'bill'],
    url: 'https://wyoleg.gov/statutes/compress/title{NN}.pdf  ·  bills: https://wyoleg.gov/Legislation/{year}',
    probe: 'https://wyoleg.gov/statutes/compress/title17.pdf', probeArgs: { find: '17-29-102' },
    notes: 'Whole-title PDFs (title 17 is 801 pages): ALWAYS fetch with {find: "<section number>"} — e.g. web_fetch {url, find: "17-29-102"} returns only the pages holding it. Title 17 = companies (LLC Act 17-29, DAO LLCs 17-31); 34 = property incl. digital assets (34-29); 40 = consumer protection (40-12); 6 = crimes. The site\'s own pages are script-only; the PDFs are the readable text.' }),
  s({ id: 'openstates', name: 'Open States / Plural (50-state bills)', jurisdictions: ['US-STATES', 'US-WY'], kinds: ['bill'], auth: 'free key', reach: 'needs-key',
    url: 'https://v3.openstates.org/bills?jurisdiction={st}&q={q}&apikey={key}',
    probe: null,
    notes: 'The way to track state age-assurance, AI and privacy bills: legal_research_api {api: "openstates", path: "/bills", query: {jurisdiction, q}} once the operator saves the key. Many state code sites (California, New York) refuse automated reads.' }),
  // ── EU ──
  s({ id: 'eu-cellar', name: 'EU law by CELEX number (Publications Office CELLAR)', jurisdictions: ['EU'], kinds: ['statute', 'regulation', 'case'],
    url: 'https://publications.europa.eu/resource/celex/{CELEX}',
    probe: 'https://publications.europa.eu/resource/celex/32016R0679',
    notes: 'CELEX: 3{year}R{n} regulation, 3{year}L{n} directive, 6{year}CJ{case} CJEU judgment. AI Act 32024R1689, GDPR 32016R0679, DSA 32022R2065. Cite the EUR-Lex URL (eur-lex.europa.eu/eli/reg/2024/1689/oj) even when the text came from here.' }),
  s({ id: 'eu-sparql', name: 'EU SPARQL (dates, in force, amendments, consolidated versions)', jurisdictions: ['EU'], kinds: ['statute', 'regulation'],
    url: 'https://publications.europa.eu/webapi/rdf/sparql?query={sparql}&format=application/sparql-results%2Bjson',
    probe: 'https://publications.europa.eu/webapi/rdf/sparql?query=PREFIX%20cdm%3A%20%3Chttp%3A%2F%2Fpublications.europa.eu%2Fontology%2Fcdm%23%3E%20SELECT%20%3Fwork%20%3Fdate%20WHERE%20%7B%20%3Fwork%20cdm%3Aresource_legal_id_celex%20%2232024R1689%22%5E%5E%3Chttp%3A%2F%2Fwww.w3.org%2F2001%2FXMLSchema%23string%3E%20.%20OPTIONAL%20%7B%20%3Fwork%20cdm%3Awork_date_document%20%3Fdate%20%7D%20%7D%20LIMIT%205&format=application%2Fsparql-results%2Bjson',
    notes: 'Check a text is in force and current before relying on it. Example: PREFIX cdm: <http://publications.europa.eu/ontology/cdm#> SELECT ?work ?date WHERE { ?work cdm:resource_legal_id_celex "32024R1689"^^<http://www.w3.org/2001/XMLSchema#string> . OPTIONAL { ?work cdm:work_date_document ?date } } — URL-encode it into {sparql}.' }),
  s({ id: 'ai-act-explorer', name: 'AI Act article by article (Future of Life Institute)', jurisdictions: ['EU'], kinds: ['statute'], official: false,
    url: 'https://artificialintelligenceact.eu/article/{n}/',
    probe: 'https://artificialintelligenceact.eu/article/50/',
    notes: 'For navigation; cite CELEX 32024R1689. Obligations phase in by date (Art. 113).' }),
  s({ id: 'edpb', name: 'EDPB guidelines (GDPR)', jurisdictions: ['EU'], kinds: ['guidance'],
    url: 'https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/{slug}_en',
    probe: 'https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-072020-concepts-controller-and-processor-gdpr_en',
    notes: 'A guideline\'s own page answers; the listing pages do not. Find the slug by web_search.' }),
  s({ id: 'curia', name: 'CJEU case files (CURIA)', jurisdictions: ['EU'], kinds: ['case'], reach: 'search-only',
    url: 'https://infocuria.curia.europa.eu/tabs/redirect/juris/liste.jsf?num=C-{n}/{yy}&language=en', probe: null,
    notes: 'A bot page blocks fetching. Read a judgment\'s text through eu-cellar with CELEX 6{year}CJ{case} (e.g. 62012CJ0131); cite the case number.' }),
  s({ id: 'eur-lex', name: 'EUR-Lex website', jurisdictions: ['EU'], kinds: ['statute', 'case'], reach: 'search-only',
    url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:{CELEX}', probe: null,
    notes: 'A script challenge blocks fetching. Cite its URLs; read the text through CELLAR.' }),
  // ── UK ──
  s({ id: 'legislation-gov-uk', name: 'legislation.gov.uk (UK statutes, point in time)', jurisdictions: ['UK'], kinds: ['statute', 'regulation'],
    url: 'https://www.legislation.gov.uk/{type}/{year}/{num}/section/{n}[/{YYYY-MM-DD}]/data.xml',
    probe: 'https://www.legislation.gov.uk/ukpga/2023/50/section/12/data.xml',
    notes: 'Online Safety Act 2023 = ukpga/2023/50; Data Protection Act 2018 = ukpga/2018/12. No JSON. Watch the "prospective" (not yet in force) flags.' }),
  s({ id: 'tna-caselaw', name: 'Find Case Law (The National Archives): UK judgments from 2001', jurisdictions: ['UK'], kinds: ['case'],
    url: 'https://caselaw.nationalarchives.gov.uk/atom.xml?query={q}&order=-date  ·  judgment: /{court}/{year}/{n}/data.xml',
    probe: 'https://caselaw.nationalarchives.gov.uk/uksc/2023/49/data.xml',
    notes: 'Reading and quoting judgments is free; bulk "computational analysis" needs a separate (free) licence.' }),
  s({ id: 'ico', name: 'ICO (UK GDPR guidance)', jurisdictions: ['UK'], kinds: ['guidance'],
    url: 'https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/',
    probe: 'https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/' }),
  s({ id: 'ofcom', name: 'Ofcom (Online Safety Act codes, age assurance)', jurisdictions: ['UK'], kinds: ['guidance'], reach: 'search-only',
    url: 'https://www.ofcom.org.uk/online-safety', probe: null,
    notes: 'A bot check blocks fetching: web_search snippets and the Wayback Machine.' }),
  // ── International and licences ──
  s({ id: 'wipo-lex', name: 'WIPO Lex (national IP laws, treaties)', jurisdictions: ['INTL'], kinds: ['statute'],
    url: 'https://www.wipo.int/wipolex/en/legislation/details/{id}', probe: 'https://www.wipo.int/wipolex/en/main/legislation',
    notes: 'Find the id by web_search.' }),
  s({ id: 'spdx', name: 'SPDX licence list (canonical licence texts)', jurisdictions: ['INTL'], kinds: ['licence'],
    url: 'https://spdx.org/licenses/{ID}.json  ·  text: https://raw.githubusercontent.com/spdx/license-list-data/main/text/{ID}.txt',
    probe: 'https://spdx.org/licenses/Apache-2.0.json' }),
  s({ id: 'osi', name: 'OSI-approved licences', jurisdictions: ['INTL'], kinds: ['licence'],
    url: 'https://opensource.org/api/license/{id}', probe: 'https://opensource.org/api/license' }),
  s({ id: 'github-licenses', name: 'GitHub licence summaries (permissions, conditions, limits)', jurisdictions: ['INTL'], kinds: ['licence'], official: false,
    url: 'https://api.github.com/licenses/{key}', probe: 'https://api.github.com/licenses/mit',
    notes: 'A checklist only; quote the licence text itself.' }),
  s({ id: 'huggingface', name: 'Hugging Face model cards (model licences)', jurisdictions: ['INTL'], kinds: ['licence'],
    url: 'https://huggingface.co/api/models/{org}/{repo}  (cardData.license, gated, cardData.extra_gated_prompt)  ·  card: /{org}/{repo}/raw/main/README.md',
    probe: 'https://huggingface.co/api/models/Wan-AI/Wan2.2-I2V-A14B',
    notes: 'Custom licences (Llama, OpenRAIL, community licences) carry use limits SPDX does not: read the model\'s own licence. For gated models the API\'s extra_gated_prompt holds the licence text.' }),
]);

// The playbook per kind of question: the order to read in.
export const PLAYBOOK = Object.freeze({
  statute: [
    'Name the instruments first: federal and state; EU regulation (applies directly) or directive (read the national law that implements it); UK Act plus its statutory instruments.',
    'Fetch the operative text from the official source (uscode / govinfo, eu-cellar by CELEX, legislation-gov-uk section data.xml, wyoleg title PDF).',
    'Check it is in force and current (eCFR up_to_date_as_of, eu-sparql, legislation.gov.uk point-in-time and prospective flags, congress / openstates for pending bills).',
    'Then the regulator\'s guidance, then the courts that read it (the case playbook). Answer with the controlling text quoted and a dated "law as of".',
  ],
  regulation: ['As statute: the rule\'s text (ecfr / federal-register / legislation-gov-uk), its effective date, then the agency\'s guidance — labelled persuasive, never law.'],
  bill: ['congress (US), openstates (states), wyoleg (Wyoming), legislation-gov-uk new-legislation feed (UK). A bill is not law: say its stage.'],
  case: [
    'Search: courtlistener (US), tna-caselaw (UK), curia / eu-cellar (EU); cap for older US reporter volumes.',
    'Read the opinion itself, not the snippet: holding or dicta, which court, binding or persuasive here.',
    'Later treatment: search the case\'s citation string for opinions citing it — a weaker stand-in for a citator; say so.',
  ],
  guidance: ['federal-register for FTC/agency rules, fincen, sec, copyright-office, uspto, edpb, ico; ofcom through web_search. Guidance is persuasive, not law.'],
  licence: [
    'Name the exact licence: huggingface cardData.license / gated / extra_gated_prompt, the repo LICENSE file, or the SPDX id.',
    'Read the full text (spdx, or the model\'s own licence): attribution, field-of-use and acceptable-use limits, revenue or user thresholds, copyleft triggers, output ownership.',
    'Record the licence version and the date you read it.',
  ],
  'citation-check': [
    'Before ANY legal answer leaves you, chat included: legal_cite_check {citations, text}. The platform re-reads every source, confirms the heading you name is printed there and every quoted word is on the page, and refuses [verify] marks and quotation marks no record carries. legal/assess, legal/file and legal/opinion run it again.',
    'Resolve every release, order or rule number to its title on the regulator\'s own site, and check the title is about your point before you cite it. Give each its standing: proposed, adopted, withdrawn, vacated or expired, with the date.',
    'A case: confirm name, court, year and the pinpoint passage — legal_research_api {api: "citations", text: "<every citation>"} checks them all at once when the house has a CourtListener token; without one, cap by reporter citation. Not found or ambiguous = do not cite it.',
    'Check the passage SUPPORTS the point — a real source cited for something it does not say is the most common failure of legal AI.',
  ],
});

export const CITATION_RECORD = '{claim (the point it supports), authority, pinCite (§ / Art. / para. / page), heading (as the source prints it), sourceUrl (where you read it), standing (in force / adopted / proposed, never adopted / vacated / dismissed, with its date), quote? (exact words, copied), pages? (PDF page)} — legal_cite_check has the platform re-read each one';

/**
 * The sources and playbook for one question. Pure.
 * @param {{kind?: string, jurisdiction?: string}} q
 */
const sourcesFor = ({ kind = null, jurisdiction = null } = {}) => {
  const k = SOURCE_KINDS.includes(kind) ? kind : null;
  const j = SOURCE_JURISDICTIONS.includes(jurisdiction) ? jurisdiction : null;
  const sources = LEGAL_SOURCES.filter((src) => (!k || src.kinds.includes(k)) && (!j || src.jurisdictions.includes(j)
    || (j === 'US-WY' && src.jurisdictions.includes('US')) || (j === 'US-STATES' && src.jurisdictions.includes('US'))));
  return { kind: k, jurisdiction: j, sources, playbook: k ? PLAYBOOK[k] : null };
};

/** The tool's answer, as text the office reads in one pass. Pure. */
export const sourcesText = (q) => {
  const { kind, jurisdiction, sources, playbook } = sourcesFor(q);
  const reachNote = { web_fetch: '', 'needs-key': ' [needs a free key the operator adds]', 'search-only': ' [blocked to fetching: web_search or https://web.archive.org/web/2026/<url>]' };
  return [
    `Sources for ${kind || 'any question'}${jurisdiction ? ` in ${jurisdiction}` : ''} (verified ${SOURCES_VERIFIED}; ${sources.length}):`,
    ...sources.map((src) => `- ${src.id}: ${src.name}${src.official ? '' : ' (unofficial — read here, cite the official source)'}${reachNote[src.reach] ?? ''}\n  ${src.url}${src.auth !== 'none' && src.reach !== 'needs-key' ? `\n  auth: ${src.auth}` : ''}${src.notes ? `\n  ${src.notes}` : ''}`),
    ...(playbook ? ['', `Playbook (${kind}):`, ...playbook.map((step, i) => `${i + 1}. ${step}`)] : ['', `Ask with {kind: ${SOURCE_KINDS.join(' | ')}} for the playbook, {jurisdiction: ${SOURCE_JURISDICTIONS.join(' | ')}} to narrow.`]),
    '',
    `Record every citation as: ${CITATION_RECORD}.`,
    'Commentary, summaries and mirrors point you to the law; they are never the citation. Paid databases (Westlaw, Lexis, Bloomberg, vLex) are out of reach — do not spend calls on them.',
  ].join('\n');
};
