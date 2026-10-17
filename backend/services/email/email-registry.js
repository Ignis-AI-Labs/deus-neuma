// email-registry.js — the one email account a box carries, declared in the
// same shape as the social channel catalog so the credential resolver and
// mask functions in channel-registry are reused verbatim (they are generic
// over {id, name, fields}).
//
// Gmail works out of the box with just address + username + password (the
// host/port fields fall back to Gmail's servers); any provider or own domain
// works by overriding the hosts — the seed of the future own-email layer.

const field = (key, label, secret, env, fallback) =>
  Object.freeze({ key, label, secret, env, ...(fallback !== undefined ? { fallback } : {}) });

/** @type {import('../social/channel-registry.js').ChannelEntry} */
export const EMAIL_ACCOUNT = Object.freeze({
  id: 'email',
  name: 'Email',
  maxChars: 50000,
  fields: Object.freeze([
    field('address', 'Email Address', false, 'EMAIL_ADDRESS'),
    field('username', 'Login Username', false, 'EMAIL_USERNAME'),
    field('password', 'Password / App Password', true, 'EMAIL_PASSWORD'),
    field('smtpHost', 'SMTP Host', false, 'EMAIL_SMTP_HOST', 'smtp.gmail.com'),
    field('smtpPort', 'SMTP Port (TLS)', false, 'EMAIL_SMTP_PORT', '465'),
    field('imapHost', 'IMAP Host', false, 'EMAIL_IMAP_HOST', 'imap.gmail.com'),
    field('imapPort', 'IMAP Port (TLS)', false, 'EMAIL_IMAP_PORT', '993'),
  ]),
});

/**
 * The account entry when the id names it, else null (pure) — the same
 * contract getChannel gives the social layer.
 * @param {string} id
 * @returns {typeof EMAIL_ACCOUNT|null}
 */
export const getEmailAccount = (id) => (id === EMAIL_ACCOUNT.id ? EMAIL_ACCOUNT : null);
