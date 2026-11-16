Fixed
- Agent vault registration now proves the dedicated Roles proxy's creation and initialization blocks and replays its assignment history, rejecting any unintended active role held by the agent.
- Role-history reads use the chain's current height directly, preventing a cached block number from hiding the latest assignment.
