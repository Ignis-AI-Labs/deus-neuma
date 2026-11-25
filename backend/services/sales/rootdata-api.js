// ROOTDATA — a database of crypto projects, funds and the people at them, through the operator's own key.
//
// Design note, 2026-11-24: […] It is not a
// people-and-addresses provider like Hunter, Tomba or Apollo: it holds NO email. What it holds is what a crypto
// project IS and where it is reached: its X, LinkedIn, Discord and site, its tags and backers, and (on RootData's
// paid plans only) its team members. So it answers a different question, and stands beside the others, never in
// their place.
// Read from https://www.rootdata.com/api/doc on 2026-11-24. Every call is a POST with the header `apikey`.
//   /open/ser_inv        {query, precise_x_search?}  find a project, fund or person by name or X handle: free
//   /open/quotacredits   {}                          the plan and the credits left: free
//   /open/get_item       {project_id, include_team, include_investors}  one project: 2 credits. Its team members
//                        are returned on the Pro plan only; a Basic (free) key gets the project without them
//   Answers are {data, result, message?}; result 200 is yes, 110 a refused key, 403 no access or no credits left,
//   404 nothing matching, 410 the rate limit (100 a minute).
// The parsing is PURE; every call is impure and never throws.

import process from 'node:process';
import { sourceText } from './source-text.js';
import { testEndpoint } from '../test-endpoint-door.js';
import { answer, num } from './provider-call.js';

