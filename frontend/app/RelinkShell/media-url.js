// Persisted media is data, not a navigation instruction.

export const safeMediaUrl = (value) => {
  if (typeof value !== 'string') return null;
  const src = value.trim();
  if (!src || src.length > 8_000_000 || src.startsWith('//')) return null;
  for (let i = 0; i < src.length; i += 1) {
    const code = src.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return null;
  }
  if (src.startsWith('/')) return src;
  if (/^data:/i.test(src)) return /^data:(?:image\/(?:png|jpe?g|gif|webp)|video\/(?:mp4|webm)|audio\/(?:mpeg|wav|ogg))[,;]/i.test(src) ? src : null;
  try {
    const url = new URL(src);
    return ['https:', 'http:', 'blob:'].includes(url.protocol) ? src : null;
  } catch {
    return null;
  }
};
