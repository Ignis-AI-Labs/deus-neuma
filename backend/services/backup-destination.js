/**
 * BACKUP DESTINATION — where the operator's copy actually lives.
 *
 * Design note, 2026-07-31: […]
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * The covenant now asks an operator to keep a copy on separate physical media.
 * Until this, the app could not help them: backups landed in a sibling of the
 * workspace root — the SAME DISK. That survives a mistaken delete. It does not
 * survive the one case the duty is written for: the drive dying.
 *
 * ── THE MEASUREMENT, NOT A GUESS ────────────────────────────────────────────
 *
 * […] is answerable exactly, without asking the operator
 * to know: `fs.stat().dev` is the device id the kernel reports (on Windows,
 * derived from the volume serial). Two paths with the same `dev` are on one
 * device. So the desk can state a fact rather than offer advice into the dark —
 * which is the whole difference between a warning people read and one they
 * click past.
 *
 * ── WHAT IT REFUSES, AND WHAT IT ONLY WARNS ABOUT ───────────────────────────
 *
 * REFUSES a destination it cannot write to: a backup that silently fails is
 * worse than no backup, because the operator believes they have one.
 *
 * WARNS, and allows, a destination on the same device. Some operators have one
 * disk; telling them "no" would leave them with nothing instead of with
 * something imperfect. They are told plainly what it does and does not protect
 * against, and the desk keeps saying so — it is a standing condition, not a
 * dismissible notice.
 *
 * Pure decision, impure edges, per the usual split.
 */

import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import { getSettingsDir } from './data-root.js';
import { writeJsonAtomic } from './user-realm.js';

/** How a chosen destination stands. */
export const DESTINATION = Object.freeze({
  unset: 'unset',
  separate: 'separate',
  sameDevice: 'same-device',
  unreachable: 'unreachable',
});

const SETTINGS_FILE = () => process.env.NEUMA_BACKUP_DESTINATION_PATH
  || path.join(getSettingsDir(), 'backup-destination.json');

/**
 * Pure — what does this destination amount to?
 *
 * @param {object} facts
 * @param {?string} facts.chosen - the operator's path, or null when unset
 * @param {boolean} facts.writable - could we actually write there?
 * @param {?boolean} facts.sameDevice - same physical device as the beings;
 *   null when it could not be determined (never treated as a failure)
 * @returns {{state: string, ok: boolean, protects: boolean, reason: string}}
 */
export const classifyDestination = ({ chosen, writable, sameDevice }) => {
  if (!chosen) {
    return Object.freeze({
      state: DESTINATION.unset,
      ok: false,
      protects: false,
      reason: 'No backup destination is set. Backups land beside your beings, on the same '
        + 'drive — which protects against a mistaken delete, and against nothing else. '
        + 'Choose an external disk or a USB stick.',
    });
  }
  if (!writable) {
    return Object.freeze({
      state: DESTINATION.unreachable,
      ok: false,
      protects: false,
      reason: 'That destination cannot be written to right now. If it is a removable drive, '
        + 'it may not be plugged in. A backup that silently fails is worse than none, '
        + 'because you would believe you had one.',
    });
  }
  if (sameDevice === true) {
    return Object.freeze({
      state: DESTINATION.sameDevice,
      ok: true,
      protects: false,
      reason: 'This destination is on the SAME physical drive as your beings. It protects '
        + 'against a mistaken delete. It does not protect against that drive failing, '
        + 'which is the case worth planning for. Use an external disk or a USB stick if '
        + 'you have one.',
    });
  }
  return Object.freeze({
    state: DESTINATION.separate,
    ok: true,
    protects: true,
    // Deliberately not congratulatory: a backup only counts if it is CURRENT,
    // and a destination that is usually unplugged is a destination that is
    // usually stale.
    reason: 'This destination is on a different physical drive from your beings. Keep it '
      + 'current — a backup is only worth what it last copied.',
  });
};

/** impure — the device id the kernel reports for a path, or null. */
export const deviceOf = (target) => {
  try { return fs.statSync(target).dev; } catch { return null; }
};

/** impure — can we actually create files here? Proven by writing, not by
 *  reading a permission bit: the bit lies on removable media, network mounts
 *  and read-only volumes. */
export const canWrite = async (dir) => {
  const probe = path.join(dir, `.neuma-write-probe-${process.pid}`);
  try {
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(probe, 'x');
    await fsp.rm(probe, { force: true });
    return true;
  } catch {
    return false;
  }
};

/** impure — the operator's chosen destination, or null. */
export const readDestination = async () => {
  try {
    const raw = await fsp.readFile(SETTINGS_FILE(), 'utf8');
    const chosen = JSON.parse(raw)?.path;
    return typeof chosen === 'string' && chosen.trim() ? chosen.trim() : null;
  } catch {
    return null; // absent or corrupt — unset, which is a safe answer
  }
};

/** impure — set (or clear, with null) the destination. */
export const writeDestination = async (chosen) => {
  await fsp.mkdir(path.dirname(SETTINGS_FILE()), { recursive: true });
  await writeJsonAtomic(SETTINGS_FILE(), { path: chosen || null });
  return chosen || null;
};

/**
 * impure — the full standing of the destination, measured.
 *
 * @param {string} beingsRoot - where the beings live, for the device comparison
 * @param {?string} [override] - assess THIS path instead of the saved one
 */
export const assessDestination = async (beingsRoot, override = undefined) => {
  const chosen = override === undefined ? await readDestination() : override;
  if (!chosen) return Object.freeze({ ...classifyDestination({ chosen: null }), path: null, sameDevice: null });
  const writable = await canWrite(chosen);
  // Compared only when both are readable — an unknown device must never be
  // reported as "separate", which would be a false all-clear.
  const a = deviceOf(chosen);
  const b = deviceOf(beingsRoot);
  const sameDevice = a === null || b === null ? null : a === b;
  return Object.freeze({
    ...classifyDestination({ chosen, writable, sameDevice }),
    path: chosen,
    sameDevice,
  });
};
