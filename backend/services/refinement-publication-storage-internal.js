import { randomBytes } from 'node:crypto';
import { refinementCustodyMatches } from '../../core/refinement/training-authority-contract.js';
import { refinementSha256 } from '../../core/refinement/training-contract.js';
import {
  readCurrentRefinementApproval,
  readCurrentRefinementCeremony,
  readCurrentRefinementCustody,
} from './refinement-subject-history.js';

export const PUBLICATION_FILE_BYTES_MAX = 8 * 1024 * 1024;
export const PUBLICATION_JOURNAL_BYTES_MAX = 64 * 1024;
export const publicationFailure = (code, message) => Object.assign(new Error(message), { code });

export const publicationDirectories = Object.freeze({
  refinement: Object.freeze([{
    name: 'refinement', mode: 0o700, label: 'refinement publication directory',
  }]),
  ceremonies: Object.freeze([
    { name: 'refinement', mode: 0o700, label: 'refinement publication directory' },
    { name: 'ceremonies', mode: 0o700, label: 'refinement ceremony directory' },
  ]),
  custody: Object.freeze([{
    name: 'dna', mode: 0o700, label: 'sovereign DNA directory',
  }]),
  scales: Object.freeze([
    { name: 'refinement', mode: 0o700, label: 'refinement publication directory' },
    { name: 'scale-authorities', mode: 0o700, label: 'refinement scale authority directory' },
  ]),
});

/** Internal directory scope; all public mutations use a fixed sequence above this layer. */
export const withPublicationDirectory = async (operations, requests, work) => {
  let depth = 0;
  let result;
  let primary = null;
  try {
    for (const request of requests) {
      await operations.enter(request);
      depth += 1;
    }
    result = await work();
  } catch (error) { primary = error; }
  while (depth > 0) {
    try { await operations.leave(); } catch (error) {
      primary = primary
        ? new AggregateError([primary, error], 'publication directory work and release failed')
        : error;
    }
    depth -= 1;
  }
  if (primary) throw primary;
  return result;
};

export const readPublicationEncrypted = async (
  operations, name, maximumBytes, operation, absent = false,
) => {
  const read = await operations.read({
    name, maximumBytes, absent,
    deadline: operation.monotonicDeadline, signal: operation.signal, label: name,
  });
  if (read.state === 'absent') return null;
  try { return operations.decrypt(read.bytes); } catch {
    throw publicationFailure('REFINEMENT_PUBLICATION_CORRUPT', `${name} authentication failed`);
  }
};

export const openPublicationEncrypted = async (
  operations, name, maximumBytes, absent = false,
) => {
  let opened;
  try {
    opened = await operations.open({ kind: 'file', name, label: name });
    const read = await operations.read({ resource: opened.resource, maximumBytes });
    return Object.freeze({ resource: opened.resource, value: operations.decrypt(read.bytes) });
  } catch (error) {
    if (opened?.resource) await operations.release(opened.resource).catch(() => {});
    if (absent && error?.code === 'ENOENT') return null;
    throw error;
  }
};

export const releasePublicationResource = async (operations, resource, primary = null) => {
  try { await operations.release(resource); } catch (error) {
    throw primary ? new AggregateError([primary, error], 'publication file release failed') : error;
  }
  if (primary) throw primary;
};

/** Write, same-held-FD verify, anchored replace, then same-held-FD verify again. */
export const replacePublicationEncrypted = async ({
  operations, name, value, maximumBytes, expectedResource, validate,
}) => {
  const temporaryName = `.publication-${randomBytes(18).toString('hex')}.tmp`;
  const created = await operations.create({
    kind: 'file', name: temporaryName, mode: 0o600, label: `${name} candidate`,
  });
  let published = false;
  let primary = null;
  try {
    await operations.write({
      resource: created.resource, bytes: operations.encrypt(value), maximumBytes,
    });
    const held = await operations.read({ resource: created.resource, maximumBytes });
    validate(operations.decrypt(held.bytes));
    await operations.replace({
      sourceResource: created.resource, targetName: name,
      expectedTargetResource: expectedResource,
    });
    published = true;
    const durable = await operations.read({ resource: created.resource, maximumBytes });
    validate(operations.decrypt(durable.bytes));
  } catch (error) { primary = error; }
  if (!published) {
    try { await operations.unlink({ name: temporaryName, expectedResource: created.resource }); }
    catch (error) {
      primary = primary
        ? new AggregateError([primary, error], `${name} write and cleanup failed`) : error;
    }
  }
  return releasePublicationResource(operations, created.resource, primary);
};

export const readCurrentPublicationAuthority = async (state, ceremonyId) => {
  const { operation, subjectAuthority } = state;
  if (!subjectAuthority) {
    throw publicationFailure(
      'REFINEMENT_PUBLICATION_AUTHORITY_UNAVAILABLE',
      'publication requires one held subject authority',
    );
  }
  const approvalRead = await readCurrentRefinementApproval({
    subjectAuthority, ceremonyId, operation,
  });
  const ceremonyRead = await readCurrentRefinementCeremony({
    subjectAuthority, ceremonyId, operation,
  });
  const custodyRead = await readCurrentRefinementCustody({ subjectAuthority, operation });
  if (approvalRead.state !== 'present' || ceremonyRead.state !== 'present'
    || custodyRead.state !== 'present'
    || approvalRead.approval.recordSha256 !== ceremonyRead.recordSha256
    || approvalRead.approval.revision !== ceremonyRead.revision
    || approvalRead.approval.custodySha256 !== ceremonyRead.custodySha256
    || ceremonyRead.custodySha256 !== custodyRead.custodySha256
    || !refinementCustodyMatches(ceremonyRead.record.custody, custodyRead.custody)) {
    throw publicationFailure(
      'REFINEMENT_PUBLICATION_AUTHORITY_UNAVAILABLE',
      'current cryptographic ceremony and custody authority is unavailable',
    );
  }
  return Object.freeze({
    record: ceremonyRead.record,
    recordSha256: ceremonyRead.recordSha256,
    revision: ceremonyRead.revision,
    custody: custodyRead.custody,
    custodySha256: custodyRead.custodySha256,
    consentAuthority: approvalRead.approval.consentAuthority,
    trainingPlanAuthority: approvalRead.approval.trainingPlanAuthority,
  });
};

export const assertCurrentAdapterAuthority = (adapter, current) => {
  if (!refinementCustodyMatches(adapter.custody, current.custody)
    || refinementSha256(adapter.provenance.consentAuthority)
      !== refinementSha256(current.consentAuthority)
    || refinementSha256(adapter.provenance.trainingPlanAuthority)
      !== refinementSha256(current.trainingPlanAuthority)) {
    throw publicationFailure(
      'REFINEMENT_TRANSACTION_STALE', 'adapter ceremony or custody authority changed',
    );
  }
  return adapter;
};

export const sameRegistryRevision = (left, right) =>
  left?.registrySha256 === right?.registrySha256
  && left?.generation === right?.generation
  && left?.appendRevision === right?.appendRevision;
