/**
 * A LOCAL STAND-IN FOR THE SITE COUNTER (deus-neuma-site, src/worker/go-*.ts,
 * README § The site counter): one real HTTP server on 127.0.0.1 answering in
 * the Worker's own shapes:
 *   POST /go-codes   {"codes":[{code,destination,company,createdAt}]} with the
 *                    site token → {"codes":[{code,state: published|already|conflict}]};
 *                    any other field on an entry is refused (400), as the Worker does
 *   GET  /go-counts?codes=a,b → {"counts":[{code,kind,day,count}]} with the site token
 *   GET  /go/<code>  302 to the destination (our own site gets ?src=<code>) and
 *                    +1 click for today; an unknown code is a 404
 *   GET  /updates/<installer>?src=<code>  +1 download for today
 * Without the token the token routes answer 401. It is NOT the site: whether the
 * real Worker takes these codes is proven by scripts/site-counter-verify.mjs.
 */
import http from 'http';

const SITE_HOSTS = new Set(['deusneuma.ai', 'www.deusneuma.ai']);
const ENTRY_KEYS = new Set(['code', 'destination', 'company', 'createdAt']);

const readBody = async (req) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
};
const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

/**
 * @param {{token: string}} opts
 * @returns {Promise<{root: string, codes: Map<string, object>, counts: Map<string, number>, hits: string[],
 *   count: (kind: string, code: string, day: string, n: number) => void, close: () => Promise<void>}>}
 */
export const startSiteCounterStandIn = async ({ token }) => {
  const codes = new Map();
  const counts = new Map(); // `${kind}|${code}|${day}` → n
  const hits = [];
  const today = () => new Date().toISOString().slice(0, 10);
  const bump = (kind, code, day = today(), n = 1) => counts.set(`${kind}|${code}|${day}`, (counts.get(`${kind}|${code}|${day}`) || 0) + n);
  const authed = (req) => req.headers.authorization === `Bearer ${token}`;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://counter');
    hits.push(`${req.method} ${url.pathname}`);
    if (url.pathname === '/go-codes' || url.pathname === '/go-counts') {
      if (!authed(req)) return json(res, 401, { error: 'a valid Authorization: Bearer <site token> is required' });
    }
    if (req.method === 'POST' && url.pathname === '/go-codes') {
      const body = JSON.parse(await readBody(req) || '{}');
      const list = Array.isArray(body.codes) ? body.codes : [];
      const bad = list.find((e) => Object.keys(e).some((k) => !ENTRY_KEYS.has(k)) || !/^[0-9a-z]{4,16}$/.test(e.code) || !/^https:\/\//.test(e.destination));
      if (!list.length || bad) return json(res, 400, { error: 'codes[0]: an entry carries only code, destination, company, createdAt' });
      return json(res, 200, {
        codes: list.map((e) => {
          const prior = codes.get(e.code);
          if (!prior) { codes.set(e.code, e); return { code: e.code, state: 'published' }; }
          return { code: e.code, state: prior.destination === e.destination && prior.company === e.company ? 'already' : 'conflict' };
        }),
      });
    }
    if (req.method === 'GET' && url.pathname === '/go-counts') {
      const asked = new Set((url.searchParams.get('codes') || '').split(',').filter(Boolean));
      const out = [...counts.entries()].map(([k, count]) => { const [kind, code, day] = k.split('|'); return { code, kind, day, count }; })
        .filter((r) => asked.has(r.code));
      return json(res, 200, { counts: out });
    }
    const go = /^\/go\/([0-9a-z]{4,16})\/?$/.exec(url.pathname);
    if (req.method === 'GET' && go) {
      const entry = codes.get(go[1]);
      if (!entry) return json(res, 404, { error: 'not found' });
      const target = new URL(entry.destination);
      if (SITE_HOSTS.has(target.hostname)) target.searchParams.set('src', go[1]);
      bump('click', go[1]);
      res.writeHead(302, { Location: target.toString() });
      return res.end();
    }
    if (req.method === 'GET' && url.pathname.startsWith('/updates/')) {
      const src = url.searchParams.get('src');
      if (src && codes.has(src)) bump('download', src);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      return res.end('installer');
    }
    return json(res, 404, { error: 'not found' });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    root: `http://127.0.0.1:${server.address().port}`,
    codes, counts, hits, count: bump,
    close: () => new Promise((r) => server.close(r)),
  };
};
