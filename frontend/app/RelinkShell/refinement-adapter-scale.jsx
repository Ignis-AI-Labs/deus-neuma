// Provenance-bound adapter scale selection — exact approved values, persisted or restored.
import { useEffect, useState } from 'react';
import { playSound } from '../../services/sound-engine.js';
import { Select } from './Select.jsx';
import {
  commitAdapterScale,
  issueAdapterScaleAuthority,
} from './refinement-client.js';

const AUTHORITY_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SCALE_AUTHORITY_FIELDS = Object.freeze([
  'adapterId',
  'adapterSha256',
  'publicationTransactionSha256',
  'registryGeneration',
  'registryAppendRevision',
  'registrySha256',
  'registryCurrentSelectionSha256',
  'approvedScales',
  'approvedScalesSha256',
  'selectedScale',
  'isCurrent',
]);
const SCALE_COMMIT_FIELDS = Object.freeze([
  'id', 'sha256', 'registeredAt', 'publicationTransactionSha256',
  'registryGeneration', 'registryAppendRevision', 'registrySha256',
  'registryCurrentSelectionSha256', 'isCurrent', 'scale', 'selectedScale',
  'baseModel', 'binding',
]);
const exactJsonFields = (value, fields) => Boolean(
  value
  && typeof value === 'object'
  && !Array.isArray(value)
  && Object.keys(value).length === fields.length
  && fields.every((field) => Object.hasOwn(value, field)),
);
const sameFlatJson = (left, right) => {
  if (!left || typeof left !== 'object' || Array.isArray(left)
    || !right || typeof right !== 'object' || Array.isArray(right)) return false;
  const fields = Object.keys(left);
  if (fields.length !== Object.keys(right).length
    || !fields.every((field) => Object.hasOwn(right, field))) return false;
  return fields.every((field) => {
    if (!Array.isArray(left[field])) return left[field] === right[field];
    return Array.isArray(right[field])
      && left[field].length === right[field].length
      && left[field].every((entry, index) => entry === right[field][index]);
  });
};
const approvedScalesFor = (adapter) => {
  const approved = adapter?.binding?.approvedScales;
  if (!adapter || typeof adapter.id !== 'string'
    || !Array.isArray(approved)
    || approved.length === 0
    || approved.some((value, index) => !Number.isFinite(value)
      || value < 0
      || value > 1
      || (index > 0 && value <= approved[index - 1]))
    || adapter.scale !== adapter.binding.adapterScale
    || !approved.includes(adapter.binding.adapterScale)
    || adapter.binding.adapterId !== adapter.id
    || !SHA256.test(String(adapter.binding.approvedScalesSha256 || ''))
    || typeof adapter.isCurrent !== 'boolean'
    || (adapter.isCurrent
      ? !Number.isFinite(adapter.selectedScale) || !approved.includes(adapter.selectedScale)
      : adapter.selectedScale !== 0)) {
    return null;
  }
  return approved;
};
export const runtimeScaleChoicesFor = (adapter) => {
  const approved = approvedScalesFor(adapter);
  return approved ? Object.freeze([...approved]) : [];
};
const issuedAuthorityMatches = (issued, adapter, nextScale) => {
  const authority = issued?.selectionAuthority;
  const approved = approvedScalesFor(adapter);
  const currentApproved = authority?.approvedScales;
  return Boolean(
    exactJsonFields(issued, ['authorityToken', 'expiresAt', 'selectionAuthority'])
    && AUTHORITY_TOKEN.test(String(issued.authorityToken || ''))
    && Number.isFinite(Date.parse(issued.expiresAt))
    && Date.parse(issued.expiresAt) > Date.now()
    && exactJsonFields(authority, SCALE_AUTHORITY_FIELDS)
    && authority.adapterId === adapter.id
    && authority.adapterSha256 === adapter.sha256
    && authority.publicationTransactionSha256 === adapter.publicationTransactionSha256
    && Number.isSafeInteger(authority.registryGeneration)
    && authority.registryGeneration === adapter.registryGeneration
    && Number.isSafeInteger(authority.registryAppendRevision)
    && authority.registryAppendRevision === adapter.registryAppendRevision
    && SHA256.test(String(authority.registrySha256 || ''))
    && authority.registrySha256 === adapter.registrySha256
    && SHA256.test(String(authority.registryCurrentSelectionSha256 || ''))
    && authority.registryCurrentSelectionSha256 === adapter.registryCurrentSelectionSha256
    && SHA256.test(String(authority.approvedScalesSha256 || ''))
    && authority.approvedScalesSha256 === adapter.binding.approvedScalesSha256
    && authority.isCurrent === adapter.isCurrent
    && Number.isFinite(authority.selectedScale)
    && authority.selectedScale === adapter.selectedScale
    && Array.isArray(currentApproved)
    && approved
    && currentApproved.length === approved.length
    && currentApproved.every((scale, index) => scale === approved[index])
    && currentApproved.includes(nextScale)
  );
};
const scaleLabel = (value) => value === 0
  ? '0 · APPROVED BASE ONLY'
  : String(value);
