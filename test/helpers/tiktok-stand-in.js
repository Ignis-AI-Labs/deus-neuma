/**
 * A LOCAL STAND-IN FOR TIKTOK'S OPEN API: one real HTTP server on 127.0.0.1
 * that answers in the shapes TikTok documents (developers.tiktok.com, read
 * 2026-10-23) for the calls the TikTok channel makes:
 *   POST /v2/oauth/token/                         code exchange + refresh grant
 *   GET  /v2/user/info/                           the account (user.info.basic)
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
const refuse = (res, status, code) => json(res, status, { data: {}, error: { code, message: code, log_id: 'log-2' } });

/**
 * Stand the server. impure — a real listener on an ephemeral port.
 * @returns {Promise<{root: string, state: object, reset: () => void, close: () => Promise<void>}>}
 */
export const startTikTokStandIn = async () => {
  const state = {};
  const reset = () => Object.assign(state, {
    hits: [],
    tokenMode: 'ok', // 'ok' | 'no-publish-scope' | 'revoked'
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
        expires_in: 86400, refresh_expires_in: 31536000, open_id: 'open-1', scope: 'user.info.basic,video.publish,video.upload', token_type: 'Bearer',
      });
    }
    return json(res, 200, {
      access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 86400, refresh_expires_in: 31536000, open_id: 'open-1',
      scope: state.tokenMode === 'no-publish-scope' ? 'user.info.basic,video.upload' : 'user.info.basic,video.publish,video.upload',
      token_type: 'Bearer',
    });
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
    if (url.pathname === '/v2/user/info/') {
      state.hits.push({ leg: 'user', auth: req.headers.authorization, fields: url.searchParams.get('fields') });
      return ok(res, { user: { open_id: 'open-1', display_name: 'Deus Neuma' } });
    }
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
