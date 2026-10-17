import { apiCall } from '../utils/http.js';

/** Pure — missing custody is unknown, never proof of security. */
export const witnessCustodyLabel = (custody) => custody?.plaintextOnDisk
  ? 'KEY IN PLAINTEXT' : custody?.secured ? 'KEY SECURED' : 'CUSTODY UNKNOWN';

/** impure — the witness-aware custody endpoint returns recovery codes once. */
export const secureWitnessCustody = (witness, password) => apiCall('POST',
  `/api/v1/witnesses/${encodeURIComponent(witness.vendorSlug)}/${encodeURIComponent(witness.chosenName)}/custody`,
  { body: { password }, errorPrefix: 'Could not secure the witness key' });