export const ROOTDATA_URL = 'https://api.rootdata.com';
export const ROOTDATA_PROJECT_COST = 2;
const NAME = 'RootData';
const urlOf = () => testEndpoint(process.env, 'NEUMA_LEAD_SOURCE_ROOTDATA', ROOTDATA_URL);
const link = (u) => (/^https?:\/\/\S+$/i.test(String(u ?? '').trim()) ? sourceText(String(u).trim().replace(/^http:/i, 'https:').replace(/^https:\/\/(www\.)?twitter\.com\//i, 'https://x.com/'), 300) : null);

/** pure — what a refusal means, in the operator's words. */
export const rootdataRefusal = (result, message) => {
  const said = message ? ` (${sourceText(message, 160)})` : '';
  if (result === 110) return `${NAME} refused the key — check it in SETTINGS, API, Lead data`;
  if (result === 403) return `${NAME}: this key's plan may not use this part of its API, or its credits are spent${said}`;
  if (result === 404) return `${NAME} holds nothing matching`;
  if (result === 410) return `${NAME}'s limit for this minute is reached — try again in a minute`;
  return `${NAME} answered ${result}${said}`;
};

// impure — one call: the `data` of a yes, or a thrown reason in words.
const ask = async (path, body, { apiKey, signal }) => {
  const res = await fetch(`${urlOf()}${path}`, { method: 'POST', signal, headers: { accept: 'application/json', 'content-type': 'application/json', apikey: apiKey, language: 'en' }, body: JSON.stringify(body ?? {}) });
  const json = await res.json().catch(() => ({}));
  const result = Number(json?.result ?? res.status);
  if (res.ok && result === 200) return json.data;
  throw new Error(rootdataRefusal(result, json?.message));
};

/** pure — the search's projects (type 1), in RootData's own order. */
export const projectsOfSearch = (data) => (Array.isArray(data) ? data : []).filter((r) => Number(r?.type) === 1 && Number.isInteger(Number(r?.id)))
  .map((r) => ({ id: Number(r.id), name: sourceText(r.name, 120), about: sourceText(r.introduce, 300), url: link(r.rootdataurl) }));

const flat = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
/** pure — the search result that IS this company: its name as written, or its domain's own label. Never a near miss. */
export const projectMatching = (projects, { name, domain }) => {
  const wanted = new Set([flat(name), flat(String(domain ?? '').split('.')[0])].filter((w) => w.length >= 3));
  return projects.find((p) => wanted.has(flat(p.name))) ?? null;
};

/**
 * pure — one project as the house keeps it: what it is, where it is reached, who backs it, and its team when the
 * plan returns one. A team row is kept only with a NAME; RootData holds no address for anyone.
 */
export const projectOf = (data) => {
  if (!data || typeof data !== 'object') return null;
  const s = data.social_media ?? {};
  const reach = Object.fromEntries([['x', s.X ?? s.twitter], ['linkedin', s.linkedin], ['discord', s.discord], ['telegram', s.telegram], ['site', s.website], ['medium', s.medium]].map(([k, v]) => [k, link(v)]).filter(([, v]) => v));
  const team = (Array.isArray(data.team_members) ? data.team_members : []).map((m) => ({
    name: sourceText(m?.name ?? m?.people_name, 120), role: sourceText(m?.position ?? m?.title ?? m?.role, 120) || 'role not stated',
    x: link(m?.X ?? m?.twitter), linkedin: link(m?.linkedin), peopleId: Number.isInteger(Number(m?.people_id ?? m?.id)) ? Number(m.people_id ?? m.id) : null,
  })).filter((m) => m.name).slice(0, 20);
  return {
    id: Number(data.project_id) || null, name: sourceText(data.project_name, 120), oneLiner: sourceText(data.one_liner, 200), about: sourceText(data.description, 600),
    founded: sourceText(data.establishment_date, 12) || null, tags: (Array.isArray(data.tags) ? data.tags : []).map((t) => sourceText(t, 40)).filter(Boolean).slice(0, 12),
    ecosystems: (Array.isArray(data.ecosystem) ? data.ecosystem : []).map((e) => sourceText(typeof e === 'string' ? e : e?.ecosystem_name ?? e?.name, 60)).filter(Boolean).slice(0, 20),
    investors: (Array.isArray(data.investors) ? data.investors : []).map((i) => sourceText(i?.name, 80)).filter(Boolean).slice(0, 20),
    reach, team, url: link(data.rootdataurl),
  };
};

/** impure — the plan and the credits left. Free. @returns {Promise<?{plan: string, used: number, available: number}>} */
export const rootdataAccount = async ({ apiKey, signal }) => {
  try {
    const d = await ask('/open/quotacredits', {}, { apiKey, signal });
    const total = num(d?.total_credits);
    return { plan: sourceText(d?.level, 20) || 'unknown', available: total, used: Math.max(0, total - num(d?.credits)) };
  } catch { return null; }
};

/**
 * impure — what RootData holds for one company, found by its name and held only on an exact match.
 * @returns {Promise<{ok: true, project: ?object, spent: number, why?: string} | {ok: false, detail: string}>}
 */
export const rootdataProject = ({ apiKey, name, domain, signal }) => answer(async () => {
  const found = projectMatching(projectsOfSearch(await ask('/open/ser_inv', { query: String(name || domain).slice(0, 80) }, { apiKey, signal })), { name, domain });
  if (!found) return { ok: true, project: null, spent: 0, why: `${NAME} lists no project named exactly "${name}"` };
  const project = projectOf(await ask('/open/get_item', { project_id: found.id, include_team: true, include_investors: true }, { apiKey, signal }));
  return { ok: true, project, spent: ROOTDATA_PROJECT_COST };
});

/** pure — one project in words, for the seat. */
export const rootdataWords = (p, plan = null) => [
  `${p.name}${p.oneLiner ? ` — ${p.oneLiner}` : ''}${p.founded ? ` (founded ${p.founded})` : ''}`,
  p.tags.length ? `Tags: ${p.tags.join(', ')}.` : null,
  p.ecosystems.length ? `Ecosystems: ${p.ecosystems.join(', ')}.` : null,
  p.investors.length ? `Backed by: ${p.investors.join(', ')}.` : null,
  Object.keys(p.reach).length ? `Reached at: ${Object.entries(p.reach).map(([k, v]) => `${k === 'x' ? 'X' : k} ${v}`).join(' · ')}.` : 'RootData lists no way to reach it.',
  p.team.length ? `Team: ${p.team.map((m) => `${m.name} (${m.role})${m.x ? ` X ${m.x}` : ''}${m.linkedin ? ` LinkedIn ${m.linkedin}` : ''}`).join('; ')}.`
    : `Team: none returned${plan && plan !== 'pro' ? ` — RootData gives team members on its Pro plan only, and this key is on ${plan}` : ''}.`,
  p.url ? `Source: ${p.url}` : null,
].filter(Boolean).join('\n');
