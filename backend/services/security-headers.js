import { securityTrafficMiddleware } from './security/traffic-monitor.js';

// Global HTTP security middleware: response headers plus the bounded traffic
// instrument and emergency application-firewall gate.
//
// connect-src carries 'blob:' deliberately: three.js's ImageBitmapLoader
// loads vessel textures via fetch(blobUrl) (not <img>), so without it every
// VRM renders as an untextured silhouette wherever the backend serves the
// frontend — the packaged Electron app foremost. blob: URLs can only be
// minted by same-origin script from data it already holds, so this widens
// nothing an attacker could not already reach.

export const CSP_DIRECTIVES = Object.freeze([
  "default-src 'self'",
  // Exact pre-paint LOOK bytes; first-paint-csp.test.js checks source/build drift.
  "script-src 'self' 'sha256-RzeVUbS0fgG9s3jm88xkUSbrQCGeFH4IzH5Vz4eyG9Y='",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self' blob:",
  "media-src 'self' blob:",
  "object-src 'none'",
  "frame-src 'none'",
]);

// impure (writes response headers)
export const securityHeaders = (req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP_DIRECTIVES.join('; '));
  // HSTS — force HTTPS for 1 year, include subdomains, preload eligible
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Control referrer leakage
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Deny iframe embedding (clickjacking defense)
  res.setHeader('X-Frame-Options', 'DENY');
  // Disable legacy XSS auditor (CSP is the modern defense)
  res.setHeader('X-XSS-Protection', '0');
  // Restrict powerful browser APIs — the mic stays self-only: hold-to-talk
  // dictation records in the composer, so a blanket deny would break it when
  // the backend serves the built frontend (production).
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(self), camera=(), payment=()');
  return securityTrafficMiddleware(req, res, next);
};
