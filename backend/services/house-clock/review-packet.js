/**
 * THE REVIEW PACKET — the Optio brings what waits on the operator back to them
 * in one ordered read (Design note, 2026-10-16: […]).
 *
 * One current packet per house, `<realm>/<wallet>/house-clock/latest-packet.json`,
 * beside the asks: a short summary in the Optio's words (what needs the
 * operator and why, related asks grouped, blocked versus nice to have), the
 * open asks in the order the operator should read them, and the ones work
 * cannot move past without them. A packet REFERENCES asks by id — it never
 * replaces them: the operator answers each ask itself, and nothing in a packet
 * answers anything. A new packet replaces the last.
 *
 * Pure: the shape law (packetFields). impure: the file.
 */
import fs from 'fs/promises';
import path from 'path';
import { writeJsonAtomic } from '../user-realm.js';
import { clockDir } from './wake-ledger.js';

export const PACKET_SUMMARY_MAX = 2000;
export const PACKET_ITEMS_MAX = 50;

const packetFile = (wallet) => path.join(clockDir(wallet), 'latest-packet.json');

const fail = (reason) => ({ ok: false, reason });

/**
 * A filed packet's fields, judged against the house's asks. Pure.
 * @param {{summary?: unknown, order?: unknown, blocked?: unknown}} fields
 * @param {Array<{id: string, status: string}>} asks - the house's asks as readAsks returns them
 * @returns {{ok: true, value: {summary: string, order: string[], blocked: string[]}} | {ok: false, reason: string}}
 */
export const packetFields = ({ summary, order, blocked = [] }, asks) => {
  const text = typeof summary === 'string' ? summary.trim() : '';
  if (!text) return fail('a packet needs a summary — what needs your operator and why, in a few lines');
  if (text.length > PACKET_SUMMARY_MAX) return fail(`the summary is ${text.length} characters — keep it under ${PACKET_SUMMARY_MAX}`);
  if (!Array.isArray(order) || !order.length || !order.every((id) => typeof id === 'string')) {
    return fail('order lists the open ask ids, in the order your operator should read them');
  }
  if (order.length > PACKET_ITEMS_MAX) return fail(`a packet carries at most ${PACKET_ITEMS_MAX} asks`);
  if (new Set(order).size !== order.length) return fail('an ask appears twice in order');
  if (!Array.isArray(blocked) || !blocked.every((id) => typeof id === 'string')) return fail('blocked lists ask ids');
  const byId = new Map(asks.map((a) => [a.id, a]));
  const unknown = order.filter((id) => !byId.has(id));
  if (unknown.length) return fail(`no such ask in this house: ${unknown.join(', ')} — the ids are in your briefing`);
  const settled = order.filter((id) => byId.get(id).status !== 'open');
  if (settled.length) return fail(`already answered or closed: ${settled.join(', ')} — a packet carries only what still waits`);
  const stray = blocked.filter((id) => !order.includes(id));
  if (stray.length) return fail(`blocked names asks that are not in order: ${stray.join(', ')}`);
  return { ok: true, value: { summary: text, order, blocked: [...new Set(blocked)] } };
};

/**
 * File the house's current packet, replacing the last. impure.
 * @param {string} wallet
 * @param {{by: string, byName: string, summary: string, order: string[], blocked: string[]}} packet
 * @returns {Promise<Object>} the stored packet
 */
export const writePacket = async (wallet, packet) => {
  const row = { v: 1, at: new Date().toISOString(), ...packet };
  await writeJsonAtomic(packetFile(wallet), row);
  return row;
};

/** The house's current packet, or null. impure. */
export const readPacket = async (wallet) => {
  try {
    return JSON.parse(await fs.readFile(packetFile(wallet), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
};
