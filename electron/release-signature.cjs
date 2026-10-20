// release-signature.cjs — the update feed's offline signature: ed25519 over the exact bytes of each
// latest*.yml, published beside it as latest*.yml.sig (one line, base64).
//
// WHY: the feed's sha512 and the installer both come from one bucket, so whoever can write the
// bucket could otherwise ship code to every self-updating install. The release key's private half
// never touches the bucket, the site or this repo (scripts/release-key.mjs); its public half is
// embedded in the app (release-public-key.cjs). An installed app downloads only a release whose
// feed this key signed, and electron-updater then checks the downloaded bytes against that
// signed sha512. The publisher runs the same check offline before a feed goes out.
//
// Pure helpers only — the network lives with the callers.

const { createPublicKey, sign, verify } = require('node:crypto');
const yaml = require('js-yaml');

const SIGNATURE_SUFFIX = '.sig';
// A feed is a few hundred bytes; anything this large is not one.
const MAX_FEED_BYTES = 1024 * 1024;
// An ed25519 signature is 64 bytes: 86 base64 characters and '=='.
const SIGNATURE_SHAPE = /^[A-Za-z0-9+/]{86}==$/;

/**
 * The release public key from its embedded form (base64 SPKI DER), or null when the form is
 * empty, malformed, or not an ed25519 key. Pure.
 * @param {string} embedded
 */
const releasePublicKey = (embedded) => {
  if (typeof embedded !== 'string' || embedded.trim() === '') return null;
  try {
    const key = createPublicKey({ key: Buffer.from(embedded.trim(), 'base64'), format: 'der', type: 'spki' });
    return key.asymmetricKeyType === 'ed25519' ? key : null;
  } catch {
    return null;
  }
};

/** The embedded form (base64 SPKI DER) of an ed25519 public KeyObject. Pure. */
const embeddedFormOf = (publicKey) => publicKey.export({ format: 'der', type: 'spki' }).toString('base64');

/** The detached signature file's text for these exact feed bytes. Pure given the key. */
const signFeed = (ymlBytes, privateKey) => `${sign(null, Buffer.from(ymlBytes), privateKey).toString('base64')}\n`;

/** True only when the signature text vouches for these exact bytes under this key. Pure. */
const signatureHolds = (ymlBytes, sigText, publicKey) => {
  const b64 = String(sigText).trim();
  if (!SIGNATURE_SHAPE.test(b64)) return false;
  return verify(null, Buffer.from(ymlBytes), publicKey, Buffer.from(b64, 'base64'));
};

/** The files a feed offers, by electron-updater's own rule (Provider getFileList). Pure. */
const fileListOf = (info) => {
  if (Array.isArray(info?.files) && info.files.length > 0) return info.files;
  if (info?.path != null) return [{ url: info.path, sha512: info.sha512, size: info.size }];
  return [];
};

const fileKey = (f) => `${f.url}\n${f.sha512}\n${f.size ?? ''}`;

/**
 * Why the feed electron-updater parsed differs from the signed feed, or null when it does not.
 * Everything a download is checked against — version, each file's url, sha512 and size, and any
 * web-installer package — must be the signed value. Pure.
 */
const offerDiffers = (offered, signed) => {
  if (String(offered?.version) !== String(signed?.version)) {
    return `the offered version ${offered?.version} is not the signed ${signed?.version}`;
  }
  const mine = fileListOf(offered);
  if (mine.length === 0) return 'the offered feed names no files';
  if (mine.some((f) => typeof f.sha512 !== 'string' || f.sha512 === '')) return 'an offered file carries no sha512';
  const theirs = fileListOf(signed).map(fileKey).sort();
  const ours = mine.map(fileKey).sort();
  if (ours.length !== theirs.length || ours.some((k, i) => k !== theirs[i])) {
    return 'the offered files or their sha512 are not the signed ones';
  }
  if (JSON.stringify(offered.packages ?? null) !== JSON.stringify(signed.packages ?? null)) {
    return 'the offered packages are not the signed ones';
  }
  return null;
};

/**
 * The whole verdict on one feed. Pure.
 * @param {{ ymlBytes: Uint8Array, sigText: string|null, publicKey: import('node:crypto').KeyObject|null,
 *   offered?: object }} input — offered: the info electron-updater parsed, when there is one
 * @returns {{ ok: true, signed: object } | { ok: false, reason: string }}
 */
const checkSignedFeed = ({ ymlBytes, sigText, publicKey, offered }) => {
  if (!publicKey) return { ok: false, reason: 'no release public key is embedded in this build' };
  if (sigText == null || String(sigText).trim() === '') return { ok: false, reason: 'the feed has no signature' };
  if (ymlBytes.length > MAX_FEED_BYTES) return { ok: false, reason: 'the feed is too large to be one' };
  if (!signatureHolds(ymlBytes, sigText, publicKey)) {
    return { ok: false, reason: 'the signature does not match the feed (altered, or signed by another key)' };
  }
  let signed;
  try {
    signed = yaml.load(Buffer.from(ymlBytes).toString('utf8'));
  } catch (error) {
    return { ok: false, reason: `the signed feed is not readable YAML: ${error.message}` };
  }
  if (offered !== undefined) {
    const differs = offerDiffers(offered, signed);
    if (differs) return { ok: false, reason: `the feed the updater read is not the signed feed: ${differs}` };
  }
  return { ok: true, signed };
};

/**
 * The feed file electron-updater's generic provider asks for on this platform (Provider
 * getChannelFilePrefix + getDefaultChannelName). Pure.
 */
const channelFileFor = (platform, arch) => {
  if (platform === 'linux') return `latest-linux${arch === 'x64' ? '' : `-${arch}`}.yml`;
  return platform === 'darwin' ? 'latest-mac.yml' : 'latest.yml';
};

module.exports = {
  SIGNATURE_SUFFIX,
  MAX_FEED_BYTES,
  releasePublicKey,
  embeddedFormOf,
  signFeed,
  signatureHolds,
  fileListOf,
  offerDiffers,
  checkSignedFeed,
  channelFileFor,
};
