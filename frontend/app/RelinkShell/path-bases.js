// path-bases — where a relative path in a message points (Design note, 2026-11-19: a chat said `Signed-Drop/` and `To-Sign/`
// right after its own acts wrote /home/…/Thailand Ignis Siam/Signed-Drop/…, and the link refused — […]: […]). A message's
// own acts name the folders it worked in: a relative path it speaks is looked for under them (PathOpener.jsx), after
// the window's focused folder, and the first that exists opens. Pure, apart from the context each message provides.

import { createContext } from 'react';
import { toolLinePath } from './path-menu.js';
import { dirOf } from '../../utils/path.js';

/** The folders the message being drawn worked in (StreamPanel.jsx provides it per message). */
export const PathBases = createContext([]);

const ANCESTORS = 3;
const trim = (p) => String(p).replace(/[\\/]+$/, '');

/** pure — the folders a message's acts named, newest first: each act's path, and the few folders above it. */
export const pathBasesOf = (segments = []) => {
  const paths = (segments ?? []).filter((s) => s?.kind === 'tool')
    .map((s) => toolLinePath(String(s.summary || s.label || ''))?.path).filter(Boolean).reverse();
  const out = [];
  for (const p of paths) {
    let at = trim(p);
    for (let i = 0; i <= ANCESTORS && at && at !== '/'; i += 1) {
      if (!out.includes(at)) out.push(at);
      const up = trim(dirOf(at));
      if (!up || up === at) break;
      at = up;
    }
  }
  return out;
};

/**
 * pure — where a relative path may point, best first: under the folder that holds a folder of its first part's name
 * (`Signed-Drop/` beside an act in …/Signed-Drop/), then under each base, nearest first.
 */
export const relativeCandidates = (rel, bases = [], max = 8) => {
  const clean = trim(String(rel).replace(/^\.[\\/]/, ''));
  if (!clean) return [];
  const first = clean.split(/[\\/]/)[0];
  const holders = bases.flatMap((b) => {
    const parts = b.split('/');
    const i = parts.lastIndexOf(first);
    return i > 0 ? [parts.slice(0, i).join('/') || '/'] : [];
  });
  return [...new Set([...holders, ...bases].map((b) => `${trim(b)}/${clean}`))].slice(0, max);
};
