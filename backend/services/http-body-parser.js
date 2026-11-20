import express from 'express';

const jsonDefault = express.json();
const underPath = (path, base) => path === base || path.startsWith(`${base}/`);

// These routers parse their own bodies, behind their own limits and gates.
// Signed hooks need the exact bytes: a parsed JSON object cannot be HMAC-verified.
export const selfParsedPath = (path) => underPath(path, '/api/v1/voice/forge')
  || underPath(path, '/api/v1/attachments')
  || underPath(path, '/api/v1/doc-press')
  || underPath(path, '/api/v1/hooks/in');

export const parseJsonBody = (req, res, next) => {
  if (selfParsedPath(req.path)) return next();
  return jsonDefault(req, res, next);
};
