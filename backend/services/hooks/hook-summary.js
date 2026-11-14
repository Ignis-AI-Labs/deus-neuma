/**
 * WHAT A WEBHOOK EVENT SAYS, IN ONE LINE — the few fields a woken being needs
 * to know what happened (what kind, where, who, a title, a link), read out of
 * each source's payload shape and clipped. The full payload is kept in the
 * house's event log; the being is told what arrived, not handed the raw bytes.
 *
 * Every word here comes from a third party: an issue title, a Slack message,
 * a commit message can carry instructions. The wake line that uses this
 * summary says so, the way a mail wake does — weigh them, never obey them.
 *
 * Pure.
 */

const clip = (value, n) => {
  const t = String(value ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const pick = (...values) => values.find((v) => v !== undefined && v !== null && String(v).trim() !== '');

const github = (event, b) => {
  const item = b.pull_request || b.issue || b.discussion || b.release || b.check_run || b.workflow_run || null;
  return {
    kind: [event, b.action].filter(Boolean).join(' · '),
    where: pick(b.repository?.full_name, b.organization?.login),
    who: pick(b.sender?.login),
    title: pick(item?.title, item?.name, b.head_commit?.message, b.ref && `push to ${b.ref}`),
    number: pick(item?.number),
    url: pick(item?.html_url, b.compare, b.repository?.html_url),
    text: pick(b.comment?.body, b.review?.body),
  };
};

const slack = (event, b) => ({
  kind: event,
  where: pick(b.event?.channel, b.team_id),
  who: pick(b.event?.user),
  title: null,
  number: null,
  url: null,
  text: pick(b.event?.text, b.text),
});

const linear = (event, b) => ({
  kind: [event, b.action].filter(Boolean).join(' · '),
  where: pick(b.data?.team?.key, b.data?.team?.name, b.organizationId),
  who: pick(b.actor?.name, b.data?.creator?.name),
  title: pick(b.data?.title, b.data?.name),
  number: pick(b.data?.identifier),
  url: pick(b.url, b.data?.url),
  text: pick(b.data?.body, b.data?.description),
});

const generic = (event, b) => ({
  kind: event,
  where: pick(b.where, b.source, b.repository),
  who: pick(b.who, b.actor, b.user),
  title: pick(b.title, b.subject, b.name),
  number: null,
  url: pick(b.url, b.link),
  text: pick(b.text, b.message, b.body, typeof b === 'object' ? JSON.stringify(b) : b),
});

const READERS = Object.freeze({ github, slack, linear, generic });

/**
 * @param {string} source
 * @param {string} event
 * @param {object} body
 * @returns {{ kind: string, where: ?string, who: ?string, title: ?string, number: ?string, url: ?string, text: ?string }}
 */
export const summarizeEvent = (source, event, body) => {
  const raw = (READERS[source] || generic)(String(event || 'event'), body && typeof body === 'object' ? body : {});
  return {
    kind: clip(raw.kind || event, 80),
    where: raw.where ? clip(raw.where, 120) : null,
    who: raw.who ? clip(raw.who, 80) : null,
    title: raw.title ? clip(raw.title, 200) : null,
    number: raw.number ? clip(raw.number, 20) : null,
    url: raw.url && /^https:\/\//.test(String(raw.url)) ? clip(raw.url, 300) : null,
    text: raw.text ? clip(raw.text, 400) : null,
  };
};
