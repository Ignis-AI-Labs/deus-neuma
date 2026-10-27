/**
 * A LOCAL STAND-IN FOR TIKTOK'S OPEN API: one real HTTP server on 127.0.0.1
 * that answers in the shapes TikTok documents (developers.tiktok.com, read
 * 2026-10-23) for the calls the TikTok channel makes:
 *   POST /v2/oauth/token/                         code exchange + refresh grant (a code
 *                                                 `second:…` signs in a second person)
 *   GET  /v2/user/info/                           the account: only the fields asked
 *                                                 for, each refused unless its scope
 *                                                 was granted (scope_not_authorized)
 *   POST /v2/video/list/                          the recent videos (video.list)
 *   POST /v2/video/query/                         chosen videos by id, with their counts
 *                                                 (video.list; a `queryCode` other than ok
 *                                                 answers 429 with `queryRetryAfter`)
 *   GET  /cdn/<name>                              pictures, as TikTok's CDN would
 *                                                 serve them (and ways it must not)
 *   POST /v2/post/publish/creator_info/query/     what the account allows
 *   POST /v2/post/publish/video/init/             Direct Post (FILE_UPLOAD)
 *   POST /v2/post/publish/inbox/video/init/       upload to drafts
 *   PUT  /upload/<id>                             the chunk PUTs (206 / 201)
 *   POST /v2/post/publish/status/fetch/           a publish's status
 * It enforces the media transfer guide's chunk rules (declared chunk size,
 * in order, the last chunk carrying the trailing bytes) and can misbehave
 * the way a real upload does: drop the connection mid-chunk, keep a chunk
 * and then drop before answering, or answer 503. It is NOT TikTok: whether
 * TikTok accepts this app, these scopes, this redirect and these posts is
 * proven only by scripts/tiktok-post-verify.mjs with the operator's own
 * connected app.
 */
import http from 'http';
import crypto from 'crypto';

const readBody = async (req) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
};

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

const ok = (res, data) => json(res, 200, { data, error: { code: 'ok', message: '', log_id: 'log-1' } });
const refuse = (res, status, code, headers = {}) => json(res, status, { data: {}, error: { code, message: code, log_id: 'log-2' } }, headers);

// The scope that opens each user field (Get User Info reference).
const FIELD_SCOPE = Object.freeze({
  open_id: 'user.info.basic', union_id: 'user.info.basic', display_name: 'user.info.basic', avatar_url: 'user.info.basic',
  username: 'user.info.profile', bio_description: 'user.info.profile', is_verified: 'user.info.profile',
  profile_deep_link: 'user.info.profile', profile_web_link: 'user.info.profile',
  follower_count: 'user.info.stats', following_count: 'user.info.stats', likes_count: 'user.info.stats', video_count: 'user.info.stats',
});

const standInUser = (root) => ({
  open_id: 'open-1', union_id: 'union-1', display_name: 'Deus Neuma', avatar_url: `${root}/cdn/avatar.jpg`,
  username: 'deusneuma', bio_description: 'Sovereign relationships with AI.', is_verified: true,
  profile_deep_link: 'https://vm.tiktok.com/ZMstandin/', profile_web_link: 'https://www.tiktok.com/@deusneuma',
  follower_count: 12345, following_count: 12, likes_count: 1500000, video_count: 3,
});

// Three videos, newest first; the first id is written raw as a 19-digit
// int64, past what a JS number holds, to prove the platform keeps it exact.
const STAND_IN_VIDEOS = Object.freeze([
  { id: '7300000000000000003', raw: true, title: 'Forge night', video_description: 'Forge night — the armillary #aiart', create_time: 1761200000, cover: 'cover-3.webp', share_url: 'https://www.tiktok.com/@deusneuma/video/7300000000000000003', duration: 15, view_count: 2000, like_count: 150, comment_count: 12, share_count: 3 },
  { id: '7300000000000000002', title: '', video_description: 'Second light', create_time: 1761100000, cover: 'cover-2.jpg', share_url: 'https://www.tiktok.com/@deusneuma/video/7300000000000000002', duration: 75, view_count: 500, like_count: 40, comment_count: 0, share_count: 1 },
  { id: '7300000000000000001', title: 'First', video_description: 'First', create_time: 1761000000, cover: 'cover-1.jpg', share_url: 'https://www.tiktok.com/@deusneuma/video/7300000000000000001', duration: 8, view_count: 0, like_count: 0, comment_count: 0, share_count: 0 },
]);

