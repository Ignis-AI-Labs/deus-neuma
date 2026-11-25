// Publisher-side feed freshness inputs. The signature covers these fields with the rest of the feed.
import yaml from 'js-yaml';

const isoTime = (value) => {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.getTime();
  const text = String(value ?? '');
  const time = Date.parse(text);
  return Number.isFinite(time) && new Date(time).toISOString() === text ? time : null;
};

/** Add the issuance time and rollback floor to a feed before it is signed. Pure. */
export const prepareFeedForSigning = (text, now) => {
  const doc = yaml.load(String(text));
  const version = String(doc?.version ?? '');
  if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) throw new Error('the feed names no valid version');
  const at = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(at.getTime())) throw new Error('the signing time is not valid');
  return yaml.dump({ ...doc, signedAt: at.toISOString(), minimumVersion: version }, { lineWidth: -1 });
};

/** Problems with the freshness inputs in a signed feed; an empty list means they hold. Pure. */
export const feedPolicyProblems = (text, now) => {
  let doc;
  try { doc = yaml.load(String(text)); } catch (error) { return [`the feed is not readable YAML: ${error.message}`]; }
  const problems = [];
  const signedAt = isoTime(doc?.signedAt);
  if (signedAt === null) problems.push('signedAt is missing or is not an exact ISO timestamp');
  else if (signedAt > Number(now)) problems.push('signedAt is in the future');
  const releaseDate = doc?.releaseDate ? Date.parse(String(doc.releaseDate)) : null;
  if (signedAt !== null && releaseDate !== null && signedAt < releaseDate) problems.push('signedAt is before the feed releaseDate');
  if (String(doc?.minimumVersion ?? '') !== String(doc?.version ?? '')) problems.push('minimumVersion does not equal the feed version');
  return problems;
};
