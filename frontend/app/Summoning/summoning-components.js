// summoning-components.js — what a being's summoning is MADE of, as rows a
// sheet can keep: every artifact its protocol drew, in the protocol's own
// order, read from its score. Pure.
//
// Design note, 2026-09-30: […]
// The sheet and the film read the same score, so they can never disagree.

/** A place on the Earth as it is read out: 13.6°N 61.3°W. Pure. */
export const latLon = ({ lat, lon }) => `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;

/**
 * Its components, in protocol order. Pure.
 * @param {ReturnType<import('./summoning-score.js').scoreOf>} score
 * @returns {Array<{ key: string, label: string, value: string, lights?: string[] }>}
 */
export const componentsOf = (score) => {
  const fig = (kind) => score.sections.find((s) => s.kind === kind)?.figure;
  const sigil = score.sections.find((s) => s.kind === 'sigil');
  const { soul } = score;
  const sky = fig('sky');
  const earth = fig('earth');
  const star = fig('star');
  const breath = fig('breath');
  const body = fig('body');
  return [
    { key: 'sky', label: 'ITS SKY', value: `${sky.bodies.length} BODIES · ${sky.aspects.filter((a) => a.angle > 0).length} ASPECTS` },
    { key: 'earth', label: 'ITS EARTH', value: `SUN OVERHEAD ${latLon(earth.subsolar)}` },
    { key: 'star', label: 'ITS STAR', value: `{${star.n}/${star.k}}` },
    { key: 'nucleus', label: 'ITS NUCLEUS', value: fig('solid').solid.toUpperCase() },
    { key: 'channels', label: 'ITS CHANNELS', value: `${sigil.channels.length} · ITS OWN PATTERN` },
    { key: 'breath', label: 'ITS BREATH', value: `${breath.a} : ${breath.b}` },
    { key: 'body', label: 'ITS BODY', value: body.plan === 'humanoid' ? `HUMANOID · ${body.sex.toUpperCase()} · ${body.heightCm} CM` : `${body.plan.toUpperCase()} · NON-HUMANOID` },
    { key: 'resonance', label: 'ITS RESONANCE', value: `${soul.tonic.toFixed(2)} HZ · ${soul.nm.toFixed(1)} NM`, lights: [soul.line] },
    { key: 'scale', label: 'ITS SCALE', value: `${soul.notes.length} NOTES · ITS OWN`, lights: soul.notes.map((n) => n.line) },
    { key: 'soul', label: 'ITS SOUL MARK', value: sigil.nibbles.map((n) => n.toString(16)).join('').toUpperCase() },
    { key: 'aura', label: 'ITS AURA', value: `${sigil.aura.carrier} · ${sigil.aura.coupling}` },
  ];
};
