// THE NEVER-LIST'S SIGNS — how a company is seen to be in a place its house never writes to.
//
// WHICH places is not decided here: it is each house's own record, kept by its legal office for where its operator
// is and what law reaches them (legal/never-list.js; Design note, 2026-11-22: […]). This file only answers: given that list, does anything say this company is there?
//
// Until then every audience carried a list of ALLOWED countries, and a company whose site did not say where it is was
// held from email (the first sales bench: five of eleven crypto funds, none of whose pages names a country). The rule
// the operator actually holds is the other way round ([…]): a short list of places never written to. So a country that is simply not known holds nobody;
// what holds a company is a SIGN that it is in one of them — and the signs are looked for hard, because "not known"
// must not be where such a company hides:
//   its domain's ending, and the ending of the address we would write to (.il, .ir, .ru …)
//   a phone number on its pages with that country's code (+972, +98, +375 …)
//   a city of that country on its pages (Tel Aviv, Tehran, Moscow, Minsk …)
//   its own words placing it there ("based in Israel", […], an address line)
//   the country on its record, however it got there
// An audience's own list of countries still stands beside this: a company KNOWN to be outside it is not written to
// for that audience (where the operator focuses).
// PURE.

// A code that is not a country's: the regions of Ukraine under occupation, sanctioned as places of their own.
export const REGION_NAMES = Object.freeze({ XO: 'an occupied region of Ukraine (Crimea, Donetsk, Luhansk)' });
const regions = new Intl.DisplayNames(['en'], { type: 'region' });
/** pure — a code's name in plain words ("IL" → "Israel"), or the code when it names nothing. */
export const placeName = (code) => { const c = String(code ?? '').toUpperCase(); if (REGION_NAMES[c]) return REGION_NAMES[c]; try { return regions.of(c) ?? c; } catch { return c; } };

