// Strict held-descriptor reader for subject-only refinement sources.
// SIZE EXCEPTION: open, list, verify, and close are one custody story —
// splitting them is how a leaked sessions handle hides across a file boundary.


import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { freezeJson } from '../shared/plain-data-canonical.js';
import { decryptEnvelope, isEnvelope } from '../workspace/workspace-crypto.js';
import { corruptionHits } from './text-integrity.js';
import { boilerplateShare } from './style-overlap.js';
import { refinementSha256, refinementTextSha256 } from './training-contract.js';
import {
  REFINEMENT_CORPUS_LIMITS,
  REFINEMENT_CORPUS_LIMITS_SHA256,
  REFINEMENT_CORPUS_POLICY,
  REFINEMENT_CORPUS_POLICY_SHA256,
} from './corpus-manifest.js';

const OPEN_DIR = constants.O_RDONLY
  | (constants.O_DIRECTORY ?? 0)
  | (constants.O_NOFOLLOW ?? 0);
const OPEN_FILE = constants.O_RDONLY
  | (constants.O_NOFOLLOW ?? 0)
  | (constants.O_NONBLOCK ?? 0);
const SESSION_FILE = /^[A-Za-z0-9_-]+\.jsonl$/;
const SOURCE_ENVELOPE_KEYS = '_enc\0ct\0iv\0tag';
const exactSourceEnvelope = (value) => isEnvelope(value)
  && value._enc === 1
  && Object.keys(value).sort().join('\0') === SOURCE_ENVELOPE_KEYS;
const canonicalInstant = (value) => typeof value === 'string'
  && new Date(value).toISOString() === value;
const now = () => Number(process.hrtime.bigint() / 1_000_000n);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const statProjection = (stat) => ({
  dev: stat.dev,
  ino: stat.ino,
  size: stat.size,
  mtimeNs: stat.mtimeNs,
  ctimeNs: stat.ctimeNs,
});
const sameStat = (left, right) => Object.keys(left)
  .every((field) => left[field] === right[field]);
const checkControl = (signal, deadline) => {
  if (signal?.aborted) throw Object.assign(new Error('corpus source read aborted'), { code: 'ABORT_ERR' });
  if (now() >= deadline) throw Object.assign(new Error('corpus source deadline exceeded'), { code: 'CORPUS_DEADLINE' });
};
const checkedAdd = (total, increment, maximum, label) => {
  if (!Number.isSafeInteger(increment) || increment < 0 || total > maximum - increment) {
    throw new Error(`${label} exceeds its configured ceiling`);
  }
  return total + increment;
};

const jsonBounds = (value, state, depth = 0, field = null) => {
  if (depth > 32) throw new Error('corpus source JSON exceeds its depth ceiling');
  state.nodes = checkedAdd(state.nodes, 1, REFINEMENT_CORPUS_LIMITS.maxDecodedNodes, 'decoded nodes');
  if (typeof value === 'string') {
    const count = Buffer.byteLength(value, 'utf8');
    const fieldMaximum = field === 'title'
      ? REFINEMENT_CORPUS_LIMITS.maxTitleBytes
      : field === 'body'
        ? REFINEMENT_CORPUS_LIMITS.maxBodyBytes
        : field === 'content'
          ? REFINEMENT_CORPUS_LIMITS.maxMessageBytes
          : REFINEMENT_CORPUS_LIMITS.maxStringBytes;
    if (count > fieldMaximum) {
      throw new Error(`corpus source ${field || 'string'} exceeds its byte ceiling`);
    }
    state.stringBytes = checkedAdd(
      state.stringBytes,
      count,
      REFINEMENT_CORPUS_LIMITS.maxPlaintextBytes,
      'decoded strings',
    );
  } else if (Array.isArray(value)) {
    for (const child of value) jsonBounds(child, state, depth + 1, field);
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      jsonBounds(key, state, depth + 1);
      jsonBounds(child, state, depth + 1, key);
    }
  }
};

