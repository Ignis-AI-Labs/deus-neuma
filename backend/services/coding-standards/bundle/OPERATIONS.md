# Environments and consequential operations

Apply to runtime configuration, production data, deployment, external services, or shared compute.

1. Verify the destination from actual configuration: repository/branch, deployment, database, chain ID, account, and signer as applicable. A record existing somewhere does not establish the intended environment.
2. For a consequential write, prepare the exact operation and expected effect. Confirm its authorization covers that scope; use a narrow target and preview affected records or simulate the transaction before execution.
3. Protect existing data with the appropriate backup, rollback, or recovery path. Use dedicated test resources; a user's local database and documents are production data.
4. After execution, read back the result from the same authoritative destination. A successful command or submitted transaction alone is not confirmation of the intended outcome.
5. Record non-secret evidence, destination, time, result, and recovery/follow-up state. Never paste environment files or credentials into a report.
6. Run shared compute under its local resource policy. Use bounded concurrency, timeouts, isolated test data, and owned process cleanup; never assume an idle-looking GPU or port is reserved for you.
