import { createHash } from 'node:crypto';

export const EVIDENCE_MARKER = 'EVIDENCE:';
export const EVIDENCE_LIMITS = Object.freeze({
  packetBytes: 32 * 1024,
  fallbackBytes: 8 * 1024,
  dependencyBudgetBytes: 16 * 1024,
  reserveBytesPerDependency: 512,
  outcomeBytes: 4 * 1024,
  excerpts: 16,
  excerptBytes: 2 * 1024,
  claims: 32,
  claimBytes: 2 * 1024,
  excerptIdsPerClaim: 8,
  constraints: 16,
  downstream: 16,
  listItemBytes: 1024,
  idBytes: 64,
  attestationsPerClaim: 4,
});

export const EVIDENCE_ASK = `Append one final ${EVIDENCE_MARKER} packet immediately before any STATUS or TORCH block. The packet is JSON (optionally in one closed \`\`\`json fence) with exactly this v1 shape:
{"version":1,"outcome":"...","excerpts":[{"id":"...","quote":"verbatim text from your deliverable above"}],"claims":[{"id":"...","text":"...","excerptIds":["..."]}],"constraints":["..."],"downstream":["..."]}
Do not author hashes, paths, URLs, receipt ids, verification/attestation fields, or proven/passed labels. If you have no support for a claim, leave its excerptIds empty; the coordinator will not invent support.`;

