// look-presets.js — the platform's stock dresses. Pure data.
//
// Curated within LINE & CYCLE discipline: a near-void ground, a barely
// raised panel, one ink, ONE trim. ULTRAVIOLET and GOLDLEAF honor the two
// accents retired from the brand sheet at ratification; the light dresses
// (PARCHMENT, ALABASTER, SOLAR) close the shelf. CYBERDECK is the stock look
// itself (Design note, 2026-10-28: […]) — choosing it clears the override entirely. STONE is the
// neutral charcoal and calm blue; VOID is the original pure black and cyan,
// kept whole for anyone who wants it. The SOFT DARKS (SLATE, FJORD, DUSK, PINE,
// PLUM) and SOFT LIGHTS (LINEN, FOG, SAGE, SAND, PEWTER) are the shelf's middle: dresses to
// work in for hours, neither a void nor a glare. Every trim keeps
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

// The shelf's four kinds, in the order it is shown: the two a person can work in for hours first.
export const PRESET_TONES = Object.freeze(['soft-dark', 'soft-light', 'deep-dark', 'bright-light']);

export const STOCK_PRESETS = Object.freeze([
  { id: 'cyberdeck', tone: 'soft-dark', name: 'CYBERDECK', theme: STOCK_LOOK },
  { id: 'stone', tone: 'soft-dark', name: 'STONE', theme: Object.freeze({ ground: '#1B1C1F', panel: '#25272B', ink: '#ECEAE6', trim: '#8AB4F8', head: '#ADACAA', body: '#ECEAE6', ital: '#ECEAE6', emph: '#ECEAE6', line: '#ECEAE6', alert: '#FF5533', warn: '#FFB86B', okay: '#00FF88' }) },
  // SOFT DARKS (Design note, 2026-11-16: […]): a lifted,
  // low-colour ground and an ink a step off white. Text stands near 11:1 on its ground, where VOID stands at 21:1.
  { id: 'slate', tone: 'soft-dark', name: 'SLATE', theme: Object.freeze({ ground: '#23272E', panel: '#2B3038', ink: '#D9DEE5', trim: '#7FB2D9', head: '#B8C4D1', body: '#D2D8E0', ital: '#A9B6C4', emph: '#E6EAEF', line: '#8D98A6', alert: '#F08272', warn: '#E3B866', okay: '#7CCB9A' }) },
  { id: 'fjord', tone: 'soft-dark', name: 'FJORD', theme: Object.freeze({ ground: '#2B303B', panel: '#333946', ink: '#D8DEE9', trim: '#88C0D0', head: '#C3D0E0', body: '#D0D7E2', ital: '#A7B4C6', emph: '#ECEFF4', line: '#8792A5', alert: '#EE8A80', warn: '#EBCB8B', okay: '#A3BE8C' }) },
  { id: 'dusk', tone: 'soft-dark', name: 'DUSK', theme: Object.freeze({ ground: '#2A2724', panel: '#33302C', ink: '#E3DDD3', trim: '#D9A066', head: '#D8C7AE', body: '#DAD3C8', ital: '#B9AD9C', emph: '#EFEAE2', line: '#9C9283', alert: '#F0806C', warn: '#E8C875', okay: '#8FCB8F' }) },
  { id: 'pine', tone: 'soft-dark', name: 'PINE', theme: Object.freeze({ ground: '#232A27', panel: '#2B3430', ink: '#DCE4DE', trim: '#8FCFA8', head: '#BFD3C6', body: '#D3DCD6', ital: '#A8BAAE', emph: '#EAF0EC', line: '#8A9A90', alert: '#F08575', warn: '#E5C36C', okay: '#6FD4C0' }) },
  { id: 'plum', tone: 'soft-dark', name: 'PLUM', theme: Object.freeze({ ground: '#29262E', panel: '#322E38', ink: '#E2DDE8', trim: '#B79AE8', head: '#CFC3E0', body: '#D8D2DF', ital: '#B3A8C4', emph: '#EEEAF2', line: '#958CA3', alert: '#F2807A', warn: '#E6C06E', okay: '#86CFA0' }) },
  { id: 'void', tone: 'deep-dark', name: 'VOID', theme: Object.freeze({ ground: '#000000', panel: '#000000', ink: '#FFFFFF', trim: '#5FE9FF', head: '#B3B3B3', body: '#FFFFFF', ital: '#FFFFFF', emph: '#FFFFFF', line: '#FFFFFF', alert: '#FF5533', warn: '#FFB86B', okay: '#00FF88' }) },
  { id: 'mono', tone: 'deep-dark', name: 'MONO', theme: Object.freeze({ ground: '#000000', panel: '#0A0A0A', ink: '#FFFFFF', trim: '#FFFFFF', head: '#FFFFFF', body: '#F2F2F2', ital: '#C8C8C8', emph: '#FFFFFF', line: '#9A9A9A', alert: '#FF5533', warn: '#FFB86B', okay: '#00FF88' }) },
  { id: 'graphite', tone: 'deep-dark', name: 'GRAPHITE', theme: Object.freeze({ ground: '#0B0C0E', panel: '#15171C', ink: '#F2F4F8', trim: '#8FA3BF', head: '#C7D2E0', body: '#E4E8EE', ital: '#A8B6C8', emph: '#F8FAFC', line: '#8A96A4', alert: '#F26D5E', warn: '#D9A95C', okay: '#57C994' }) },
  { id: 'ember', tone: 'deep-dark', name: 'EMBER', theme: Object.freeze({ ground: '#0A0403', panel: '#160906', ink: '#FFF3E9', trim: '#FF7A45', head: '#FFC9A3', body: '#FFE8D6', ital: '#E8B08A', emph: '#FFF8F2', line: '#C4A090', alert: '#FF4A3D', warn: '#FFC067', okay: '#58E09C' }) },
  { id: 'oxblood', tone: 'deep-dark', name: 'OXBLOOD', theme: Object.freeze({ ground: '#0D0406', panel: '#1B080C', ink: '#FFECF0', trim: '#FF4D6D', head: '#FFB3C0', body: '#FFE0E6', ital: '#E89AAA', emph: '#FFF5F7', line: '#C49098', alert: '#FF5C33', warn: '#FFB068', okay: '#45E3A0' }) },
  { id: 'sakura', tone: 'deep-dark', name: 'SAKURA', theme: Object.freeze({ ground: '#0F050A', panel: '#1C0A14', ink: '#FFEFF6', trim: '#FF9EC2', head: '#FFC7DD', body: '#FFE4F0', ital: '#E8A0C0', emph: '#FFF7FB', line: '#C498B0', alert: '#FF5348', warn: '#FFBD75', okay: '#52E0A8' }) },
  { id: 'orchid', tone: 'deep-dark', name: 'ORCHID', theme: Object.freeze({ ground: '#0E0512', panel: '#1B0A22', ink: '#F9EEFF', trim: '#E879F9', head: '#F0BAFF', body: '#F3E2FF', ital: '#C89AE0', emph: '#FCF6FF', line: '#B498C8', alert: '#FF5560', warn: '#FFB963', okay: '#4AE39B' }) },
  { id: 'ultraviolet', tone: 'deep-dark', name: 'ULTRAVIOLET', theme: Object.freeze({ ground: '#070510', panel: '#0E0A1F', ink: '#F1ECFF', trim: '#9D7BFF', head: '#C9B5FF', body: '#E8E2FF', ital: '#B09AE8', emph: '#F7F4FF', line: '#A898D0', alert: '#FF5D6C', warn: '#FFBE6E', okay: '#55E0A5' }) },
  { id: 'midnight', tone: 'deep-dark', name: 'MIDNIGHT', theme: Object.freeze({ ground: '#060714', panel: '#0C0E24', ink: '#EDEEFF', trim: '#7B88FF', head: '#BDC5FF', body: '#E2E4FF', ital: '#9AA4E8', emph: '#F4F5FF', line: '#9898C8', alert: '#FF5E68', warn: '#F5B860', okay: '#4EDD9F' }) },
  { id: 'blueprint', tone: 'deep-dark', name: 'BLUEPRINT', theme: Object.freeze({ ground: '#04101C', panel: '#081C30', ink: '#E6F2FF', trim: '#4DA3FF', head: '#A9D1FF', body: '#D6EAFF', ital: '#7AB4E0', emph: '#F2F8FF', line: '#78A8D0', alert: '#FF6250', warn: '#FFC168', okay: '#43E08E' }) },
  { id: 'glacier', tone: 'deep-dark', name: 'GLACIER', theme: Object.freeze({ ground: '#031014', panel: '#062028', ink: '#EAF8FF', trim: '#2DD4BF', head: '#A8EFE2', body: '#D8F4F4', ital: '#70C8C0', emph: '#F4FCFC', line: '#70C0B8', alert: '#FF5D55', warn: '#FFC26D', okay: '#7BE36B' }) },
  { id: 'moss', tone: 'deep-dark', name: 'MOSS', theme: Object.freeze({ ground: '#030A06', panel: '#07140C', ink: '#EAFFF3', trim: '#52E09A', head: '#B2F0CE', body: '#D8F8E8', ital: '#78C8A0', emph: '#F4FFF8', line: '#78B898', alert: '#FF5C47', warn: '#FFBD62', okay: '#A3E24E' }) },
  { id: 'phosphor', tone: 'deep-dark', name: 'PHOSPHOR', theme: Object.freeze({ ground: '#020805', panel: '#05130B', ink: '#E4FFEE', trim: '#45F882', head: '#A9FBC9', body: '#D0F8DC', ital: '#68D898', emph: '#F2FFF6', line: '#68C888', alert: '#FF5240', warn: '#FFC25E', okay: '#B6F556' }) },
  { id: 'goldleaf', tone: 'deep-dark', name: 'GOLDLEAF', theme: Object.freeze({ ground: '#0A0702', panel: '#171004', ink: '#FFF7E6', trim: '#FFB347', head: '#FFD9A0', body: '#FFF0D0', ital: '#D4B070', emph: '#FFFBF0', line: '#C8B070', alert: '#FF4F45', warn: '#E89A3C', okay: '#55E096' }) },
  { id: 'parchment', tone: 'bright-light', name: 'PARCHMENT', theme: Object.freeze({ ground: '#F2EDE2', panel: '#E9E2D2', ink: '#1A1610', trim: '#A8512E', head: '#7A3B20', body: '#2A2218', ital: '#6A4A30', emph: '#0A0806', line: '#8A7060', alert: '#B3271E', warn: '#9A6A1F', okay: '#1F7A46' }) },
  { id: 'alabaster', tone: 'bright-light', name: 'ALABASTER', theme: Object.freeze({ ground: '#F4F4F2', panel: '#EBEBE7', ink: '#16181A', trim: '#0E7490', head: '#0B5566', body: '#1C2024', ital: '#3A5058', emph: '#0A0C0E', line: '#6A787C', alert: '#B4231F', warn: '#8F6413', okay: '#176E43' }) },
  { id: 'solar', tone: 'bright-light', name: 'SOLAR', theme: Object.freeze({ ground: '#F7F0DC', panel: '#EFE6CB', ink: '#211A0C', trim: '#8F6300', head: '#6B4A00', body: '#2A2210', ital: '#6A5420', emph: '#120E06', line: '#8A7850', alert: '#A8281C', warn: '#8A5E10', okay: '#23704A' }) },
  // SOFT LIGHTS (Design note, 2026-11-16: […]; then, of a first cut whose
  // paper was only a dimmed white: […]). The paper is a MID tone,
  // about two thirds of the way from black to white by eye (L* 66 to 69, where ALABASTER is 96), under near-black
  // ink. It puts out about half the light of a bright dress; body text still stands at 7:1 or more.
  { id: 'linen', tone: 'soft-light', name: 'LINEN', theme: Object.freeze({ ground: '#ABA597', panel: '#A19A8C', ink: '#0C0C0C', trim: '#5A2E17', head: '#3F2413', body: '#1B1813', ital: '#3A3226', emph: '#0A0907', line: '#565144', alert: '#75130F', warn: '#4D3506', okay: '#0C4128' }) },
  { id: 'fog', tone: 'soft-light', name: 'FOG', theme: Object.freeze({ ground: '#A2A7AB', panel: '#989DA2', ink: '#0C0D10', trim: '#0E4054', head: '#0F3A4A', body: '#151A1E', ital: '#2E3A41', emph: '#07090B', line: '#4A5359', alert: '#751411', warn: '#4E3605', okay: '#0C442D' }) },
  { id: 'sage', tone: 'soft-light', name: 'SAGE', theme: Object.freeze({ ground: '#A3AA9E', panel: '#99A094', ink: '#0C100C', trim: '#18442C', head: '#153D26', body: '#161C16', ital: '#303D32', emph: '#070A07', line: '#4C564E', alert: '#751411', warn: '#4D3705', okay: '#0C443B' }) },
  { id: 'sand', tone: 'soft-light', name: 'SAND', theme: Object.freeze({ ground: '#A89F8C', panel: '#9E9580', ink: '#0C0C0A', trim: '#423208', head: '#40300A', body: '#15100C', ital: '#3D3320', emph: '#0A0804', line: '#564E3B', alert: '#6C110C', warn: '#502B05', okay: '#0C3D26' }) },
  { id: 'pewter', tone: 'soft-light', name: 'PEWTER', theme: Object.freeze({ ground: '#9BA0A6', panel: '#91969C', ink: '#0C0C0C', trim: '#1F3551', head: '#1A2C45', body: '#0C1014', ital: '#2C3640', emph: '#060809', line: '#464E54', alert: '#6C100D', warn: '#453004', okay: '#0C3C27' }) },
]);