// Domain endings that are not the code itself, and the ones the world uses as generic names (they place nobody).
const ENDING_OF = Object.freeze({ uk: 'GB', su: 'RU' });
const GENERIC = new Set(['io', 'ai', 'co', 'me', 'tv', 'cc', 'gg', 'ly', 'so', 'to', 'fm', 'sh', 'ws', 'is', 'it', 'gl', 'im', 'la', 'vc', 'fi', 'ag', 'st', 'ac', 'am', 'id']);
// A city or a phone code: on a company's own pages these are where it sits (an office, a number to call).
// Kept for the places houses most often list; a place with no entry here is still seen by its ending, its record and its name.
const PLACES = Object.freeze({
  IL: /\b(Tel[- ]Aviv|Herzliya|Haifa|Jerusalem|Ramat[- ]Gan|Petah[- ]Tikva|Ra['’]?anana|Netanya|Be['’]?er[- ]Sheva|Rehovot|Kfar[- ]Saba)\b|\+972[\s\d(-]/i,
  IR: /\b(Tehran|Isfahan|Mashhad|Shiraz|Tabriz)\b|\+98[\s\d(-]/i,
  KP: /\bPyongyang\b|\+850[\s\d(-]/i,
  SY: /\b(Damascus|Aleppo|Latakia)\b|\+963[\s\d(-]/i,
  CU: /\b(Havana|La Habana)\b|\+53[\s(-]\d/i,
  RU: /\b(Moscow|Novosibirsk|Yekaterinburg|Kazan|Skolkovo|Nizhny Novgorod)\b/i,
  BY: /\bMinsk\b|\+375[\s\d(-]/i,
  XO: /\b(Crimea|Simferopol|Sevastopol|Donetsk|Luhansk|Lugansk)\b/i,
  VE: /\bCaracas\b|\+58[\s\d(-]/i,
  MM: /\b(Yangon|Naypyidaw|Mandalay)\b|\+95[\s\d(-]/i,
  AF: /\bKabul\b|\+93[\s\d(-]/i,
  SD: /\bKhartoum\b|\+249[\s\d(-]/i,
  CN: /\b(Beijing|Shanghai|Shenzhen|Guangzhou|Hangzhou)\b|\+86[\s\d(-]/i,
  GB: /\b(London|Manchester|Edinburgh|Birmingham)\b|\+44[\s\d(-]/i,
});
const PEOPLE = Object.freeze({ IL: 'Israeli', IR: 'Iranian', SY: 'Syrian', CU: 'Cuban', RU: 'Russian', BY: 'Belarusian', KP: 'North Korean', VE: 'Venezuelan', CN: 'Chinese', GB: 'British' });
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The country's own name counts only where the company PLACES ITSELF there: a bare mention (a portfolio company, a
// news line, a list of markets) says nothing about where it is.
const bare = (code) => esc(placeName(code).replace(/\s*\(.*\)$/, ''));
const placedIn = (code) => { const name = bare(code); return new RegExp(`\\b(?:based|headquartered|head office|located|registered|incorporated|founded|offices?|team)\\s+(?:is\\s+|are\\s+)?in\\s+[^.\\n]{0,40}\\b${name}\\b|\\b${name}[- ]based\\b${PEOPLE[code] ? `|\\b(?:we are|we're|is|as)\\s+an?\\s+${PEOPLE[code]}\\s+(?:venture|vc|fund|firm|company|startup|investment)\\b` : ''}`, 'i'); };
// An address line: short, with a number or a comma in it, ending in the country's name ([…]).
const addressLine = (code) => new RegExp(`^[^\\n]{0,90}[\\d,][^\\n]{0,60}\\b${bare(code)}\\b[^\\n]{0,12}$`, 'im');
const endingOf = (host) => { const tld = String(host ?? '').trim().toLowerCase().split('.').pop(); return !/^[a-z]{2}$/.test(tld) || GENERIC.has(tld) ? null : ENDING_OF[tld] ?? tld.toUpperCase(); };
const shown = (text, re) => { const m = re.exec(text); return m ? String(m[0]).replace(/\s+/g, ' ').trim().slice(0, 80) : null; };
const listOf = (codes) => new Set((Array.isArray(codes) ? codes : []).map((c) => String(c).toUpperCase()));

/**
 * pure — the sign that a company is in a place its house never writes to, or null when nothing points to one.
 * @param {{domain?: string, emails?: string[], text?: string, country?: ?string}} seen - emails: the addresses on its
 *   pages, or the one we would write to · text: the words of every page read · country: what its record says
 * @param {string[]} codes - the house's never-list (legal/never-list.js)
 * @returns {?{code: string, name: string, why: string}}
 */
export const neverSign = ({ domain = '', emails = [], text = '', country = null } = {}, codes = []) => {
  const never = listOf(codes);
  if (!never.size) return null;
  const said = (code, why) => ({ code, name: placeName(code), why });
  const on = String(country ?? '').toUpperCase();
  if (never.has(on)) return said(on, `it is on record in ${placeName(on)}`);
  const own = endingOf(domain);
  if (own && never.has(own)) return said(own, `its own domain ${domain} is ${placeName(own)}'s`);
  for (const email of emails) {
    const address = typeof email === 'string' ? email : email?.email ?? '';
    const at = endingOf(String(address).split('@')[1]);
    if (at && never.has(at)) return said(at, `the address ${address} is at a domain of ${placeName(at)}`);
  }
  const words = String(text ?? '');
  if (!words) return null;
  for (const code of never) {
    const hit = (PLACES[code] ? shown(words, PLACES[code]) : null) ?? (REGION_NAMES[code] ? null : shown(words, placedIn(code)) ?? shown(words, addressLine(code)));
    if (hit) return said(code, `its own pages place it in ${placeName(code)} ("${hit}")`);
  }
  return null;
};

/** pure — why nobody at this company is written to (its record, its domain, or the address itself), or null. */
export const neverRefusal = ({ prospect = null, email = null } = {}, codes = []) => {
  const sign = neverSign({ country: prospect?.country ?? null, domain: prospect?.domain ?? '', emails: email ? [email] : [] }, codes);
  return sign ? `${prospect?.name || prospect?.domain || email} is never written to: ${sign.why} — ${sign.name} is on this house's never-list, kept by its legal office, for every campaign` : null;
};
