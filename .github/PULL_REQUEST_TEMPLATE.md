<!-- Pull requests go into `dev` (the default branch). `main` only takes release pull requests from `dev`. -->

## What this changes

<!-- One change per pull request. Link the issue it closes: Fixes #123 -->

## How it is proven

<!-- The test that fails before and passes after, or the steps you ran. -->

- [ ] `npm run lint` passes
- [ ] `npx vitest run test/unit` passes
- [ ] `node scripts/secret-scan.mjs` is clean
- [ ] Tests use real dependencies, not mocks of the system under test
- [ ] I have signed the [Contributor License Agreement](../CLA.md) (the bot asks on your first pull request)
