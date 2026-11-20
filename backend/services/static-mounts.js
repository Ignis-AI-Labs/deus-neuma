import express from 'express';
import path from 'node:path';

const ATTACH = new Set(['.html', '.htm', '.xhtml', '.xml', '.svg']);
const frontendHeaders = (res, file) => {
  const extension = path.extname(file).toLowerCase();
  if (extension === '.js') res.setHeader('Content-Type', 'application/javascript');
  if (ATTACH.has(extension)) res.setHeader('Content-Disposition', 'attachment');
};

// impure — the backend's source-module and operator-avatar mounts.
export const mountContentStatic = (app, { frontendRoot, modelPath }) => {
  app.use('/frontend', express.static(frontendRoot, { setHeaders: frontendHeaders }));
  app.use('/frontend/components', express.static(path.join(frontendRoot, 'components'), { setHeaders: frontendHeaders }));
  app.use('/model', (req, res, next) => {
    if (path.extname(req.path).toLowerCase() !== '.vrm') return res.status(404).end();
    return next();
  });
  app.use('/model', express.static(modelPath, {
    setHeaders: (res) => {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Access-Control-Allow-Origin', '*');
    },
  }));
};