/** The bytes the stand-in's CDN serves for each picture. */
export const CDN_PICTURES = Object.freeze({
  'avatar.jpg': Object.freeze({ type: 'image/jpeg', bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]) }),
  'cover-1.jpg': Object.freeze({ type: 'image/jpeg', bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 0xff, 0xd9]) }),
  'cover-2.jpg': Object.freeze({ type: 'image/jpeg', bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 8, 0xff, 0xd9]) }),
  'cover-3.webp': Object.freeze({ type: 'image/webp', bytes: Buffer.from('RIFF\x10\0\0\0WEBPVP8 ', 'latin1') }),
  'evil.svg': Object.freeze({ type: 'image/svg+xml', bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>') }),
  'page.html': Object.freeze({ type: 'text/html', bytes: Buffer.from('<html>not a picture</html>') }),
});

/**
 * Stand the server. impure — a real listener on an ephemeral port.
 * @returns {Promise<{root: string, state: object, reset: () => void, close: () => Promise<void>}>}
 */
export const startTikTokStandIn = async () => {
  const state = {};
  const reset = () => Object.assign(state, {
    hits: [],
    tokenMode: 'ok', // 'ok' | 'no-publish-scope' | 'revoked'
    // What the person allowed on TikTok's page; every token answer names it.
    grantedScope: 'user.info.basic,user.info.profile,user.info.stats,video.list,video.publish,video.upload',
    videos: STAND_IN_VIDEOS,
    videoCode: 'ok',
    queryCode: 'ok',
    queryRetryAfter: null,
    refreshCount: 0,
    creator: {
      creator_username: 'deusneuma', creator_nickname: 'Deus Neuma',
      privacy_level_options: ['SELF_ONLY', 'FOLLOWER_OF_CREATOR', 'PUBLIC_TO_EVERYONE'],
      comment_disabled: false, duet_disabled: false, stitch_disabled: true, max_video_post_duration_sec: 600,
    },
    creatorCode: 'ok',
    initCode: 'ok',
    faults: {}, // chunk index → 'drop' | 'keep-then-drop' | '503'
    processingReads: 1, // status reads that answer PROCESSING_UPLOAD after the bytes land
    uploads: new Map(), // upload id → session
    publishes: new Map(), // publish id → { mode, done, reads, postInfo }
  });
  reset();

  const onToken = async (req, res) => {
    const form = Object.fromEntries(new URLSearchParams((await readBody(req)).toString('utf8')));
    state.hits.push({ leg: 'token', contentType: req.headers['content-type'], form });
    if (form.grant_type === 'refresh_token') {
      if (state.tokenMode === 'revoked') return json(res, 400, { error: 'invalid_grant', error_description: 'Refresh token is invalid or expired.', log_id: 'l' });
      state.refreshCount += 1;
      return json(res, 200, {
        access_token: `access-r${state.refreshCount}`, refresh_token: `refresh-r${state.refreshCount}`,
        expires_in: 86400, refresh_expires_in: 31536000, open_id: 'open-1', scope: state.grantedScope, token_type: 'Bearer',
      });
    }
    // A code minted `second:…` is a second person signing in (a house's
    // second TikTok account): their own token pair and their own open_id.
    if (String(form.code || '').startsWith('second:')) {
      return json(res, 200, {
        access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 86400, refresh_expires_in: 31536000, open_id: 'open-2',
        scope: state.grantedScope, token_type: 'Bearer',
      });
    }
    return json(res, 200, {
      access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 86400, refresh_expires_in: 31536000, open_id: 'open-1',
      scope: state.tokenMode === 'no-publish-scope' ? 'user.info.basic,video.upload' : state.grantedScope,
      token_type: 'Bearer',
    });
  };

  const granted = () => new Set(state.grantedScope.split(','));

  const onUser = (req, res, url, root) => {
    const fields = String(url.searchParams.get('fields') || '').split(',').filter(Boolean);
    state.hits.push({ leg: 'user', auth: req.headers.authorization, fields: fields.join(',') });
    if (fields.some((f) => !granted().has(FIELD_SCOPE[f]))) return refuse(res, 401, 'scope_not_authorized');
    const full = req.headers.authorization === 'Bearer access-2'
      ? { ...standInUser(root), open_id: 'open-2', union_id: 'union-2', display_name: 'Second Light', username: 'secondlight' }
      : standInUser(root);
    return ok(res, { user: Object.fromEntries(fields.filter((f) => f in full).map((f) => [f, full[f]])) });
  };

  const onVideos = async (req, res, url, root) => {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const fields = String(url.searchParams.get('fields') || '').split(',').filter(Boolean);
    state.hits.push({ leg: 'videos', auth: req.headers.authorization, fields: fields.join(','), body });
    if (!granted().has('video.list')) return refuse(res, 401, 'scope_not_authorized');
    if (state.videoCode !== 'ok') return refuse(res, 429, state.videoCode);
    if (!(body.max_count >= 1 && body.max_count <= 20)) return refuse(res, 400, 'invalid_params');
    const page = state.videos.slice(0, body.max_count).map((v) => {
      const full = { ...v, cover_image_url: `${root}/cdn/${v.cover}` };
      return Object.fromEntries(fields.filter((f) => f in full).map((f) => [f, full[f]]));
    });
    // Written by hand so a raw-marked id leaves as a bare int64, as TikTok's would.
    const videos = page.map((v, i) => (state.videos[i].raw && v.id ? JSON.stringify(v).replace(`"id":"${v.id}"`, `"id":${v.id}`) : JSON.stringify(v)));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(`{"data":{"videos":[${videos.join(',')}],"cursor":1761000000000,"has_more":${state.videos.length > body.max_count}},"error":{"code":"ok","message":"","log_id":"l"}}`);
  };

  // The stats read: up to 20 of the account's own videos by id, only the fields asked for.
  const onQuery = async (req, res, url) => {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const fields = String(url.searchParams.get('fields') || '').split(',').filter(Boolean);
    const ids = body?.filters?.video_ids || [];
    state.hits.push({ leg: 'query', auth: req.headers.authorization, fields: fields.join(','), ids });
    if (!granted().has('video.list')) return refuse(res, 401, 'scope_not_authorized');
    if (state.queryCode !== 'ok') return refuse(res, 429, state.queryCode, state.queryRetryAfter ? { 'Retry-After': String(state.queryRetryAfter) } : {});
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 20) return refuse(res, 400, 'invalid_params');
    const videos = state.videos.filter((v) => ids.includes(v.id)).map((v) => Object.fromEntries(fields.filter((f) => f in v).map((f) => [f, v[f]])));
    return ok(res, { videos });
  };

  const onCdn = (req, res, url, root) => {
    const name = url.pathname.slice('/cdn/'.length);
    state.hits.push({ leg: 'cdn', name, cookie: req.headers.cookie || null, authorization: req.headers.authorization || null, referer: req.headers.referer || null });
    if (name === 'moved') { res.writeHead(302, { Location: `${root}/cdn/avatar.jpg` }); return res.end(); }
    if (name === 'away') { res.writeHead(302, { Location: 'https://example.com/x.jpg' }); return res.end(); }
    if (name === 'big.jpg') {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' }); // no length declared: the cap must count
      const chunk = Buffer.alloc(256 * 1024, 7);
      for (let i = 0; i < 20; i += 1) res.write(chunk);
      return res.end();
    }
    const pic = CDN_PICTURES[name];
    if (!pic) return json(res, 404, {});
    res.writeHead(200, { 'Content-Type': pic.type, 'Content-Length': pic.bytes.length });
    return res.end(pic.bytes);
  };

  const onInit = async (req, res, mode, root) => {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    state.hits.push({ leg: 'init', mode, auth: req.headers.authorization, contentType: req.headers['content-type'], body });
    if (state.initCode !== 'ok') return refuse(res, 403, state.initCode);
    const src = body.source_info || {};
    const expect = Math.floor(src.video_size / src.chunk_size);
    if (src.source !== 'FILE_UPLOAD' || src.total_chunk_count !== expect || src.total_chunk_count < 1) return refuse(res, 400, 'invalid_param');
    const id = crypto.randomBytes(6).toString('hex');
    const publishId = `v_pub_file~v2-1.${id}`;
    state.uploads.set(id, { publishId, total: src.video_size, chunkSize: src.chunk_size, count: src.total_chunk_count, held: 0, index: 0, parts: [] });
    state.publishes.set(publishId, { mode, done: false, reads: 0, postInfo: body.post_info || null });
    return ok(res, { publish_id: publishId, upload_url: `${root}/upload/${id}` });
  };

  const onChunk = async (req, res, upload) => {
    const range = String(req.headers['content-range'] || '');
    const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
    const fault = state.faults[upload.index];
    if (fault === 'drop') {
      delete state.faults[upload.index];
      state.hits.push({ leg: 'chunk', range, fault });
      req.once('data', () => req.socket.destroy());
      return;
    }
    const body = await readBody(req);
    state.hits.push({ leg: 'chunk', range, contentType: req.headers['content-type'], bytes: body.length, fault: fault || null });
    const heldHeader = upload.held ? { 'Content-Range': `bytes 0-${upload.held - 1}/${upload.total}` } : {};
    if (!m || Number(m[3]) !== upload.total) return json(res, 400, {}, heldHeader);
    if (Number(m[1]) !== upload.held) return json(res, 416, {}, heldHeader);
    const last = upload.index === upload.count - 1;
    const want = last ? upload.total - upload.held : upload.chunkSize;
    if (body.length !== want || Number(m[2]) - Number(m[1]) + 1 !== want) return json(res, 400, {}, heldHeader);
    if (fault === '503') { delete state.faults[upload.index]; return json(res, 503, {}); }
    upload.parts.push(body);
    upload.held += body.length;
    upload.index += 1;
    if (fault === 'keep-then-drop') { delete state.faults[upload.index - 1]; req.socket.destroy(); return; }
    const held = { 'Content-Range': `bytes 0-${upload.held - 1}/${upload.total}` };
    if (upload.held === upload.total) {
      state.publishes.get(upload.publishId).done = true;
      res.writeHead(201, held); res.end(); return;
    }
    res.writeHead(206, held); res.end();
  };

  const onStatus = async (req, res) => {
    const { publish_id: publishId } = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    state.hits.push({ leg: 'status', publishId });
    const p = state.publishes.get(publishId);
    if (!p) return refuse(res, 400, 'invalid_publish_id');
    if (!p.done || p.reads < state.processingReads) { if (p.done) p.reads += 1; return ok(res, { status: 'PROCESSING_UPLOAD', uploaded_bytes: 0 }); }
    if (p.mode === 'drafts') return ok(res, { status: 'SEND_TO_USER_INBOX' });
    // Private posts carry no public id (TikTok returns one only for public,
    // moderated posts); a public one is a 19-digit int64, written raw.
    if (p.postInfo?.privacy_level !== 'PUBLIC_TO_EVERYONE') return ok(res, { status: 'PUBLISH_COMPLETE' });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{"data":{"status":"PUBLISH_COMPLETE","publicaly_available_post_id":[7300000000000000001]},"error":{"code":"ok","message":"","log_id":"l"}}');
  };

  let root;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://stand-in');
    if (url.pathname === '/v2/oauth/token/' && req.method === 'POST') return onToken(req, res);
    if (url.pathname === '/v2/user/info/') return onUser(req, res, url, root);
    if (url.pathname === '/v2/video/list/' && req.method === 'POST') return onVideos(req, res, url, root);
    if (url.pathname === '/v2/video/query/' && req.method === 'POST') return onQuery(req, res, url);
    if (url.pathname.startsWith('/cdn/')) return onCdn(req, res, url, root);
    if (url.pathname === '/v2/post/publish/creator_info/query/') {
      await readBody(req);
      state.hits.push({ leg: 'creator', auth: req.headers.authorization });
      // TikTok answers creator-info refusals with HTTP 200 and an error code.
      return state.creatorCode === 'ok' ? ok(res, state.creator) : refuse(res, 200, state.creatorCode);
    }
    if (url.pathname === '/v2/post/publish/video/init/') return onInit(req, res, 'post', root);
    if (url.pathname === '/v2/post/publish/inbox/video/init/') return onInit(req, res, 'drafts', root);
    if (url.pathname.startsWith('/upload/') && req.method === 'PUT') {
      const upload = state.uploads.get(url.pathname.slice('/upload/'.length));
      if (!upload) return json(res, 404, {});
      return onChunk(req, res, upload);
    }
    if (url.pathname === '/v2/post/publish/status/fetch/') return onStatus(req, res);
    return json(res, 404, { error: { code: 'not_found' } });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  root = `http://127.0.0.1:${server.address().port}`;
  return { root, state, reset, close: () => new Promise((resolve) => server.close(resolve)) };
};

