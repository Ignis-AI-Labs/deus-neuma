const MODEL_FILE = 'model.safetensors';
const INDEX_FILE = 'model.safetensors.index.json';
const SAFETENSORS_FILE = /(?:^|\/)[^/]+\.safetensors$/;
const CONFIG_FILE = /^(?:config|generation_config)\.json$/;
const TOKENIZER_FILE = /^(?:tokenizer(?:_config)?\.json|tokenizer\.model|spiece\.model|sentencepiece[^/]*|special_tokens_map\.json|added_tokens\.json|vocab\.(?:json|txt)|merges\.txt|chat_template[^/]*)$/;
const PRIMARY_TOKENIZER_FILE = /^(?:tokenizer\.json|tokenizer\.model|spiece\.model|sentencepiece[^/]*|vocab\.(?:json|txt))$/;
const INDEX_BYTES_MAX = 16 * 1024 * 1024;
const CONFIG_BYTES_MAX = 2 * 1024 * 1024;
const INDEX_SHARD_PATH_BYTES_MAX = 1024;
const TENSOR_KEY_BYTES_MAX = 4096;
const REMOTE_CONFIG_FIELDS = Object.freeze(['auto_map', 'custom_pipelines']);

const active = (signal) => {
  if (!signal || typeof signal !== 'object' || !('aborted' in signal)) {
    throw new Error('training snapshot layout signal is invalid');
  }
  if (signal.aborted) {
    throw Object.assign(new Error('training snapshot layout validation exceeded its deadline'), {
      code: 'DIGEST_DEADLINE',
    });
  }
};

const parseObject = (bytes, label) => {
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`training snapshot has a malformed ${label}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`training snapshot has a malformed ${label}`);
  }
  return parsed;
};

const indexedShard = (value) => {
  if (typeof value !== 'string' || !value
    || value !== value.normalize('NFC')
    || Buffer.byteLength(value, 'utf8') > INDEX_SHARD_PATH_BYTES_MAX
    || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)
    || value.startsWith('/') || !value.endsWith('.safetensors')
    || value.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('training snapshot safetensors index contains an unsafe shard path');
  }
  return value;
};

const validateConfig = async (readEntry, signal) => {
  active(signal);
  const config = parseObject(await readEntry('config.json', CONFIG_BYTES_MAX), 'config');
  active(signal);
  if (REMOTE_CONFIG_FIELDS.some((field) => Object.hasOwn(config, field))) {
    throw new Error('training snapshot config requires unapproved remote code');
  }
};

const validateIndex = async (files, readEntry, signal) => {
  active(signal);
  const parsed = parseObject(await readEntry(INDEX_FILE, INDEX_BYTES_MAX), 'safetensors index');
  active(signal);
  const documentFields = Object.keys(parsed);
  if (!documentFields.includes('weight_map')
    || documentFields.some((field) => !['metadata', 'weight_map'].includes(field))
    || !parsed.weight_map || typeof parsed.weight_map !== 'object'
    || Array.isArray(parsed.weight_map)) {
    throw new Error('training snapshot has a malformed safetensors index');
  }
  if (parsed.metadata != null && (!parsed.metadata || typeof parsed.metadata !== 'object'
    || Array.isArray(parsed.metadata)
    || Object.keys(parsed.metadata).some((field) => field !== 'total_size')
    || (Object.hasOwn(parsed.metadata, 'total_size')
      && (!Number.isSafeInteger(parsed.metadata.total_size) || parsed.metadata.total_size < 0)))) {
    throw new Error('training snapshot has unapproved safetensors index metadata');
  }
  const entries = Object.entries(parsed.weight_map);
  if (entries.length === 0) throw new Error('training snapshot has an empty safetensors index');
  const indexed = new Set();
  for (const [tensorKey, value] of entries) {
    active(signal);
    if (!tensorKey || Buffer.byteLength(tensorKey, 'utf8') > TENSOR_KEY_BYTES_MAX
      || /[\u0000-\u001f\u007f]/.test(tensorKey)) {
      throw new Error('training snapshot safetensors index contains an invalid tensor key');
    }
    indexed.add(indexedShard(value));
  }
  const walked = new Set(files.filter(({ relativePath }) => SAFETENSORS_FILE.test(relativePath))
    .map(({ relativePath }) => relativePath));
  for (const shard of indexed) {
    if (!walked.has(shard)) {
      throw new Error('training snapshot safetensors index references a missing shard');
    }
  }
  if (walked.size !== indexed.size || [...walked].some((shard) => !indexed.has(shard))) {
    throw new Error('training snapshot contains an unindexed safetensors shard');
  }
  return Object.freeze([...indexed].sort());
};

/** True only for inert configuration, tokenizer, and safetensors snapshot files. Pure. */
export const isAllowedRefinementSnapshotFile = (relativePath) =>
  CONFIG_FILE.test(relativePath) || TOKENIZER_FILE.test(relativePath)
  || relativePath === INDEX_FILE || SAFETENSORS_FILE.test(relativePath);

/** Validate one exact closed safetensors layout through already pinned bytes. Impure. */
export const validateRefinementSnapshotLayout = async ({ files, readEntry, signal }) => {
  active(signal);
  if (!Array.isArray(files) || typeof readEntry !== 'function'
    || files.some((file) => !file || typeof file.relativePath !== 'string'
      || !isAllowedRefinementSnapshotFile(file.relativePath))) {
    throw new Error('training snapshot contains an unapproved file');
  }
  const names = files.map(({ relativePath }) => relativePath);
  if (new Set(names).size !== names.length || !names.includes('config.json')) {
    throw new Error('cached training snapshot lacks exact model configuration');
  }
  const tokenizerFiles = files.filter(({ relativePath }) => TOKENIZER_FILE.test(relativePath));
  if (!tokenizerFiles.some(({ relativePath }) => PRIMARY_TOKENIZER_FILE.test(relativePath))) {
    throw new Error('cached training snapshot lacks primary tokenizer artifacts');
  }
  const safetensors = files.filter(({ relativePath }) => SAFETENSORS_FILE.test(relativePath));
  const hasSingle = names.includes(MODEL_FILE);
  const hasIndex = names.includes(INDEX_FILE);
  if (Number(hasSingle) + Number(hasIndex) !== 1) {
    throw new Error('training snapshot must contain one safetensors file or one index');
  }
  await validateConfig(readEntry, signal);
  let indexShards = Object.freeze([]);
  if (hasSingle) {
    if (safetensors.length !== 1 || safetensors[0].relativePath !== MODEL_FILE) {
      throw new Error('training snapshot contains ambiguous safetensors weights');
    }
  } else {
    if (safetensors.length === 0) {
      throw new Error('training snapshot safetensors index has no shards');
    }
    indexShards = await validateIndex(files, readEntry, signal);
  }
  active(signal);
  return Object.freeze({
    tokenizerFiles: Object.freeze(tokenizerFiles),
    weightFiles: Object.freeze(safetensors),
    indexShards,
  });
};
