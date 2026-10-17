import { resolveTrackedLocalImportClosure } from './local-static-import-closure.js';
import { assertRefinementProcessOperation } from './refinement-process-operation.js';
import { assertRefinementSourceResolver } from './refinement-source-authority.js';

/** Resolve exact committed import bytes only through one branded server source proof. Impure. */
export const resolveRefinementSourceImportClosure = async ({
  sourceResolver,
  roots,
  explicitPaths = [],
  operation,
}) => {
  const controls = assertRefinementProcessOperation(operation);
  const resolver = assertRefinementSourceResolver(sourceResolver, controls);
  const closure = await resolveTrackedLocalImportClosure({
    sourceRoot: resolver.sourceRoot,
    sourceCommit: resolver.sourceCommit,
    authorityRoot: resolver.authorityRoot,
    roots,
    explicitPaths,
    signal: controls.signal,
    deadline: controls.epochDeadline,
  });
  controls.assertActive();
  assertRefinementSourceResolver(resolver, controls);
  if (closure.rootTreeId !== resolver.rootTreeId) {
    throw Object.assign(new Error('refinement source tree identity changed'), {
      code: 'REFINEMENT_SOURCE_AUTHORITY_UNAVAILABLE',
    });
  }
  return closure;
};