/**
 * The bytes the stand-in assembled for its (only) upload. Pure over state.
 * @param {object} state
 */
export const assembledUpload = (state) => Buffer.concat([...state.uploads.values()][0].parts);

/**
 * A real MP4-shaped file body: an `ftyp` box, a `moov` holding an `mvhd` of
 * the given length, and an `mdat` of random bytes up to `total`. Pure but
 * for entropy.
 * @param {number} seconds
 * @param {number} total
 */
export const mp4Bytes = (seconds, total) => {
  const ftyp = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom\0\0\0\0isommp41', 'latin1')]);
  const mvhdPayload = Buffer.alloc(100);
  mvhdPayload.writeUInt32BE(1000, 12);
  mvhdPayload.writeUInt32BE(Math.round(seconds * 1000), 16);
  const mvhd = Buffer.concat([Buffer.from([0, 0, 0, 108]), Buffer.from('mvhd', 'latin1'), mvhdPayload]);
  const moov = Buffer.concat([Buffer.from([0, 0, 0, 116]), Buffer.from('moov', 'latin1'), mvhd]);
  const head = Buffer.concat([ftyp, moov]);
  const mdatSize = total - head.length;
  const mdatHead = Buffer.alloc(8);
  mdatHead.writeUInt32BE(mdatSize, 0);
  mdatHead.write('mdat', 4, 'latin1');
  return Buffer.concat([head, mdatHead, crypto.randomBytes(mdatSize - 8)]);
};
