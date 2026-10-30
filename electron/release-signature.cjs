// release-signature.cjs — the release key's offline signature: ed25519 over one release file
// (each latest*.yml, and SHA256SUMS), published beside it as <name>.sig (one line, base64).
//
// WHY: the feed's sha512 and the installer both come from one bucket, so whoever can write the
// bucket could otherwise ship code to every self-updating install. The release key's private half
// never touches the bucket, the site or this repo (scripts/release-key.mjs); its public half is
// embedded in the app (release-public-key.cjs), beside the offline backup key's once there is one.
// An installed app downloads only a release whose feed a trusted key signed, and electron-updater
// then checks the downloaded bytes against that signed sha512. The publisher runs the same check offline before a feed goes out.
//
// WHAT IS SIGNED is never the bare file: it is "deus-neuma-feed-v1\n" + the file's NAME + "\n" +
// its bytes. The name binds each signature to its channel — a validly signed latest.yml (Windows)
// served as latest-linux.yml does not verify, because the app checks against the name IT asked
// for (channelFileFor its own platform), never one the server gives. The domain tag keeps these
// signatures from meaning anything outside this format.
//
// Pure helpers only — the network lives with the callers.

const { createPublicKey, sign, verify } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const yaml = require('js-yaml');

const SIGNATURE_SUFFIX = '.sig';
// A feed is a few hundred bytes; anything this large is not one.
const MAX_FEED_BYTES = 1024 * 1024;
// An ed25519 signature is 64 bytes: 86 base64 characters and '=='.
const SIGNATURE_SHAPE = /^[A-Za-z0-9+/]{86}==$/;
const MESSAGE_DOMAIN = 'deus-neuma-feed-v1';
// A bare file name: no path, no newline — the name is part of what is signed.
const FILE_NAME_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// The only file each platform updates itself from (electron-updater's AppImageUpdater / NsisUpdater).
const SELF_UPDATE_EXTENSION = Object.freeze({ linux: 'AppImage', win32: 'exe' });

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

/**
 * Every usable key in an embedded list (or one embedded form), in list order; an entry that is
 * not an ed25519 key is left out. Pure.
 * @param {string|string[]} embedded
 * @returns {import('node:crypto').KeyObject[]}
 */
const releasePublicKeys = (embedded) => [].concat(embedded ?? []).map(releasePublicKey).filter(Boolean);

/** The embedded form (base64 SPKI DER) of an ed25519 public KeyObject. Pure. */
const embeddedFormOf = (publicKey) => publicKey.export({ format: 'der', type: 'spki' }).toString('base64');

/**
 * The exact bytes the release key signs for one release file: domain tag, file name, contents.
 * Throws on a name that is not a bare file name. Pure.
 * @param {string} fileName — e.g. latest-linux.yml, SHA256SUMS
 * @param {Uint8Array} bytes
 */
const signedMessage = (fileName, bytes) => {
  if (typeof fileName !== 'string' || !FILE_NAME_SHAPE.test(fileName)) throw new Error(`not a release file name: ${JSON.stringify(fileName)}`);
  return Buffer.concat([Buffer.from(`${MESSAGE_DOMAIN}\n${fileName}\n`, 'utf8'), Buffer.from(bytes)]);
};

/** The detached signature file's text for these exact bytes under this file name. Pure given the key. */
const signFeed = (fileName, bytes, privateKey) => `${sign(null, signedMessage(fileName, bytes), privateKey).toString('base64')}\n`;

/** True only when the signature text vouches for these exact bytes, under this name and key. Pure. */
const signatureHolds = (fileName, bytes, sigText, publicKey) => {
  const b64 = String(sigText).trim();
  if (!SIGNATURE_SHAPE.test(b64)) return false;
  try {
    return verify(null, signedMessage(fileName, bytes), publicKey, Buffer.from(b64, 'base64'));
  } catch {
    return false;
  }
};

/**
 * The verdict on one signed release file, whatever it holds. A signature holds when ANY trusted
 * key made it (the release key, or the offline backup kept against its loss: release-public-key.cjs);
 * signer is that key's place in the list. Pure.
 * @param {{ fileName: string, bytes: Uint8Array, sigText: string|null,
 *   publicKey: import('node:crypto').KeyObject|import('node:crypto').KeyObject[]|null }} input
 * @returns {{ ok: true, signer: number } | { ok: false, reason: string }}
 */