const PACKET_KEYS = ['claims', 'constraints', 'downstream', 'excerpts', 'outcome', 'version'];
const EXCERPT_KEYS = ['id', 'quote'];
const CLAIM_KEYS = ['excerptIds', 'id', 'text'];
const ATTESTATION_KEYS = ['claimId', 'receiptId', 'status'];
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const URL_OR_PATH = /(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/|(?:mailto|urn):|www\.|(?:^|[\s("'`])(?:~?[.\\/]|[A-Za-z]:[\\/]|[A-Za-z0-9._-]+[\\/])[^\s"'`]+)/i;
const AUTHORED_PROOF = /\b(?:sha-?256|proven|verified|attested|passed)\b|\b[a-f0-9]{64}\b/i;

const bytes = (value) => Buffer.byteLength(value, 'utf8');
const hash = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const sameKeys = (value, expected) => (
  plainObject(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected)
);
const freezeRows = (rows) => Object.freeze(rows.map((row) => Object.freeze(row)));

const boundedText = (value, field, maxBytes, { authored = true } = {}) => {
  if (typeof value !== 'string' || !value || value !== value.trim() || bytes(value) > maxBytes || /\0/.test(value)) {
    throw new Error(`${field} must be a non-empty, trimmed UTF-8 string of at most ${maxBytes} bytes`);
  }
  if (authored && (URL_OR_PATH.test(value) || AUTHORED_PROOF.test(value))) {
    throw new Error(`${field} may not author hashes, paths, URLs, or proof labels`);
  }
  return value;
};

const boundedId = (value, field, maxBytes = EVIDENCE_LIMITS.idBytes, authored = true) => {
  boundedText(value, field, maxBytes, { authored });
  if (!ID.test(value)) throw new Error(`${field} must be a simple identifier`);
  return value;
};

const exactArray = (value, field, max) => {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${field} must be an array of at most ${max} items`);
  return value;
};

const unique = (values, field) => {
  if (new Set(values).size !== values.length) throw new Error(`${field} must not contain duplicates`);
  return values;
};

const deepFreezePacket = (packet) => Object.freeze({
  version: 1,
  outcome: packet.outcome,
  excerpts: freezeRows(packet.excerpts),
  claims: Object.freeze(packet.claims.map((claim) => Object.freeze({
    ...claim,
    excerptIds: Object.freeze([...claim.excerptIds]),
  }))),
  constraints: Object.freeze([...packet.constraints]),
  downstream: Object.freeze([...packet.downstream]),
});

/** Closed validation for the exact member-authored v1 packet. */
export const validateEvidencePacket = (value) => {
  if (!sameKeys(value, PACKET_KEYS) || value.version !== 1) throw new Error('evidence packet must have the exact v1 fields');
  boundedText(value.outcome, 'outcome', EVIDENCE_LIMITS.outcomeBytes);

  const excerpts = exactArray(value.excerpts, 'excerpts', EVIDENCE_LIMITS.excerpts).map((entry, index) => {
    if (!sameKeys(entry, EXCERPT_KEYS)) throw new Error(`excerpts[${index}] must have exactly id and quote`);
    return {
      id: boundedId(entry.id, `excerpts[${index}].id`),
      quote: boundedText(entry.quote, `excerpts[${index}].quote`, EVIDENCE_LIMITS.excerptBytes),
    };
  });
  unique(excerpts.map(({ id }) => id), 'excerpt ids');
  const excerptIds = new Set(excerpts.map(({ id }) => id));

  const claims = exactArray(value.claims, 'claims', EVIDENCE_LIMITS.claims).map((entry, index) => {
    if (!sameKeys(entry, CLAIM_KEYS)) throw new Error(`claims[${index}] must have exactly id, text, and excerptIds`);
    const refs = exactArray(entry.excerptIds, `claims[${index}].excerptIds`, EVIDENCE_LIMITS.excerptIdsPerClaim)
      .map((ref, refIndex) => boundedId(ref, `claims[${index}].excerptIds[${refIndex}]`));
    unique(refs, `claims[${index}].excerptIds`);
    for (const ref of refs) if (!excerptIds.has(ref)) throw new Error(`claims[${index}] names unknown excerpt '${ref}'`);
    return {
      id: boundedId(entry.id, `claims[${index}].id`),
      text: boundedText(entry.text, `claims[${index}].text`, EVIDENCE_LIMITS.claimBytes),
      excerptIds: refs,
    };
  });
  unique(claims.map(({ id }) => id), 'claim ids');

  const stringList = (raw, field, max) => unique(
    exactArray(raw, field, max).map((entry, index) => boundedText(entry, `${field}[${index}]`, EVIDENCE_LIMITS.listItemBytes)),
    field,
  );
  return deepFreezePacket({
    version: 1,
    outcome: value.outcome,
    excerpts,
    claims,
    constraints: stringList(value.constraints, 'constraints', EVIDENCE_LIMITS.constraints),
    downstream: stringList(value.downstream, 'downstream', EVIDENCE_LIMITS.downstream),
  });
};

const markerOutsideFences = (output) => {
  let fence = null;
  let last = null;
  let lastFence = -1;
  const lines = output.match(/[^\n]*(?:\n|$)/g) || [];
  let offset = 0;
  for (const lineWithEnd of lines) {
    if (!lineWithEnd) continue;
    const line = lineWithEnd.replace(/\r?\n$/, '');
    const fenceLine = line.match(/^[ \t]*(`{3,}|~{3,})(.*)$/);
    if (fenceLine) {
      lastFence = offset + line.length;
      const run = fenceLine[1];
      if (!fence) fence = { char: run[0], length: run.length };
      else if (run[0] === fence.char && run.length >= fence.length && fenceLine[2].trim() === '') fence = null;
    } else if (!fence) {
      const marker = line.match(/^[ \t]*EVIDENCE:[ \t]*$/);
      if (marker) last = { start: offset, end: offset + line.length };
    }
    offset += lineWithEnd.length;
  }
  if (!last || last.start > lastFence) return last;
  return isClosedPacketFence(output.slice(last.end).trim()) ? last : null;
};

const fencedPayload = (suffix) => {
  const open = suffix.match(/^[ \t]*(`{3,}|~{3,})(?:json|evidence|team-evidence)?[ \t]*\r?\n/i);
  if (!open) return null;
  const char = open[1][0];
  const minimum = open[1].length;
  const rest = suffix.slice(open[0].length);
  const lines = rest.match(/[^\n]*(?:\n|$)/g) || [];
  let offset = 0;
  for (const lineWithEnd of lines) {
    const line = lineWithEnd.replace(/\r?\n$/, '');
    const close = line.match(/^[ \t]*(`{3,}|~{3,})[ \t]*$/);
    if (close && close[1][0] === char && close[1].length >= minimum) {
      const tail = rest.slice(offset + lineWithEnd.length);
      if (tail.trim()) throw new Error('evidence fence must be the final suffix');
      return rest.slice(0, offset).replace(/\r?\n$/, '');
    }
    offset += lineWithEnd.length;
  }
  throw new Error('evidence packet fence is not closed');
};

