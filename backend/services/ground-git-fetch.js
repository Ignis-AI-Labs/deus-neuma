/** Fetch objects only; remote-tracking refs require a separate ancestry-checked CAS. */
import { runGroundGit, gitFailure } from './ground-git-exec.js';
import { resolveGitHubAuthorization, releaseGitHubAuthorization } from './github-git-auth.js';

/** impure - fixed ref advertisement followed by exact-OID fetch; no config/output leaks. */
export const fetchGroundTarget = async (snapshot, signal) => {
  let authorization;
  try {
    authorization = await resolveGitHubAuthorization(snapshot.url, { signal });
    const advertised = (await runGroundGit(snapshot.root,
      ['ls-remote', '--refs', '--exit-code', '--', snapshot.url, snapshot.merge],
      { signal, timeoutMs: 60000, authorization })).trim();
    const [oid, ref, extra] = advertised.split(/\s+/);
    if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(oid || '') || ref !== snapshot.merge || extra) throw gitFailure('changed');
    await runGroundGit(snapshot.root, ['fetch', '--no-tags', '--no-recurse-submodules',
      '--no-write-fetch-head', '--no-auto-maintenance', '--', snapshot.url, oid],
    { signal, timeoutMs: 60000, authorization });
    const type = (await runGroundGit(snapshot.root, ['cat-file', '-t', oid], { signal })).trim();
    if (type !== 'commit') throw gitFailure('changed');
    return oid;
  } catch (error) {
    if (error.code === 'git_failed') throw gitFailure('private_auth');
    throw error;
  } finally {
    releaseGitHubAuthorization(authorization);
  }
};