/** Confirm that the scale commit returned the exact persisted public adapter revision. */
export const committedScaleMatches = (value, adapter, nextScale) => Boolean(
  exactJsonFields(value, SCALE_COMMIT_FIELDS)
  && value.id === adapter.id
  && value.baseModel === adapter.baseModel
  && value.sha256 === adapter.sha256
  && value.registeredAt === adapter.registeredAt
  && value.selectedScale === nextScale
  && value.publicationTransactionSha256 === adapter.publicationTransactionSha256
  && value.scale === adapter.scale
  && sameFlatJson(value.binding, adapter.binding)
  && value.isCurrent === true
  && Number.isSafeInteger(value.registryGeneration)
  && value.registryGeneration === adapter.registryGeneration + 1
  && Number.isSafeInteger(value.registryAppendRevision)
  && value.registryAppendRevision === adapter.registryAppendRevision + 1
  && SHA256.test(String(value.registrySha256 || ''))
  && value.registrySha256 !== adapter.registrySha256
  && SHA256.test(String(value.registryCurrentSelectionSha256 || ''))
);
const displayedScaleFor = (adapter) => adapter.isCurrent ? adapter.selectedScale : null;
export const AdapterRow = ({ neumaId, adapter, onDialed }) => {
  const [value, setValue] = useState(() => displayedScaleFor(adapter));
  const [saving, setSaving] = useState(false);
  const scaleChoices = runtimeScaleChoicesFor(adapter);
  useEffect(() => setValue(displayedScaleFor(adapter)), [
    adapter.id,
    adapter.isCurrent,
    adapter.registrySha256,
    adapter.selectedScale,
  ]);
  const commit = async (nextScale = value) => {
    if (saving || (adapter.isCurrent && nextScale === adapter.selectedScale)
      || !scaleChoices.includes(nextScale)) return;
    setSaving(true);
    playSound('confirm');
    let result;
    try {
      const issued = await issueAdapterScaleAuthority(neumaId, adapter.id);
      if (!issued.ok) {
        result = issued;
      } else if (!issuedAuthorityMatches(issued.body, adapter, nextScale)) {
        result = {
          ok: false,
          error: 'The adapter registry changed before the scale request. Its current state was restored.',
        };
      } else {
        result = await commitAdapterScale(
          neumaId,
          adapter.id,
          nextScale,
          issued.body.authorityToken,
        );
      }
    } catch {
      result = { ok: false, error: 'Could not reach the platform.' };
    }
    const confirmed = result?.ok === true
      && committedScaleMatches(result.body, adapter, nextScale);
    const settled = confirmed
      ? result
      : result?.ok === true
        ? { ok: false, error: 'The platform did not confirm the persisted runtime scale.' }
        : result || { ok: false, error: 'The adapter scale request did not complete.' };
    setValue(confirmed ? result.body.selectedScale : displayedScaleFor(adapter));
    try {
      await onDialed(settled);
    } finally {
      setSaving(false);
    }
  };
  const selectScale = (selected) => {
    const nextScale = scaleChoices.find((scale) => String(scale) === selected);
    if (nextScale !== undefined) commit(nextScale);
  };
  const persistedLabel = value === null
    ? 'NOT CURRENT — CHOOSE AN APPROVED SCALE'
    : `CURRENT ${scaleLabel(value)}`;
  return (
    <li className="refine-adapter">
      <span className="refine-adapter-id">{adapter.id}</span>
      <span className="refine-adapter-base label-data">{adapter.baseModel}</span>
      {scaleChoices.length ? (
        <div className="refine-dial label-data">
          RUNTIME SCALE · EXACTLY APPROVED [{scaleChoices.join(' / ')}]
          <Select
            value={value === null ? '' : String(value)}
            placeholder="NOT CURRENT — CHOOSE"
            options={scaleChoices.map((scale) => ({
              value: String(scale),
              label: scaleLabel(scale),
            }))}
            onChange={selectScale}
            disabled={saving}
            ariaLabel={`Adapter ${adapter.id} exact runtime scale`}
          />
          <span className="refine-dial-value" aria-live="polite">
            {saving ? `PERSISTING REQUEST · ${persistedLabel}` : persistedLabel}
          </span>
        </div>
      ) : (
        <span className="refine-dial label-data" role="status">
          RUNTIME SCALE · AUTHORITY INCOMPLETE — LOCKED
        </span>
      )}
    </li>
  );
};