const isClosedPacketFence = (suffix) => {
  if (!/^[ \t]*(?:`{3,}|~{3,})(?:json|evidence|team-evidence)[ \t]*\r?\n/i.test(suffix)) return false;
  try {
    return fencedPayload(suffix) !== null;
  } catch {
    return false;
  }
};

const utf8Prefix = (value, limit) => {
  const buffer = Buffer.from(value, 'utf8');
  if (buffer.length <= limit) return value;
  let end = limit;
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end--;
  return buffer.subarray(0, end).toString('utf8');
};

/** Extract the final line-anchored packet marker outside delivered code fences. */
export const extractEvidence = (output, { fallbackBytes = EVIDENCE_LIMITS.fallbackBytes } = {}) => {
  const source = typeof output === 'string' ? output : '';
  const marker = markerOutsideFences(source);
  const body = (marker ? source.slice(0, marker.start) : source).trim();
  const fallback = utf8Prefix(body, fallbackBytes);
  const diagnostics = {
    sourceBytes: bytes(source),
    bodyBytes: bytes(body),
    fallbackBytes: bytes(fallback),
    fallbackTruncated: bytes(fallback) < bytes(body),
  };
  if (!marker) return Object.freeze({ status: 'unstructured', body, fallback, packet: null, reason: 'absent', diagnostics: Object.freeze(diagnostics) });

  try {
    let payload = source.slice(marker.end).trim();
    const fenced = fencedPayload(payload);
    if (fenced !== null) payload = fenced;
    else payload = payload.replace(/\r?\n[ \t]*END EVIDENCE[ \t]*$/i, '').trim();
    if (!payload || bytes(payload) > EVIDENCE_LIMITS.packetBytes) throw new Error('evidence packet exceeds its byte limit');
    const packet = validateEvidencePacket(JSON.parse(payload));
    return Object.freeze({ status: 'structured', body, fallback: null, packet, reason: null, diagnostics: Object.freeze(diagnostics) });
  } catch {
    return Object.freeze({ status: 'unstructured', body, fallback, packet: null, reason: 'invalid-packet', diagnostics: Object.freeze(diagnostics) });
  }
};

const validateAttestations = (rows, claimIds) => {
  if (rows == null) return [];
  if (!Array.isArray(rows) || rows.length > claimIds.size * EVIDENCE_LIMITS.attestationsPerClaim) {
    throw new Error('authoritative checker returned too many attestations');
  }
  const seen = new Set();
  return rows.map((row, index) => {
    if (!sameKeys(row, ATTESTATION_KEYS)) throw new Error(`attestation[${index}] must have exactly claimId, receiptId, and status`);
    const claimId = boundedId(row.claimId, `attestation[${index}].claimId`);
    const receiptId = boundedId(row.receiptId, `attestation[${index}].receiptId`, 128, false);
    if (!claimIds.has(claimId)) throw new Error(`attestation[${index}] names unknown claim '${claimId}'`);
    if (row.status !== 'passed' && row.status !== 'failed') throw new Error(`attestation[${index}].status must be passed or failed`);
    const key = `${claimId}\0${receiptId}`;
    if (seen.has(key)) throw new Error('authoritative checker returned a duplicate attestation');
    seen.add(key);
    return { claimId, receiptId, status: row.status };
  });
};

/** Derive coordinator-owned hashes/bindings and admit only checker-supplied attestations. */
export const bindEvidence = async ({ stepId, output, packet, checkAttestations = null }) => {
  boundedText(stepId, 'stepId', 128, { authored: false });
  if (typeof output !== 'string') throw new Error('evidence binding output must be a string');
  const outputRef = Object.freeze({ stepId, sha256: hash(output) });
  if (!packet) return Object.freeze({ outputRef, bindings: Object.freeze([]), attestations: Object.freeze([]), unverifiedClaimIds: Object.freeze([]) });

  const excerpts = new Map(packet.excerpts.map((excerpt) => [excerpt.id, excerpt]));
  const bindings = packet.claims.flatMap((claim) => claim.excerptIds.map((excerptId) => {
    const quote = excerpts.get(excerptId).quote;
    return { claimId: claim.id, excerptId, sha256: hash(quote), status: output.includes(quote) ? 'bound' : 'missing' };
  }));
  const claimIds = new Set(packet.claims.map(({ id }) => id));
  const checked = checkAttestations
    ? await checkAttestations(Object.freeze({ stepId, outputRef, claims: packet.claims, bindings: freezeRows(bindings) }))
    : [];
  const attestations = validateAttestations(checked, claimIds);
  const passed = new Set(attestations.filter(({ status }) => status === 'passed').map(({ claimId }) => claimId));
  return Object.freeze({
    outputRef,
    bindings: freezeRows(bindings),
    attestations: freezeRows(attestations),
    unverifiedClaimIds: Object.freeze(packet.claims.map(({ id }) => id).filter((id) => !passed.has(id))),
  });
};

const numericOption = (value, fallback, min, max, field) => {
  if (value == null) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${field} must be an integer from ${min} to ${max}`);
  return value;
};
const callbackOption = (value, field) => {
  if (value != null && typeof value !== 'function') throw new Error(`${field} must be a function`);
  return value ?? null;
};

/** Resolve the explicit candidate switch. Absent/control/unknown env values stay off. */
export const resolveEvidenceOptions = (raw, env = process.env) => {
  const supplied = raw === undefined ? env.NEUMA_TEAM_EVIDENCE_MODE : raw;
  if (supplied == null || supplied === false || supplied === 'off' || supplied === 'control') return null;
  if (typeof supplied === 'string') return supplied === 'candidate' ? resolveEvidenceOptions({ mode: 'candidate' }, env) : null;
  if (!plainObject(supplied) || supplied.mode !== 'candidate') throw new Error('options.evidence must be off, control, or a candidate options object');
  return Object.freeze({
    mode: 'candidate',
    fallbackBytes: numericOption(supplied.fallbackBytes, EVIDENCE_LIMITS.fallbackBytes, 256, EVIDENCE_LIMITS.packetBytes, 'fallbackBytes'),
    dependencyBudgetBytes: numericOption(supplied.dependencyBudgetBytes, EVIDENCE_LIMITS.dependencyBudgetBytes, 256, 1024 * 1024, 'dependencyBudgetBytes'),
    reserveBytesPerDependency: numericOption(supplied.reserveBytesPerDependency, EVIDENCE_LIMITS.reserveBytesPerDependency, 1, 64 * 1024, 'reserveBytesPerDependency'),
    checkAttestations: callbackOption(supplied.checkAttestations, 'checkAttestations'),
    onUsage: callbackOption(supplied.onUsage, 'onUsage'),
    onFinishReason: callbackOption(supplied.onFinishReason, 'onFinishReason'),
    onRequest: callbackOption(supplied.onRequest, 'onRequest'),
    onMetrics: callbackOption(supplied.onMetrics, 'onMetrics'),
  });
};

const item = (priority, report, text) => ({ priority, report, buffer: Buffer.from(text, 'utf8'), offset: 0 });
const grant = (dependency, amount, kinds) => {
  let used = 0;
  for (const entry of dependency.items) {
    if (!kinds.has(entry.priority) || entry.offset >= entry.buffer.length || used >= amount) continue;
    let end = Math.min(entry.buffer.length, entry.offset + amount - used);
    if (end < entry.buffer.length) while (end > entry.offset && (entry.buffer[end] & 0xc0) === 0x80) end--;
    if (end === entry.offset) continue;
    dependency.chunks.push(entry.buffer.subarray(entry.offset, end).toString('utf8'));
    used += end - entry.offset;
    entry.offset = end;
  }
  return used;
};

const allocateFair = (dependencies, available, kinds) => {
  let left = available;
  while (left > 0) {
    const active = dependencies.filter((dependency) => dependency.items.some((entry) => kinds.has(entry.priority) && entry.offset < entry.buffer.length));
    if (!active.length) break;
    const share = Math.max(1, Math.floor(left / active.length));
    let progressed = 0;
    for (const dependency of active) {
      if (left <= 0) break;
      const used = grant(dependency, Math.min(share, left), kinds);
      left -= used;
      progressed += used;
    }
    if (!progressed) break;
  }
  return available - left;
};

const dependencyItems = ({ stepId, packet, envelope, fallback }) => {
  const semanticOmissions = [];
  const items = [item('outcome', { kind: 'outcome', outcomeIndex: 0 }, `[Evidence handoff: ${stepId}]\n`)];
  if (!packet) {
    items.push(item('outcome', { kind: 'outcome', outcomeIndex: 1 }, `Unstructured prerequisite body (no valid v1 evidence packet):\n${fallback}\n`));
    return { items, semanticOmissions };
  }
  items.push(item('outcome', { kind: 'outcome', outcomeIndex: 1 }, `Authored outcome (unverified):\n${packet.outcome}\n`));
  const excerpts = new Map(packet.excerpts.map((excerpt, excerptIndex) => [excerpt.id, { excerpt, excerptIndex }]));
  const bindings = new Map(envelope.bindings.map((entry) => [`${entry.claimId}\0${entry.excerptId}`, entry]));
  const attestations = new Map();
  for (const row of envelope.attestations) {
    const prior = attestations.get(row.claimId) || [];
    prior.push(row);
    attestations.set(row.claimId, prior);
  }
  for (const [claimIndex, claim] of packet.claims.entries()) {
    const referenced = claim.excerptIds.map((excerptId) => ({
      binding: bindings.get(`${claim.id}\0${excerptId}`),
      ...excerpts.get(excerptId),
    }));
    const bound = referenced.filter(({ binding }) => binding?.status === 'bound');
    for (const { binding, excerptIndex } of referenced) {
      if (binding?.status === 'missing') {
        semanticOmissions.push({ kind: 'excerpt', claimIndex, excerptIndex, reason: 'missing-binding' });
      }
    }
    const checks = attestations.get(claim.id) || [];
    if (!bound.length && !checks.length) {
      semanticOmissions.push({ kind: 'claim', claimIndex, reason: 'no-bound-excerpt-or-attestation' });
      continue;
    }
    const state = checks.length
      ? checks.map((row) => `authoritative ${row.status} receipt ${row.receiptId}`).join('; ')
      : 'unverified';
    items.push(item(
      'excerpt',
      { kind: 'claim', claimIndex },
      `Claim index ${claimIndex} [${state}]:\n${claim.text}${bound.length ? '' : '\n'}`,
    ));
    bound.forEach(({ binding, excerpt, excerptIndex }, boundIndex) => {
      items.push(item(
        'excerpt',
        { kind: 'excerpt', claimIndex, excerptIndex },
        `\nBound excerpt index ${excerptIndex} [sha256 ${binding.sha256}]:\n${excerpt.quote}${boundIndex === bound.length - 1 ? '\n' : ''}`,
      ));
    });
  }
  packet.constraints.forEach((text, constraintIndex) => {
    items.push(item('constraint', { kind: 'constraint', constraintIndex }, `Authored constraint (unverified): ${text}\n`));
  });
  packet.downstream.forEach((text, downstreamIndex) => {
    items.push(item('downstream', { kind: 'downstream', downstreamIndex }, `Authored downstream need: ${text}\n`));
  });
  return { items, semanticOmissions };
};

/** Fairly render direct-prerequisite evidence inside one exact UTF-8 byte budget. */
export const renderDependencyEvidence = (sources, options) => {
  const dependencies = sources.map((source) => {
    const built = dependencyItems(source);
    return { stepId: source.stepId, chunks: [], ...built };
  });
  const budget = options.dependencyBudgetBytes;
  const reserve = Math.min(budget, options.reserveBytesPerDependency * Math.max(1, dependencies.length));
  let used = 0;
  if (dependencies.length) {
    const base = Math.floor(reserve / dependencies.length);
    let remainder = reserve % dependencies.length;
    for (const dependency of dependencies) used += grant(dependency, base + (remainder-- > 0 ? 1 : 0), new Set(['outcome']));
  }
  for (const kind of ['outcome', 'excerpt', 'constraint', 'downstream']) {
    used += allocateFair(dependencies, budget - used, new Set([kind]));
  }

  const perDependency = dependencies.map((dependency) => {
    const omissions = [...dependency.semanticOmissions];
    const truncations = [];
    for (const entry of dependency.items) {
      if (entry.offset === 0) omissions.push({ ...entry.report, reason: 'byte-budget' });
      else if (entry.offset < entry.buffer.length) {
        truncations.push({ ...entry.report, originalBytes: entry.buffer.length, renderedBytes: entry.offset });
      }
    }
    return Object.freeze({
      stepId: dependency.stepId,
      renderedBytes: dependency.items.reduce((total, entry) => total + entry.offset, 0),
      omissions: freezeRows(omissions),
      truncations: freezeRows(truncations),
    });
  });
  return Object.freeze({
    contents: Object.freeze(Object.fromEntries(dependencies.map((dependency) => [dependency.stepId, dependency.chunks.join('')]))),
    report: Object.freeze({ budgetBytes: budget, renderedBytes: used, dependencies: Object.freeze(perDependency) }),
  });
};

const requiredPacketIndex = (indexes, id, field) => {
  if (!indexes.has(id)) throw new Error(`${field} is outside the validated evidence packet`);
  return indexes.get(id);
};

/** Plaintext-store-safe structural record: authored ids and prose remain in memory. */
export const structuralEvidenceStep = (parsed, envelope) => {
  const claimIndexes = new Map((parsed.packet?.claims ?? []).map(({ id }, claimIndex) => [id, claimIndex]));
  const excerptIndexes = new Map((parsed.packet?.excerpts ?? []).map(({ id }, excerptIndex) => [id, excerptIndex]));
  return Object.freeze({
    version: 1,
    status: parsed.status,
    reason: parsed.reason,
    outputRef: envelope.outputRef,
    counts: Object.freeze({
      excerpts: parsed.packet?.excerpts.length ?? 0,
      claims: parsed.packet?.claims.length ?? 0,
      constraints: parsed.packet?.constraints.length ?? 0,
      downstream: parsed.packet?.downstream.length ?? 0,
    }),
    bindings: freezeRows(envelope.bindings.map(({ claimId, excerptId, sha256, status }) => ({
      claimIndex: requiredPacketIndex(claimIndexes, claimId, 'binding claim'),
      excerptIndex: requiredPacketIndex(excerptIndexes, excerptId, 'binding excerpt'),
      sha256,
      status,
    }))),
    attestations: freezeRows(envelope.attestations.map(({ claimId, receiptId, status }) => ({
      claimIndex: requiredPacketIndex(claimIndexes, claimId, 'attestation claim'),
      receiptId,
      status,
    }))),
    unverifiedClaimIndexes: Object.freeze(envelope.unverifiedClaimIds.map(
      (claimId) => requiredPacketIndex(claimIndexes, claimId, 'unverified claim'),
    )),
    bodyBytes: parsed.diagnostics.bodyBytes,
    fallbackBytes: parsed.diagnostics.fallbackBytes,
    fallbackTruncated: parsed.diagnostics.fallbackTruncated,
  });
};
