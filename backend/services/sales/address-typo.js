// A MISTYPED ADDRESS IS CAUGHT BEFORE IT IS KEPT — "dana@gmial.com", "otto@fundone.con". A list brought in from a file
// carries them, and each one is a bounce waiting to happen (a bounce costs the sending address its standing).
//
// Deliberately narrow, so a real company is never called a typo: only the handful of mailbox providers nearly
// everyone's private address is at, only one slip away from them (a letter missing, added, wrong, or two swapped),
// and never a domain that is itself a known mailbox provider (mail.com and email.com are real, one letter from
// gmail.com). Endings are read the same way: ".con" for ".com". What it says is a question — […] —
// for the person who holds the list to answer; nothing is corrected silently.
// PURE.

const BIG = Object.freeze(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'protonmail.com', 'googlemail.com']);
const REAL = new Set([...BIG, 'mail.com', 'email.com', 'ymail.com', 'gmx.com', 'gmx.net', 'gmx.de', 'live.com', 'msn.com', 'me.com', 'mac.com', 'aol.com',
  'proton.me', 'pm.me', 'zoho.com', 'fastmail.com', 'hey.com', 'qq.com', '163.com', '126.com', 'yandex.com', 'yandex.ru', 'mail.ru', 'web.de',
  'yahoo.co.uk', 'yahoo.co.jp', 'yahoo.fr', 'yahoo.de', 'hotmail.co.uk', 'hotmail.fr', 'hotmail.de', 'outlook.fr', 'outlook.de', 'live.co.uk']);
const ENDINGS = Object.freeze({ con: 'com', cmo: 'com', ocm: 'com', comm: 'com', coom: 'com', cm: 'com', vom: 'com', xom: 'com', nte: 'net', ner: 'net', ogr: 'org', orgg: 'org' });

// One slip apart: a letter missing, added or wrong, or two neighbours swapped.
const oneSlip = (a, b) => {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  return long.slice(i + 1) === short.slice(i);
};

/**
 * The address this one was most likely meant to be, or null when nothing says it is mistyped.
 * @param {unknown} email
 * @returns {?{meant: string, why: string}}
 */
export const typoOf = (email) => {
  const at = String(email ?? '').trim().toLowerCase();
  const cut = at.lastIndexOf('@');
  if (cut < 1 || cut === at.length - 1) return null;
  const [who, domain] = [at.slice(0, cut), at.slice(cut + 1)];
  if (REAL.has(domain)) return null;
  const big = BIG.find((d) => oneSlip(domain, d));
  if (big) return { meant: `${who}@${big}`, why: `${domain} is one letter from ${big}` };
  const dot = domain.lastIndexOf('.');
  const fixed = dot > 0 ? ENDINGS[domain.slice(dot + 1)] : null;
  return fixed ? { meant: `${who}@${domain.slice(0, dot)}.${fixed}`, why: `no address ends in .${domain.slice(dot + 1)}` } : null;
};
