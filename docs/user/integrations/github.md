# GitHub Access

Neuma can use the operator's existing GitHub CLI login for approved HTTPS
fetches from private GitHub repositories. This is the GitHub authentication
part of `coding/ground_sync`, not a general-purpose GitHub shell or API tool.

## Current Scope

- `coding/ground_git` reads local branch, HEAD, upstream and dirty counts.
- `map/read_history` reads local commit history and diff summaries.
- `coding/ground_sync` fetches the configured upstream and fast-forwards a clean
  checkout after approval. For canonical `https://github.com/owner/repo.git`
  remotes it can authenticate using the operator's GitHub CLI account.
- Git operations require approval by default, including AUTO. An explicit
  per-tool allowance is a separate, revocable decision.
- Push, commit creation, rebase, force updates, pull requests, issue management,
  releases and general GitHub API access are not added by this integration.

## Operator Setup

The current Linux Git runner uses `/usr/bin/git` and `/usr/bin/gh`. Sign in to
GitHub CLI as the same OS user running the Neuma backend:

```bash
gh auth login --hostname github.com
gh auth status --hostname github.com
```

Use the least-privilege account/token appropriate for your repositories. Neuma
does not request or widen token scopes. The existing CLI token may have broader
rights, but this path only exposes ref reads and object fetches, not those rights
as arbitrary actions available to a model.

A missing CLI account still permits anonymous public-repository access. Private
access needs an account with permission to read that repository. SSO or expired
credentials must be repaired through the operator's GitHub CLI login.

## Consent and Credentials

The sync card identifies the local root, branch, full HEAD, upstream and, for
GitHub remotes, the repository URL and CLI authentication source. Neuma
revalidates the target before proceeding; it does not silently switch a pending
approval to another branch or remote.

After approval, the backend selects the configured GitHub account and obtains
its credential with a fixed GitHub CLI command. A short-lived, opaque internal
capability scopes that credential to the exact HTTPS repository and the two
network command shapes. Only those Git child processes receive the transient
Authorization header. Tokens are not put into process arguments, repository
configuration, approval cards, model prompts, tool results or the coding shell.
The capability is released when the fetch ends or fails.

Ambient `GH_TOKEN`, `GITHUB_TOKEN`, `GH_HOST`, arbitrary Git credential helpers,
SSH commands and repository hooks are not adopted by this path. Redirects remain
disabled, and GitHub credentials cannot be applied to loopback/other hosts or
local Git metadata commands.

## Refusals

A config refusal and an authentication failure are different facts. Local Git
state does not require network access, and an SSH remote does not by itself
prevent a local state read. Do not change remotes based on a generic assumption.

Actual sync currently accepts GitHub HTTPS and numeric-loopback HTTP remotes;
SSH, file transports, Git LFS/configured filters and unsupported executable
configuration remain outside this hardened sync path. A failed fetch/merge can
leave fetched objects or tracking refs changed; the tool reports those states
instead of claiming the entire Git repository was untouched.

## Verified Boundary

The private-provider test performs an actual anonymous refusal followed by an
authenticated GitHub ref read and exact object fetch for the private Neuma
repository. It uses temporary local storage and does not mutate hosted refs or
the operator's checkout. Existing local objects are provided as a read-only
alternate to bound the test's download cost; this does not prove downloading
missing object payloads. Real fixture tests separately cover approval,
cancellation, scoped credentials, revocation and fast-forward behavior.

This is not a claim that an end-to-end private working-tree sync, a full
live-model desktop workflow, every private repository configuration, or any
GitHub write operation has been exercised.
