// NO REAL SOCIAL KEYS IN A TEST (2026-10-21 incident: a dev lane posted for real).
//
// A backend a test spawns runs server.js, whose `dotenv/config` reads the repo
// .env — so deleting a key from the test's own env is not enough: the child
// loads it straight back. dotenv never overrides a variable that is already
// set, so every channel key named in .env (or the env) is pinned to '' here,
// which every poster reads as "no key". A run that explicitly opts into a live
// post (X_POST_LIVE=yes, its own double-gated test) keeps its keys.
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

export const SOCIAL_KEY = /^(X|TELEGRAM|DISCORD|FACEBOOK|INSTAGRAM|MASTODON|BLUESKY|LINKEDIN|TIKTOK|YOUTUBE|REDDIT|THREADS)_/;

/** @returns {string[]} the names pinned empty (none when a live post was opted into) */
export const pinSocialKeysEmpty = (env = process.env, repoRoot = process.cwd()) => {
  if (Object.keys(env).some((name) => /_POST_LIVE$/.test(name) && env[name] === 'yes')) return [];
  let fromFile = {};
  try { fromFile = dotenv.parse(fs.readFileSync(path.join(repoRoot, '.env'))); } catch { /* no .env */ }
  const names = [...new Set([...Object.keys(fromFile), ...Object.keys(env)])].filter((name) => SOCIAL_KEY.test(name));
  for (const name of names) env[name] = '';
  return names;
};