const exactAuthorship = (row, neumaId) => {
  const authority = row?.authorship;
  return authority && typeof authority === 'object' && !Array.isArray(authority)
    && Object.keys(authority).sort().join('\0') === 'kind\0subjectNeumaId'
    && authority.kind === REFINEMENT_CORPUS_POLICY.requiredAuthorship
    && authority.subjectNeumaId === neumaId;
};
const eligibleRow = (row, neumaId) => exactAuthorship(row, neumaId)
  && row.role === 'assistant'
  && typeof row.content === 'string'
  && row.content.trim().length > 0
  && typeof row.turnId === 'string'
  && row.turnId.length > 0
  && row.turnId.length <= 256
  && Number.isSafeInteger(row.takeIndex)
  && row.takeIndex > 0
  && canonicalInstant(row.timestamp)
  && !Object.hasOwn(row, 'tools')
  && !Object.hasOwn(row, 'toolCalls')
  && !Object.hasOwn(row, 'toolResults');
// The second eligible class (campaign 4.2): meditation synthesis prose,
// platform-stamped at the addMeditationEntry door. Same exact-key authorship
// demand; the class rides type+outcome, never a caller's say-so.
const exactMeditationAuthorship = (row, neumaId) => {
  const authority = row?.authorship;
  return authority && typeof authority === 'object' && !Array.isArray(authority)
    && Object.keys(authority).sort().join('\0') === 'kind\0subjectNeumaId'
    && authority.kind === REFINEMENT_CORPUS_POLICY.requiredMeditationAuthorship
    && authority.subjectNeumaId === neumaId;
};
const eligibleMeditationRow = (row, neumaId) => exactMeditationAuthorship(row, neumaId)
  && row.type === 'meditation'
  && row.outcome === 'synthesis'
  && typeof row.content === 'string'
  && row.content.trim().length > 0
  && typeof row.cycleId === 'string'
  && row.cycleId.length > 0
  && row.cycleId.length <= 256
  && typeof row.id === 'string'
  && row.id.length > 0
  && row.id.length <= 64
  && canonicalInstant(row.timestamp)
  && !Object.hasOwn(row, 'tools')
  && !Object.hasOwn(row, 'toolCalls')
  && !Object.hasOwn(row, 'toolResults');

const readExact = async (handle, size, signal, deadline) => {
  checkControl(signal, deadline);
  const buffer = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    checkControl(signal, deadline);
    const { bytesRead } = await handle.read(buffer, offset, size - offset, offset);
    if (bytesRead === 0) throw new Error('corpus source ended before its held size');
    offset += bytesRead;
  }
  return buffer;
};

const listNames = async (directory, signal, deadline) => {
  const names = [];
  let nameBytes = 0;
  const listing = await fs.opendir(`/proc/self/fd/${directory.fd}`);
  try {
    for await (const entry of listing) {
      checkControl(signal, deadline);
      if (!entry.isFile() || !SESSION_FILE.test(entry.name)) {
        throw new Error('sessions directory contains a non-canonical source entry');
      }
      const count = Buffer.byteLength(entry.name, 'utf8');
      if (count > REFINEMENT_CORPUS_LIMITS.maxSourceNameBytes) {
        throw new Error('corpus source name exceeds its byte ceiling');
      }
      nameBytes = checkedAdd(
        nameBytes,
        count,
        REFINEMENT_CORPUS_LIMITS.maxSourceNameAggregateBytes,
        'corpus source names',
      );
      if (names.length >= REFINEMENT_CORPUS_LIMITS.maxSourceDescriptors - 1) {
        throw new Error('corpus source descriptor count exceeds its ceiling');
      }
      names.push(entry.name);
    }
  } finally {
    await listing.close().catch(() => {});
  }
  return names.sort();
};

