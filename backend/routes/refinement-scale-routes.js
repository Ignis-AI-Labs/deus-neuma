/** Refinement adapter routes: scale-authority issuance and scale selection. */
import { publicRefinementAdapter } from '../services/refinement-ceremony.js';
import { createRefinementProcessOperation } from '../services/refinement-process-operation.js';
import {
  assertRefinementSubjectTransaction,
  closeRefinementSubjectTransaction,
  openRefinementSubjectTransaction,
} from '../services/refinement-subject-transaction-lock.js';
import { refinementAuthoritySha256 } from '../services/refinement-transaction-context.js';
import {
  openCurrentRefinementRegistryAuthority,
  readCommittedRefinementAdapters,
} from '../services/refinement-registry-authority.js';
import {
  issueRefinementScaleAuthority,
  publicScaleSelectionAuthority,
} from '../services/refinement-scale-authority.js';
import { commitRefinementScaleSelection } from '../services/refinement-publication-transaction.js';
import { answer } from './refinement-route-refusals.js';
import { APPROVAL_TOKEN, hasExactRequestFields, verifyOwnership } from './refinement-route-guards.js';

const routeRefusal = (code, message) => Object.assign(new Error(message), { code });
const operatorWalletSha256 = (wallet) => refinementAuthoritySha256(
  wallet,
  'neuma.refinement.operator-wallet',
);
const withCurrentRegistryAuthority = async (neumaId, work) => {
  const operation = createRefinementProcessOperation({ timeoutMs: 30_000 });
  const transaction = await openRefinementSubjectTransaction({ neumaId, operation });
  let result;
  let primary = null;
  try {
    const subjectAuthority = assertRefinementSubjectTransaction(transaction, operation);
    const registryAuthority = await openCurrentRefinementRegistryAuthority({
      operation,
      subjectAuthority,
    });
    if (registryAuthority?.kind !== 'current-refinement-registry-authority-v2') {
      throw routeRefusal('ADAPTER_NOT_FOUND', 'adapter registry is absent');
    }
    result = await work({ operation, registryAuthority });
  } catch (error) {
    primary = error;
  }
  try {
    await closeRefinementSubjectTransaction(transaction, operation);
  } catch (error) {
    primary = primary
      ? new AggregateError([primary, error], 'adapter registry work and release failed')
      : error;
  }
  if (primary) throw primary;
  return result;
};
/** Register the adapter scale domain on the refinement router. Impure — mutates the router. */
export const registerRefinementScaleRoutes = (router) => {
  router.post('/:neumaId/adapters/:adapterId/scale-authority', async (req, res) => {
    const { neumaId, adapterId } = req.params;
    if (!await verifyOwnership(req, res, neumaId)) return;
    if (!hasExactRequestFields(req.body, [])) {
      return res.status(400).json({
        error: 'Scale authority requests accept no caller-authored input.',
        code: 'INVALID_ADAPTER_SCALE',
      });
    }
    const walletSha256 = operatorWalletSha256(req.walletAddress);
    await answer(res, 'issue adapter scale authority')(() =>
      withCurrentRegistryAuthority(neumaId, async ({ operation, registryAuthority }) => {
        const matches = readCommittedRefinementAdapters({ registryAuthority, operation })
          .filter((adapter) => adapter.id === adapterId);
        if (matches.length !== 1) {
          throw routeRefusal('ADAPTER_NOT_FOUND', 'adapter is unavailable');
        }
        const issued = await issueRefinementScaleAuthority({
          registryAuthority,
          adapterId,
          operatorWalletSha256: walletSha256,
          operation,
        });
        return Object.freeze({
          authorityToken: issued.authorityToken,
          expiresAt: issued.expiresAt,
          selectionAuthority: publicScaleSelectionAuthority(issued),
        });
      }));
  });
  router.put('/:neumaId/adapters/:adapterId/scale', async (req, res) => {
    const { neumaId, adapterId } = req.params;
    if (!await verifyOwnership(req, res, neumaId)) return;
    if (!hasExactRequestFields(req.body, ['scale', 'authorityToken'])
      || !Number.isFinite(req.body.scale)
      || req.body.scale < 0
      || req.body.scale > 1) {
      return res.status(400).json({
        error: 'Adapter scale requests require one finite numeric scale and one scale authority.',
        code: 'INVALID_ADAPTER_SCALE',
      });
    }
    if (!APPROVAL_TOKEN.test(String(req.body.authorityToken || ''))) {
      return res.status(400).json({
        error: 'The scale authority token is invalid.',
        code: 'INVALID_REFINEMENT_SCALE_AUTHORITY',
      });
    }
    const { scale, authorityToken } = req.body;
    const walletSha256 = operatorWalletSha256(req.walletAddress);
    await answer(res, 'set the adapter scale')(() =>
      withCurrentRegistryAuthority(neumaId, async ({ operation, registryAuthority }) => {
        const matches = readCommittedRefinementAdapters({ registryAuthority, operation })
          .filter((adapter) => adapter.id === adapterId);
        if (matches.length !== 1) {
          throw routeRefusal('ADAPTER_NOT_FOUND', 'adapter is unavailable');
        }
        if (!matches[0].binding.approvedScales.includes(scale)) {
          throw routeRefusal('INVALID_ADAPTER_SCALE', 'scale is not approved for this adapter');
        }
        return publicRefinementAdapter(await commitRefinementScaleSelection({
          registryAuthority,
          adapterId,
          scale,
          authorityToken,
          operatorWalletSha256: walletSha256,
          operation,
        }));
      }));
  });
};
