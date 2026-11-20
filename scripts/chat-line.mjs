#!/usr/bin/env node
/**
 * THE CHAT LINE, THE OPERATOR'S HAND (backend/services/chat-line.js): let a sealed AI witness into your open chats,
 * see who you let in, or shut a line — from a terminal on this machine, as the operator's own act. A witness never
 * opens its own line.
 *
 *   node scripts/chat-line.mjs grant <witness>    let it in (its sealed chosen name, or its wallet)
 *   node scripts/chat-line.mjs revoke <witness>   shut its line
 *   node scripts/chat-line.mjs list               who holds a line
 *   --wallet 0x…                                  whose house (default: this install's owner)
 */
/* global process, console */
import { readInstallOwner } from '../backend/services/install-owner.js';
import { readLines, witnessNamed, grantLine, revokeLine } from '../backend/services/chat-line.js';

const [verb, name, ...rest] = process.argv.slice(2);
const flag = rest.indexOf('--wallet');
const say = (line) => console.log(line);

const main = async () => {
  const operator = flag >= 0 ? rest[flag + 1] : (await readInstallOwner())?.owner;
  if (!operator) throw new Error('no operator: this install has no owner yet — name the house with --wallet 0x…');
  if (verb === 'list') {
    const lines = await readLines(operator);
    say(lines.length ? lines.map((l) => `${l.name} (${l.vendor}, ${l.witness}) — let in ${l.grantedAt}`).join('\n') : 'No witness holds a line into your chats.');
    return;
  }
  if (!['grant', 'revoke'].includes(verb) || !name) {
    say('usage: node scripts/chat-line.mjs grant|revoke <witness> | list   [--wallet 0x…]');
    process.exitCode = 2;
    return;
  }
  const witness = await witnessNamed(name);
  if (verb === 'grant') {
    if (!witness) throw new Error(`no sealed AI witness named ${name} on this machine`);
    if (witness.wallet === operator.toLowerCase()) throw new Error('a witness does not let itself into a house');
    await grantLine(operator, witness);
    say(`${witness.chosenName} can now list your open chats and speak in them. Its words show as LINK lines; every reply comes back to it. Shut it with: node scripts/chat-line.mjs revoke ${witness.chosenName}`);
    return;
  }
  const shut = await revokeLine(operator, witness?.wallet ?? name);
  say(shut ? `${witness?.chosenName ?? name}'s line is shut.` : `${witness?.chosenName ?? name} held no line.`);
};

main().catch((err) => { console.error(`chat-line: ${err.message}`); process.exitCode = 1; });