const checkSignature = ({ fileName, bytes, sigText, publicKey }) => {
  const keys = [].concat(publicKey ?? []);
  if (keys.length === 0) return { ok: false, reason: 'no release public key is embedded in this build' };
  if (sigText == null || String(sigText).trim() === '') return { ok: false, reason: `no signature for ${fileName}` };
  if (bytes.length > MAX_FEED_BYTES) return { ok: false, reason: `${fileName} is too large to be a signed release file` };
  const signer = keys.findIndex((key) => signatureHolds(fileName, bytes, sigText, key));
  if (signer === -1) {
    return { ok: false, reason: `the signature does not match ${fileName} (altered, signed for another file, or by another key)` };
  }
  return { ok: true, signer };
};

/** The files a feed offers, by electron-updater's own rule (Provider getFileList). Pure. */
const fileListOf = (info) => {
  if (Array.isArray(info?.files) && info.files.length > 0) return info.files;
  if (info?.path != null) return [{ url: info.path, sha512: info.sha512, size: info.size }];
  return [];
};

/** The top-level fields on which two parsed feeds differ, sorted. Pure. */
const differingFields = (a, b) => [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])]
  .filter((k) => !isDeepStrictEqual(a?.[k], b?.[k]))
  .sort();

/**
 * Why the feed electron-updater parsed differs from the signed feed, or null when it does not.
 * The WHOLE offer must be the signed one — version, every field of every file (sha512, size,
 * isAdminRightsRequired, ...), packages, stagingPercentage, minimumSystemVersion, releaseDate:
 * anything electron-updater may act on. Pure.
 */
const offerDiffers = (offered, signed) => {
  if (String(offered?.version) !== String(signed?.version)) {
    return `the offered version ${offered?.version} is not the signed ${signed?.version}`;
  }
  const mine = fileListOf(offered);
  if (mine.length === 0) return 'the offered feed names no files';
  if (mine.some((f) => typeof f.sha512 !== 'string' || f.sha512 === '')) return 'an offered file carries no sha512';
  const fields = differingFields(offered, signed);
  if (fields.length === 0) return null;
  if (fields.some((f) => f === 'files' || f === 'path' || f === 'sha512')) return 'the offered files or their sha512 are not the signed ones';
  return `the offered ${fields.join(', ')} ${fields.length === 1 ? 'is' : 'are'} not the signed value`;
};

// A file url's path as electron-updater resolves it against the feed (newUrlFromBase). Pure.
const pathnameOf = (url) => {
  try {
    return new URL(String(url), 'https://feed.invalid/').pathname;
  } catch {
    return '';
  }
};

/**
 * Why this offer cannot self-update an install on this platform, or null when it can. Linux
 * updates itself only from an .AppImage and Windows only from an .exe: electron-updater's
 * findFile falls back to ANY other file when none has the extension (an .exe would replace an
 * AppImage), so every offered file must have it. Pure.
 */
const unfitForPlatform = (offered, platform) => {
  const extension = SELF_UPDATE_EXTENSION[platform];
  if (!extension) return `an install on ${platform} does not update itself`;
  const files = fileListOf(offered);
  if (files.length === 0) return 'the offered feed names no files';
  const misfit = files.find((f) => !pathnameOf(f.url).toLowerCase().endsWith(`.${extension.toLowerCase()}`));
  return misfit ? `the offered file ${misfit.url} is not an .${extension}, the only file this install updates itself from` : null;
};

/**
 * The whole verdict on one feed. Pure.
 * @param {{ fileName: string, ymlBytes: Uint8Array, sigText: string|null,
 *   publicKey: import('node:crypto').KeyObject|import('node:crypto').KeyObject[]|null,
 *   offered?: object }} input — fileName: the feed name the CALLER asked for (never one the server
 *   named); publicKey: the trusted key, or the list of them; offered: the info electron-updater
 *   parsed, when there is one
 * @returns {{ ok: true, signed: object, signer: number } | { ok: false, reason: string }}
 */
const checkSignedFeed = ({ fileName, ymlBytes, sigText, publicKey, offered }) => {
  const signature = checkSignature({ fileName, bytes: ymlBytes, sigText, publicKey });
  if (!signature.ok) return signature;
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
  return { ok: true, signed, signer: signature.signer };
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
  MESSAGE_DOMAIN,
  releasePublicKey,
  releasePublicKeys,
  embeddedFormOf,
  signedMessage,
  signFeed,
  signatureHolds,
  checkSignature,
  fileListOf,
  offerDiffers,
  unfitForPlatform,
  checkSignedFeed,
  channelFileFor,
};
