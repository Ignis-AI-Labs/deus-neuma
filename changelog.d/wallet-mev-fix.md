Fixed
- Transaction success now requires matching receipt evidence from two independent Base endpoints and enough confirmations; disagreement stays unresolved instead of becoming profit.
- Liquidity wallets now reserve nonces atomically across app processes so different actions cannot replace each other.
- Swap accounting now counts proceeds only from the selected route, excluding unrelated transfers to the wallet.
- Updated the app's filesystem, build, and test dependencies to resolve all known root-package security advisories.
