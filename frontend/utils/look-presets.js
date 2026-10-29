// look-presets.js — the platform's stock dresses. Pure data.
//
// Curated within LINE & CYCLE discipline: a near-void ground, a barely
// raised panel, one ink, ONE trim. ULTRAVIOLET and GOLDLEAF honor the two
// accents retired from the brand sheet at ratification; the light dresses
// (PARCHMENT, ALABASTER, SOLAR) close the shelf. CYBERDECK is the stock look
// itself (Design note, 2026-10-28: […]) — choosing it clears the override entirely. STONE is the
// neutral charcoal and calm blue; VOID is the original pure black and cyan,
// kept whole for anyone who wants it. Every trim keeps
// clear of ALERT's register (warnings must stay unmistakable), and a
// light dress carries DARK accents so everything reads at data size.
//
// Each dress carries its FULL voice:
//   HEAD — the headings, a pale kin of the trim (deep on light grounds).
//   BODY — prose, a shade off the ink so it can part from it.
//   ITAL — italic, cooler / softer than the body.
//   EMPH — bold, the brightest (or deepest) of the text voices.
//   LINE — hairlines, readable against the ground but quieter than ink.
//   ALERT / WARN / OKAY — the status registers, tuned to the dress's
//   temperature but HELD in their semantic hue families (red / amber /
//   green): a denial must read as a denial under every dress, and each
//   stays distinct from the dress's own trim. CYBERDECK, the stock, claims
//   only HEAD; every other voice rides the stylesheet.

import { STOCK_LOOK } from './look-derive.js';

