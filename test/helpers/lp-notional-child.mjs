import process from 'node:process';
import console from 'node:console';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

setWorkspacesRoot(process.env.NOTIONAL_WORKSPACE_ROOT);
const reserved = await workspace.consumeLpNotional(process.env.NOTIONAL_LANE, {
  day: process.env.NOTIONAL_DAY,
  amountMicro: Number(process.env.NOTIONAL_AMOUNT),
  capMicro: Number(process.env.NOTIONAL_CAP),
});
console.log(JSON.stringify({ reserved }));
