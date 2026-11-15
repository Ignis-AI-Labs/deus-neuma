Fixed
- Liquidity actions verify the requested pool, exact action, economic limits, chain-derived proceeds, independent budget values, and transaction outcomes before signing or recording success.
- Liquidity deposits read the real fee tier and token decimals from Base, center on the active bin, and handle one-sided deposits correctly.
- Ambiguous transactions remain unresolved until reconciled, preventing duplicate retries; swap earnings use the transaction's own receipt events.
- Liquidity caps cross-check two independent price sources and wait when prices are missing or disagree.
