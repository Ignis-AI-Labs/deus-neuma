Added
- Liquidity wallets can now use a treasury-owned Safe smart account with a restricted agent session key.
- On-chain permissions limit transfers to treasury, cap token approvals, pin approved swap routes, and keep swap proceeds in the Safe.
- Operators can verify and register the Safe/Roles binding; the wallet view clearly distinguishes restricted-vault mode from ordinary EOA mode.
Security
- Compromised-session tests prove that attacker recipients, forged owner signatures, malicious spenders, unknown routes, role escalation, and excessive allowances are rejected by the EVM.