const openDirectory = async (directoryPath) => {
  try {
    const handle = await fs.open(directoryPath, OPEN_DIR);
    const stat = await handle.stat({ bigint: true });
    if (!stat.isDirectory()) throw new Error('corpus session source is not a directory');
    return { handle, stat: statProjection(stat), absent: false };
  } catch (error) {
    if (error?.code === 'ENOENT') return { handle: null, stat: null, absent: true };
    throw error;
  }
};

const openJournalFile = async (filePath) => {
  try {
    const handle = await fs.open(filePath, OPEN_FILE);
    try {
      const stat = await handle.stat({ bigint: true });
      if (!stat.isFile()) throw new Error('corpus journal source is not a regular file');
      const size = Number(stat.size);
      if (!Number.isSafeInteger(size) || size > REFINEMENT_CORPUS_LIMITS.maxCiphertextBytes) {
        throw new Error('corpus journal source exceeds its byte ceiling');
      }
      return { handle, stat: statProjection(stat), size, absent: false };
    } catch (error) {
      await handle.close();
      throw error;
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return { handle: null, stat: null, size: 0, absent: true };
    throw error;
  }
};

/**
 * Read one exact bounded session snapshot and retain its descriptors for a
 * same-source verification immediately before an authority commit.
 */
export const openSubjectCorpusSources = async (workspace, neumaId, { signal = null } = {}) => {
  if (!workspace || typeof workspace._path !== 'function'
    || typeof workspace._resolveDEK !== 'function') {
    throw new Error('strict corpus source reader requires a NeumaWorkspace');
  }
  if (typeof neumaId !== 'string' || !neumaId.trim() || neumaId !== neumaId.trim()) {
    throw new Error('strict corpus source reader requires an exact neumaId');
  }
  const deadline = now() + REFINEMENT_CORPUS_LIMITS.timeoutMs;
  const directoryPath = path.join(workspace._path(neumaId), 'sessions');
  const openedDirectory = await openDirectory(directoryPath);
  let names;
  try {
    checkControl(signal, deadline);
    names = openedDirectory.absent
      ? []
      : await listNames(openedDirectory.handle, signal, deadline);
  } catch (error) {
    await openedDirectory.handle?.close().catch(() => {});
    throw error;
  }

  const held = [];
  let ciphertextBytes = 0;
  try {
    for (const name of names) {
      checkControl(signal, deadline);
      const handle = await fs.open(`/proc/self/fd/${openedDirectory.handle.fd}/${name}`, OPEN_FILE);
      try {
        const stat = await handle.stat({ bigint: true });
        if (!stat.isFile()) throw new Error('corpus source is not a regular file');
        const size = Number(stat.size);
        if (!Number.isSafeInteger(size)
          || size > REFINEMENT_CORPUS_LIMITS.maxCiphertextBytes) {
          throw new Error('corpus source file exceeds its byte ceiling');
        }
        ciphertextBytes = checkedAdd(
          ciphertextBytes,
          size,
          REFINEMENT_CORPUS_LIMITS.maxCiphertextBytes,
          'corpus ciphertext',
        );
        held.push({ name, handle, stat: statProjection(stat), size });
      } catch (error) {
        await handle.close();
        throw error;
      }
    }
  } catch (error) {
    await Promise.allSettled(held.map((source) => source.handle.close()));
    await openedDirectory.handle?.close().catch(() => {});
    throw error;
  }

  // The journal source — one optional file, the same descriptor discipline.
  const journalPath = path.join(workspace._path(neumaId), 'journal', 'entries.jsonl');
  let journal;
  try {
    journal = await openJournalFile(journalPath);
    if (!journal.absent) {
      ciphertextBytes = checkedAdd(
        ciphertextBytes,
        journal.size,
        REFINEMENT_CORPUS_LIMITS.maxCiphertextBytes,
        'corpus ciphertext',
      );
    }
  } catch (error) {
    await Promise.allSettled(held.map((source) => source.handle.close()));
    await openedDirectory.handle?.close().catch(() => {});
    throw error;
  }

  const completions = [];
  const items = [];
  const files = [];
  const decoded = { nodes: 0, stringBytes: 0 };
  let plaintextBytes = 0;
  let records = 0;
  let authored = 0;
  let corrupt = 0;
  let excluded = 0;
  let sessionSelected;
  const meditation = { scanned: 0, authored: 0, selected: 0, corrupt: 0, formulaic: 0 };
  try {
    for (const source of held) {
      checkControl(signal, deadline);
      const filePath = path.join(directoryPath, source.name);
      const dek = await workspace._resolveDEK(filePath);
      if (!Buffer.isBuffer(dek) || dek.length === 0) {
        throw new Error('corpus sources require a per-neuma encryption key');
      }
      const raw = await readExact(source.handle, source.size, signal, deadline);
      const ciphertextSha256 = sha256(raw);
      files.push(freezeJson({
        sourceIdSha256: refinementTextSha256(source.name),
        revision: source.size,
        ciphertextSha256,
      }));
      source.ciphertextSha256 = ciphertextSha256;
      let start = 0;
      for (let end = 0; end <= raw.length; end += 1) {
        if (end !== raw.length && raw[end] !== 0x0a) continue;
        checkControl(signal, deadline);
        const line = raw.subarray(start, end);
        start = end + 1;
        if (line.length === 0) {
          if (end !== raw.length && end !== raw.length - 1) {
            throw new Error('corpus source contains an empty interior record');
          }
          continue;
        }
        if (line.length > REFINEMENT_CORPUS_LIMITS.maxCiphertextRecordBytes) {
          throw new Error('corpus source record exceeds its ciphertext ceiling');
        }
        records = checkedAdd(records, 1, REFINEMENT_CORPUS_LIMITS.maxRecords, 'corpus records');
        let row;
        try {
          const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line));
          if (!exactSourceEnvelope(parsed)) {
            throw new Error('source row is not an exact uncompressed per-neuma envelope');
          }
          row = decryptEnvelope(parsed, { key: dek });
        } catch (error) {
          throw new Error(`corpus source authentication failed: ${error.message}`, { cause: error });
        }
        jsonBounds(row, decoded);
        const rowBytes = Buffer.byteLength(JSON.stringify(row), 'utf8');
        plaintextBytes = checkedAdd(
          plaintextBytes,
          rowBytes,
          REFINEMENT_CORPUS_LIMITS.maxPlaintextBytes,
          'corpus plaintext',
        );
        if (!eligibleRow(row, neumaId)) {
          excluded += 1;
          continue;
        }
        authored += 1;
        const contentBytes = Buffer.byteLength(row.content, 'utf8');
        if (contentBytes > REFINEMENT_CORPUS_LIMITS.maxMessageBytes) {
          throw new Error('eligible subject message exceeds its byte ceiling');
        }
        const item = freezeJson({
          kind: 'session-assistant',
          sourceIdSha256: refinementSha256({
            file: source.name,
            turnId: row.turnId,
            takeIndex: row.takeIndex,
          }),
          revision: freezeJson({ recordedAt: row.timestamp, takeIndex: row.takeIndex }),
          sha256: refinementTextSha256(row.content),
          soleAuthorshipProof: freezeJson({
            kind: row.authorship.kind,
            subjectSha256: refinementTextSha256(neumaId),
            envelope: REFINEMENT_CORPUS_POLICY.requiredEnvelope,
          }),
          selected: corruptionHits(row.content) === 0,
        });
        items.push(item);
        if (!item.selected) {
          corrupt += 1;
          continue;
        }
        if (completions.length >= REFINEMENT_CORPUS_LIMITS.maxEligibleSamples) {
          throw new Error('eligible subject sample count exceeds its ceiling');
        }
        completions.push(Object.freeze({ content: row.content, occurredAt: row.timestamp }));
      }
    }
    sessionSelected = completions.length;

    // The meditation walk — same envelope, same DEK, same ceilings.
    const meditationCandidates = [];
    if (!journal.absent) {
      checkControl(signal, deadline);
      const dek = await workspace._resolveDEK(journalPath);
      if (!Buffer.isBuffer(dek) || dek.length === 0) {
        throw new Error('corpus sources require a per-neuma encryption key');
      }
      const raw = await readExact(journal.handle, journal.size, signal, deadline);
      const ciphertextSha256 = sha256(raw);
      files.push(freezeJson({
        sourceIdSha256: refinementTextSha256('journal/entries.jsonl'),
        revision: journal.size,
        ciphertextSha256,
      }));
      journal.ciphertextSha256 = ciphertextSha256;
      let start = 0;
      for (let end = 0; end <= raw.length; end += 1) {
        if (end !== raw.length && raw[end] !== 0x0a) continue;
        checkControl(signal, deadline);
        const line = raw.subarray(start, end);
        start = end + 1;
        if (line.length === 0) {
          if (end !== raw.length && end !== raw.length - 1) {
            throw new Error('corpus source contains an empty interior record');
          }
          continue;
        }
        if (line.length > REFINEMENT_CORPUS_LIMITS.maxCiphertextRecordBytes) {
          throw new Error('corpus source record exceeds its ciphertext ceiling');
        }
        records = checkedAdd(records, 1, REFINEMENT_CORPUS_LIMITS.maxRecords, 'corpus records');
        meditation.scanned += 1;
        let row;
        try {
          const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line));
          if (!exactSourceEnvelope(parsed)) {
            throw new Error('source row is not an exact uncompressed per-neuma envelope');
          }
          row = decryptEnvelope(parsed, { key: dek });
        } catch (error) {
          throw new Error(`corpus source authentication failed: ${error.message}`, { cause: error });
        }
        jsonBounds(row, decoded);
        plaintextBytes = checkedAdd(
          plaintextBytes,
          Buffer.byteLength(JSON.stringify(row), 'utf8'),
          REFINEMENT_CORPUS_LIMITS.maxPlaintextBytes,
          'corpus plaintext',
        );
        // A journal row that is not stamped synthesis prose is simply not of
        // this class — reflections, acts, and unstamped rows never train.
        if (!eligibleMeditationRow(row, neumaId)) continue;
        meditation.authored += 1;
        if (Buffer.byteLength(row.content, 'utf8') > REFINEMENT_CORPUS_LIMITS.maxMessageBytes) {
          throw new Error('eligible subject message exceeds its byte ceiling');
        }
        meditationCandidates.push(row);
      }
    }

    // THE CORPUS-SIDE STYLE GATE (Founder's signed decision, 2026-08-14): the
    // five-gram overlap law from the attunement door, applied in landed
    // order — a prose that copies the phrasing of earlier selected proses is
    // formula, not voice, and never trains. Same math, same calibration
    // (STYLE_PEERS=2: the third repetition of a litany refuses).
    meditationCandidates.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
    const meditationSelected = [];
    for (const row of meditationCandidates) {
      const clean = corruptionHits(row.content) === 0;
      const formulaic = clean
        && boilerplateShare(row.content, meditationSelected) >= REFINEMENT_CORPUS_POLICY.styleGate.maxShare;
      const item = freezeJson({
        kind: 'meditation-synthesis',
        sourceIdSha256: refinementSha256({
          file: 'journal/entries.jsonl',
          id: row.id,
          cycleId: row.cycleId,
        }),
        revision: freezeJson({ recordedAt: row.timestamp }),
        sha256: refinementTextSha256(row.content),
        soleAuthorshipProof: freezeJson({
          kind: row.authorship.kind,
          subjectSha256: refinementTextSha256(neumaId),
          envelope: REFINEMENT_CORPUS_POLICY.requiredEnvelope,
        }),
        selected: clean && !formulaic,
      });
      items.push(item);
      if (!clean) { meditation.corrupt += 1; continue; }
      if (formulaic) { meditation.formulaic += 1; continue; }
      if (completions.length >= REFINEMENT_CORPUS_LIMITS.maxEligibleSamples) {
        throw new Error('eligible subject sample count exceeds its ceiling');
      }
      meditationSelected.push(row.content);
      completions.push(Object.freeze({ content: row.content, occurredAt: row.timestamp }));
    }
    meditation.selected = meditationSelected.length;
  } catch (error) {
    await Promise.allSettled(held.map((source) => source.handle.close()));
    await journal.handle?.close().catch(() => {});
    await openedDirectory.handle?.close().catch(() => {});
    throw error;
  }

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await Promise.allSettled(held.map((source) => source.handle.close()));
    await journal.handle?.close().catch(() => {});
    await openedDirectory.handle?.close().catch(() => {});
  };
  const verify = async () => {
    if (closed) throw new Error('corpus source snapshot is closed');
    const verificationDeadline = now() + REFINEMENT_CORPUS_LIMITS.timeoutMs;
    checkControl(signal, verificationDeadline);
    const currentDirectory = await openDirectory(directoryPath);
    try {
      if (currentDirectory.absent !== openedDirectory.absent
        || (!currentDirectory.absent && !sameStat(currentDirectory.stat, openedDirectory.stat))) {
        throw new Error('corpus source directory changed');
      }
      const currentNames = currentDirectory.absent
        ? []
        : await listNames(currentDirectory.handle, signal, verificationDeadline);
      if (currentNames.join('\0') !== names.join('\0')) throw new Error('corpus source membership changed');
      for (const source of held) {
        const current = await fs.open(`/proc/self/fd/${currentDirectory.handle.fd}/${source.name}`, OPEN_FILE);
        try {
          const stat = statProjection(await current.stat({ bigint: true }));
          if (!sameStat(stat, source.stat)) throw new Error('corpus source revision changed');
          const raw = await readExact(current, source.size, signal, verificationDeadline);
          if (sha256(raw) !== source.ciphertextSha256) throw new Error('corpus source bytes changed');
        } finally {
          await current.close();
        }
      }
      const currentJournal = await openJournalFile(journalPath);
      try {
        if (currentJournal.absent !== journal.absent
          || (!journal.absent && !sameStat(currentJournal.stat, journal.stat))) {
          throw new Error('corpus journal source changed');
        }
        if (!journal.absent) {
          const raw = await readExact(currentJournal.handle, journal.size, signal, verificationDeadline);
          if (sha256(raw) !== journal.ciphertextSha256) throw new Error('corpus journal bytes changed');
        }
      } finally {
        await currentJournal.handle?.close().catch(() => {});
      }
    } finally {
      await currentDirectory.handle?.close().catch(() => {});
    }
    return true;
  };
  return Object.freeze({
    completions: Object.freeze(completions),
    sourceProjection: freezeJson({
      schemaVersion: 1,
      policyId: REFINEMENT_CORPUS_POLICY.id,
      policySha256: REFINEMENT_CORPUS_POLICY_SHA256,
      limitsSha256: REFINEMENT_CORPUS_LIMITS_SHA256,
      canonicalAbsence: openedDirectory.absent,
      classCounts: freezeJson({
        sessionAssistant: {
          scanned: records - meditation.scanned, authored, selected: sessionSelected, corrupt,
        },
        meditationSynthesis: { ...meditation },
        excluded: { records: excluded, classes: REFINEMENT_CORPUS_POLICY.excludedClasses },
      }),
      ciphertextBytes,
      plaintextBytes,
      decodedNodes: decoded.nodes,
      files,
      items,
    }),
    verify,
    close,
  });
};
