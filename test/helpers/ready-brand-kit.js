/**
 * A brand kit that passes the marketing gate (d8312f93b, Design note, 2026-08-30: […]). Every nine-section field is declared, so `requireReadyKit` opens — the
 * same complete shape brand-kit-workspace.test.js proves the gate accepts.
 *
 * A test that declares a campaign needs one of these on the house ground first;
 * without it campaigns/create refuses, which is the law, not a fault.
 */
import fs from 'fs/promises';
import path from 'path';

/** @param {string} brand lowercase letters, digits and hyphens — a kit name */
export const readyBrandKit = (brand) => ({
  brand,
  name: 'Northwind Capital',
  handle: '@northwind',
  owner: 'metidar',
  footer: 'NORTHWIND · northwind.example',
  colors: {
    bg: '#0b0b0c', bgScreen: '#141416', ink: '#fafafa', inkSoft: '#d4d4d6',
    muted: '#8e8e93', hairline: '#262629', accent: '#ff6b00', trim: '#3a3a3f',
    trimHot: '#ffd400', warn: '#ff2d2d', rise: '#00ff88', halo: '#ff9d3c',
  },
  type: {
    display: "'Rajdhani', sans-serif", voice: 'Inter, sans-serif', data: "'JetBrains Mono', monospace",
    numeral: "'JetBrains Mono', monospace",
    displayWeight: '700', displayTrack: '0',
    voiceWeight: '400',
    numeralWeight: '300', numeralTrack: '-0.02em',
    labelWeight: '400', labelTrack: '0.2em',
  },
  embedFonts: ['rajdhani-bold', 'inter-regular', 'mono-data'],
  marks: {
    wordmark: { file: 'wordmark.svg', recolor: { '#000000': 'ink' } },
    mask: { file: 'mask.svg', recolor: { '#000000': 'ink' } },
  },
  positioning: 'Liquidity infrastructure for teams who do not run a desk.',
  audience: 'Protocol treasuries on Base.',
  pillars: ['capital efficiency', 'no unwind'],
  tagline: 'Liquidity that keeps working.',
  boilerplate: 'Northwind Capital builds liquidity infrastructure on Base.',
  voice: 'Plain, exact, unhurried.',
  tone: 'Level on launches; brief on incidents.',
  bannedPatterns: ['guaranteed returns', 'risk-free'],
  claims: { approved: ['non-custodial'], forbidden: ['any projected APY'] },
  disclosures: ['Not financial advice.'],
  logoRules: { clearSpace: 'one cap-height', minWidthPx: 96, misuse: ['never stretch'] },
  imagery: { direction: 'Instrument photography, hard light.', avoid: ['stock handshakes'] },
  accessibility: { contrastMin: 4.5, altTextRequired: true },
  channels: { x: { handle: '@northwind' } },
  competitors: { neverName: [] },
});

// impure — write the kit and its two marks into `<ground>/brands/<brand>/`.
export const writeReadyBrandKit = async (ground, brand) => {
  const dir = path.join(ground, 'brands', brand);
  await fs.mkdir(path.join(dir, 'marks'), { recursive: true });
  await fs.writeFile(path.join(dir, 'brand.json'), JSON.stringify(readyBrandKit(brand), null, 2));
  const art = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#000000"/></svg>';
  await fs.writeFile(path.join(dir, 'marks', 'wordmark.svg'), art);
  await fs.writeFile(path.join(dir, 'marks', 'mask.svg'), art);
  return dir;
};
