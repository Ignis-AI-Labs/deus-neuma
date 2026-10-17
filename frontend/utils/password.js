// Cryptographically strong password for the keypair-custody path — shown once,
// the operator must save it. One home: the birth ceremony and the desk's
// BirthSetupGate drive the SAME custody act, so they share one generator.

/**
 * Generate a cryptographically strong URL-safe password (24 random bytes,
 * base64url-encoded — 32 characters, 192 bits of entropy).
 * @returns {string}
 */
export const generatePassword = () => {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
