Security
- A swap from a liquidity wallet is priced by two independent Base nodes. If they disagree, or there is no second node, nothing is signed; the signed swap also goes to both nodes.
- A token named by symbol is one exact token: WETH and USDC always mean their own contracts on Base, a symbol two listed tokens share is refused until you name the address, and swap, send, quote and new-pool answers show the token addresses.
- A liquidity budget that cannot be read is treated as $0, so every deposit waits for your answer instead of running with no cap.
- The positions counted against a budget are checked on Base: each one once, each owned by that wallet, with tokens read from the pool itself.
- A payment enters the money-in list only after a second, independent node confirms the same transaction. Until then the list says the network is unconfirmed and tries again on the next check.
- A node address in plain http to another computer is no longer used; save an https address (a node on this computer still works).
