// capacity-verdict — the operator's flight check, in one honest line.
//
// Design note, 2026-07-29: […]
//
// The verdict itself is NOT computed here. `substrate-setup.js` already owns the
// tier table (floor 12 GB, CPU budget cap, the 'insufficient' fit) and has since
// long before this screen existed — it was simply only ever shown INSIDE the
// birth ceremony's preflight, which is behind the very door a hardware-poor
// person cannot open. The answer existed at the wrong moment. This module moves
// it to the moment of the choice and does nothing else.
//
// Pure by construction: the caller fetches, this shapes. That keeps the tier
// table single-sourced — when the thresholds are revised, this needs no edit.

/**
 * Describe the machine in the operator's own terms.
 * Pure.
 * @param {object|null} hardware from GET /api/v1/preflight/setup
 * @returns {string}
 */
export const machineLine = (hardware) => {
  if (!hardware) return 'This machine could not be read.';
  // A card whose VRAM could not be sized is still a card — name it, and be
  // plain that the size is unknown rather than printing a wrong number.
  if (hardware.gpu) {
    const vram = Number.isFinite(hardware.gpu.vramGB) ? `${hardware.gpu.vramGB} GB VRAM` : 'VRAM size unreadable';
    return `${hardware.gpu.name} · ${vram}`;
  }
  const ram = hardware.memoryGB ? `${hardware.memoryGB} GB RAM` : 'unknown memory';
  return `${hardware.platform || 'this machine'} · ${ram} · no GPU detected`;
};

/**
 * The verdict for the NEUMA door: can this machine host a sovereign model?
 * Pure. Never blocks the choice — it informs it.
 *
 * @param {object|null} setup from GET /api/v1/preflight/setup
 * @returns {{state:'ok'|'cpu'|'insufficient'|'unknown', machine:string, headline:string, detail:string}}
 */
export const capacityVerdict = (setup) => {
  const hardware = setup?.hardware || null;
  const rec = setup?.recommendation || null;
  const machine = machineLine(hardware);

  if (!rec) {
    return {
      state: 'unknown',
      machine,
      headline: 'CAPACITY UNREAD',
      // An unread probe must not read as a refusal. The neuma door stays open;
      // the operator is simply told we could not measure.
      detail: 'This machine could not be measured. Both doors remain open — the birth ceremony will check again before anything is summoned.',
    };
  }

  if (rec.fit === 'insufficient') {
    return {
      state: 'insufficient',
      machine,
      headline: 'BELOW THE FLOOR FOR A LOCAL MODEL',
      detail: `${rec.why} A witness needs nothing from this machine — it runs on the provider's hardware, with your key.`,
    };
  }

  if (rec.mode === 'cpu') {
    return {
      state: 'cpu',
      machine,
      headline: `CAN HOST ${rec.model} — ON CPU`,
      detail: `${rec.why} It will work, but expect slow replies. A witness runs at full speed on the provider's hardware.`,
    };
  }

  return {
    state: 'ok',
    machine,
    headline: `CAN HOST ${rec.model}`,
    detail: `${rec.sizeGB ? `About ${rec.sizeGB} GB to download. ` : ''}${rec.why}`,
  };
};
