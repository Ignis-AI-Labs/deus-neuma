// Pure shared classification: credential implementation code is not credential data.
// Basenames: dotenv and credential stores, ssh keys, keypairs wherever they
// stand (keys/ is walled by place already), shell and REPL histories (a typed
// token outlives the session there), and the token files tools keep.
const SECRET_FILE = /^(?:\.env(?:\..*)?|env\..+|.+\.env|\.git-credentials|\.gitconfig|\.netrc|\.npmrc|\.pypirc|\.pgpass|\.vault-token|\.terraformrc|auth\.json|\.?credentials(?:\..+)?|secrets?(?:\..+)?|service-account.*\.json|.*-credentials\.json|.*keypair.*\.json|(?:mnemonic|seed-?phrase)(?:\.txt)?|rclone\.conf|id_(?:dsa|ecdsa|ed25519|rsa)(?:_sk)?(?:\.pub)?|\.[a-z0-9_.-]*_history|\.history|fish_history|.*\.(?:jks|kdbx|key|keyring|keystore|p12|pem|pfx|tfstate(?:\.backup)?))$/i;
// Path tails: generic names that are a credential only where their tool keeps
// them (gh's hosts.yml carries its token, docker's config.json its registry
// auths, kube's config its cluster tokens, hub's its GitHub token) — and a
// Mozilla profile's saved logins, the key that opens them, and its cookies.
const SECRET_PATH = /(?:^|\/)(?:\.docker\/config\.json|gh\/hosts\.yml|\.kube\/config|\.config\/hub|(?:\.mozilla\/firefox|\.thunderbird)\/[^/]+\/(?:logins\.json|key[34]\.db|cookies\.sqlite))$/i;
const CREDENTIAL_SOURCE = /^(?:[a-z0-9_-]+[-.])?credentials?(?:[-.][a-z0-9_-]+)*\.(?:js|mjs|cjs|jsx|ts|tsx)(?:\.map)?$/i;
const basename = (value) => String(value).replace(/\\/g, '/').split('/').at(-1);

/** Pure - narrowly named credential code, never dotenv, hidden files or key material. */
export const isCredentialSource = (value) => {
  const name = basename(value);
  return !/^env\./i.test(name) && CREDENTIAL_SOURCE.test(name);
};

/** Pure - actual secret-shaped files, shared by shell and file tools. A bare
 * basename is judged by name; a path is judged by name and by its tail. */
export const isSecretFile = (value) =>
  (SECRET_FILE.test(basename(value)) || SECRET_PATH.test(String(value).replace(/\\/g, '/')))
  && !isCredentialSource(value);

/** Pure - compatibility with the argument guard, excluding only source basenames.
 * Parent directories still count: .env/credentials.ts is never an exemption. */
export const hasSensitivePath = (value) => {
  const parts = String(value).toLowerCase().replace(/\\/g, '/').split('/');
  return parts.some((part, index) =>
    (index !== parts.length - 1 || !isCredentialSource(part))
    && (part.includes('.env') || part.includes('credentials') || part.includes('secrets')));
};
