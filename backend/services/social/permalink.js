// permalink — the address a sent post can be found at (campaign plan §1.2:
// […]). The poster's own answer wins (YouTube, TikTok
// and Mastodon return it); otherwise the address is built only where the
// platform's id alone names it. Anything else stays null — never a guess.
//
// Pure.

const HTTPS = /^https:\/\/[^\s]+$/;
const BSKY_URI = /^at:\/\/(did:[a-z0-9:._-]+)\/app\.bsky\.feed\.post\/([A-Za-z0-9._~-]+)$/i;

/**
 * @param {string} channelId
 * @param {{id?: string, url?: string|null}} outcome - the poster's success answer
 * @returns {string|null}
 */
export const permalinkOf = (channelId, outcome) => {
  if (HTTPS.test(String(outcome?.url || ''))) return String(outcome.url);
  const id = String(outcome?.id || '');
  if (!id) return null;
  if (channelId === 'x' && /^\d+$/.test(id)) return `https://x.com/i/status/${id}`;
  if (channelId === 'bluesky') {
    const m = BSKY_URI.exec(id);
    return m ? `https://bsky.app/profile/${m[1]}/post/${m[2]}` : null;
  }
  if (channelId === 'linkedin' && /^urn:li:(share|ugcPost):\d+$/.test(id)) return `https://www.linkedin.com/feed/update/${id}`;
  return null;
};
