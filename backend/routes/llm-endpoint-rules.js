const ALLOWED_ENDPOINT_PATTERNS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https?:\/\/\[::1\](:\d+)?$/,
  /^https?:\/\/api\.openai\.com$/,
  /^https?:\/\/api\.anthropic\.com$/,
  /^https?:\/\/generativelanguage\.googleapis\.com$/,
];

const isPrivateIP = (ip) =>
  ip.startsWith('169.254.') || ip.startsWith('10.') ||
  ip.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
  ip === '127.0.0.1' || ip === '::1' || ip === '0.0.0.0';

/** The endpoint test route's SSRF allowlist, including DNS-rebinding checks. impure (DNS). */
export const isAllowedEndpoint = async (endpoint) => {
  if (!endpoint) return false;
  try {
    const url = new URL(endpoint);
    const host = url.hostname;
    if (isPrivateIP(host)) {
      const base = `${url.protocol}//${url.host}`;
      return ALLOWED_ENDPOINT_PATTERNS.some((pattern) => pattern.test(base));
    }
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(host) && host !== 'localhost') {
      const { promises: dns } = await import('dns');
      try {
        const addresses = await dns.resolve4(host);
        if (addresses.some((ip) => isPrivateIP(ip))) return false;
      } catch { /* the fixed-host allowlist below remains authoritative */ }
    }
    const base = `${url.protocol}//${url.host}`;
    return ALLOWED_ENDPOINT_PATTERNS.some((pattern) => pattern.test(base));
  } catch {
    return false;
  }
};
