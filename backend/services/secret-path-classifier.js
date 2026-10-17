// Pure shared classification: credential implementation code is not credential data.
const SECRET_FILE = /^(?:\.env(?:\..*)?|env\..+|.+\.env|\.git-credentials|\.gitconfig|\.netrc|\.npmrc|\.pypirc|auth\.json|credentials(?:\..+)?|secrets?(?:\..+)?|service-account.*\.json|.*-credentials\.json|id_(?:dsa|ecdsa|ed25519|rsa)(?:\.pub)?|.*\.(?:jks|kdbx|key|keystore|p12|pem|pfx|tfstate(?:\.backup)?))$/i;
const CREDENTIAL_SOURCE = /^(?:[a-z0-9_-]+[-.])?credentials?(?:[-.][a-z0-9_-]+)*\.(?:js|mjs|cjs|jsx|ts|tsx)(?:\.map)?$/i;
const basename = (value) => String(value).replace(/\\/g, '/').split('/').at(-1);

/** Pure - narrowly named credential code, never dotenv, hidden files or key material. */
export const isCredentialSource = (value) => {
  const name = basename(value);
  return !/^env\./i.test(name) && CREDENTIAL_SOURCE.test(name);
};

/** Pure - actual secret-shaped file basenames, shared by shell and file tools. */
export const isSecretFile = (value) => SECRET_FILE.test(basename(value)) && !isCredentialSource(value);

/** Pure - compatibility with the argument guard, excluding only source basenames.
 * Parent directories still count: .env/credentials.ts is never an exemption. */
export const hasSensitivePath = (value) => {
  const parts = String(value).toLowerCase().replace(/\\/g, '/').split('/');
  return parts.some((part, index) =>
    (index !== parts.length - 1 || !isCredentialSource(part))
    && (part.includes('.env') || part.includes('credentials') || part.includes('secrets')));
};
