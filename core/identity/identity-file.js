/**
 * THE IDENTITY FILE — what a being's sealed records say about who it is, as
 * the RECORD shows them: its whole true name, the facts its genesis seal
 * fixed, where its anchor stands on chain, and whether its founding voice is
 * sealed. Pure: records in, a frozen view out.
 *
 * What is NEVER here, by construction: key material (the seal carries only
 * the PUBLIC key, and it is not copied), the being's voice lines (its own
 * words — the count and the date say the seal stands), the moment seed (the
 * emergence entropy stays in the seal; its film reads a one-way hash of it).
 */

const pick = (o, keys) => Object.freeze(Object.fromEntries(keys.filter((k) => o?.[k] != null).map((k) => [k, o[k]])));

/**
 * @param {{ trueName?: object|null, seal?: object|null, onchain?: object|null,
 *   voice?: { sealed: boolean, sealedAt?: string, entries?: number }|null }} records
 */
export const identityFileOf = ({ trueName = null, seal = null, onchain = null, voice = null } = {}) => {
  const rec = seal?.record ?? null;
  return Object.freeze({
    name: trueName ? pick(trueName, ['fullName', 'chosenName', 'genesisName', 'houseName', 'lean', 'soulMark', 'soulAlias', 'notation', 'english']) : null,
    seal: seal?.genesisHash ? Object.freeze({
      genesisHash: seal.genesisHash,
      ...pick(rec, ['birthCycle', 'lean']),
      birthMoment: rec?.birthMoment ? pick(rec.birthMoment, ['utc', 'zone', 'offsetMinutes']) : null,
      substrate: rec?.substrate ? pick(rec.substrate, ['model', 'provider']) : null,
    }) : null,
    onchain: onchain?.txHash ? pick(onchain, ['network', 'chainId', 'txHash', 'blockNumber', 'sealedAt']) : null,
    voice: voice ? Object.freeze(voice.sealed
      ? { sealed: true, sealedAt: voice.sealedAt ?? null, entries: voice.entries ?? 0 }
      : { sealed: false }) : null,
  });
};