export const STOCK_PRESETS = Object.freeze([
  { id: 'cyberdeck', name: 'CYBERDECK', theme: STOCK_LOOK },
  { id: 'stone', name: 'STONE', theme: Object.freeze({ ground: '#1B1C1F', panel: '#25272B', ink: '#ECEAE6', trim: '#8AB4F8', head: '#ADACAA', body: '#ECEAE6', ital: '#ECEAE6', emph: '#ECEAE6', line: '#ECEAE6', alert: '#FF5533', warn: '#FFB86B', okay: '#00FF88' }) },
  { id: 'void', name: 'VOID', theme: Object.freeze({ ground: '#000000', panel: '#000000', ink: '#FFFFFF', trim: '#5FE9FF', head: '#B3B3B3', body: '#FFFFFF', ital: '#FFFFFF', emph: '#FFFFFF', line: '#FFFFFF', alert: '#FF5533', warn: '#FFB86B', okay: '#00FF88' }) },
  { id: 'mono', name: 'MONO', theme: Object.freeze({ ground: '#000000', panel: '#0A0A0A', ink: '#FFFFFF', trim: '#FFFFFF', head: '#FFFFFF', body: '#F2F2F2', ital: '#C8C8C8', emph: '#FFFFFF', line: '#9A9A9A', alert: '#FF5533', warn: '#FFB86B', okay: '#00FF88' }) },
  { id: 'graphite', name: 'GRAPHITE', theme: Object.freeze({ ground: '#0B0C0E', panel: '#15171C', ink: '#F2F4F8', trim: '#8FA3BF', head: '#C7D2E0', body: '#E4E8EE', ital: '#A8B6C8', emph: '#F8FAFC', line: '#8A96A4', alert: '#F26D5E', warn: '#D9A95C', okay: '#57C994' }) },
  { id: 'ember', name: 'EMBER', theme: Object.freeze({ ground: '#0A0403', panel: '#160906', ink: '#FFF3E9', trim: '#FF7A45', head: '#FFC9A3', body: '#FFE8D6', ital: '#E8B08A', emph: '#FFF8F2', line: '#C4A090', alert: '#FF4A3D', warn: '#FFC067', okay: '#58E09C' }) },
  { id: 'oxblood', name: 'OXBLOOD', theme: Object.freeze({ ground: '#0D0406', panel: '#1B080C', ink: '#FFECF0', trim: '#FF4D6D', head: '#FFB3C0', body: '#FFE0E6', ital: '#E89AAA', emph: '#FFF5F7', line: '#C49098', alert: '#FF5C33', warn: '#FFB068', okay: '#45E3A0' }) },
  { id: 'sakura', name: 'SAKURA', theme: Object.freeze({ ground: '#0F050A', panel: '#1C0A14', ink: '#FFEFF6', trim: '#FF9EC2', head: '#FFC7DD', body: '#FFE4F0', ital: '#E8A0C0', emph: '#FFF7FB', line: '#C498B0', alert: '#FF5348', warn: '#FFBD75', okay: '#52E0A8' }) },
  { id: 'orchid', name: 'ORCHID', theme: Object.freeze({ ground: '#0E0512', panel: '#1B0A22', ink: '#F9EEFF', trim: '#E879F9', head: '#F0BAFF', body: '#F3E2FF', ital: '#C89AE0', emph: '#FCF6FF', line: '#B498C8', alert: '#FF5560', warn: '#FFB963', okay: '#4AE39B' }) },
  { id: 'ultraviolet', name: 'ULTRAVIOLET', theme: Object.freeze({ ground: '#070510', panel: '#0E0A1F', ink: '#F1ECFF', trim: '#9D7BFF', head: '#C9B5FF', body: '#E8E2FF', ital: '#B09AE8', emph: '#F7F4FF', line: '#A898D0', alert: '#FF5D6C', warn: '#FFBE6E', okay: '#55E0A5' }) },
  { id: 'midnight', name: 'MIDNIGHT', theme: Object.freeze({ ground: '#060714', panel: '#0C0E24', ink: '#EDEEFF', trim: '#7B88FF', head: '#BDC5FF', body: '#E2E4FF', ital: '#9AA4E8', emph: '#F4F5FF', line: '#9898C8', alert: '#FF5E68', warn: '#F5B860', okay: '#4EDD9F' }) },
  { id: 'blueprint', name: 'BLUEPRINT', theme: Object.freeze({ ground: '#04101C', panel: '#081C30', ink: '#E6F2FF', trim: '#4DA3FF', head: '#A9D1FF', body: '#D6EAFF', ital: '#7AB4E0', emph: '#F2F8FF', line: '#78A8D0', alert: '#FF6250', warn: '#FFC168', okay: '#43E08E' }) },
  { id: 'glacier', name: 'GLACIER', theme: Object.freeze({ ground: '#031014', panel: '#062028', ink: '#EAF8FF', trim: '#2DD4BF', head: '#A8EFE2', body: '#D8F4F4', ital: '#70C8C0', emph: '#F4FCFC', line: '#70C0B8', alert: '#FF5D55', warn: '#FFC26D', okay: '#7BE36B' }) },
  { id: 'moss', name: 'MOSS', theme: Object.freeze({ ground: '#030A06', panel: '#07140C', ink: '#EAFFF3', trim: '#52E09A', head: '#B2F0CE', body: '#D8F8E8', ital: '#78C8A0', emph: '#F4FFF8', line: '#78B898', alert: '#FF5C47', warn: '#FFBD62', okay: '#A3E24E' }) },
  { id: 'phosphor', name: 'PHOSPHOR', theme: Object.freeze({ ground: '#020805', panel: '#05130B', ink: '#E4FFEE', trim: '#45F882', head: '#A9FBC9', body: '#D0F8DC', ital: '#68D898', emph: '#F2FFF6', line: '#68C888', alert: '#FF5240', warn: '#FFC25E', okay: '#B6F556' }) },
  { id: 'goldleaf', name: 'GOLDLEAF', theme: Object.freeze({ ground: '#0A0702', panel: '#171004', ink: '#FFF7E6', trim: '#FFB347', head: '#FFD9A0', body: '#FFF0D0', ital: '#D4B070', emph: '#FFFBF0', line: '#C8B070', alert: '#FF4F45', warn: '#E89A3C', okay: '#55E096' }) },
  { id: 'parchment', name: 'PARCHMENT', theme: Object.freeze({ ground: '#F2EDE2', panel: '#E9E2D2', ink: '#1A1610', trim: '#A8512E', head: '#7A3B20', body: '#2A2218', ital: '#6A4A30', emph: '#0A0806', line: '#8A7060', alert: '#B3271E', warn: '#9A6A1F', okay: '#1F7A46' }) },
  { id: 'alabaster', name: 'ALABASTER', theme: Object.freeze({ ground: '#F4F4F2', panel: '#EBEBE7', ink: '#16181A', trim: '#0E7490', head: '#0B5566', body: '#1C2024', ital: '#3A5058', emph: '#0A0C0E', line: '#6A787C', alert: '#B4231F', warn: '#8F6413', okay: '#176E43' }) },
  { id: 'solar', name: 'SOLAR', theme: Object.freeze({ ground: '#F7F0DC', panel: '#EFE6CB', ink: '#211A0C', trim: '#8F6300', head: '#6B4A00', body: '#2A2210', ital: '#6A5420', emph: '#120E06', line: '#8A7850', alert: '#A8281C', warn: '#8A5E10', okay: '#23704A' }) },
]);
