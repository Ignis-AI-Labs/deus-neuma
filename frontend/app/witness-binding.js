/** Refresh an already-selected witness from its exact authoritative roster entry. Pure. */
export const reconcileWitnessBinding = (active, witnesses) => {
  if (!active?.neumaId || !Array.isArray(witnesses)) return active;
  const row = witnesses.find((entry) => entry?.neumaId === active.neumaId
    && entry.participantKind === 'witness' && entry.vendorSlug && entry.name);
  if (!row) return active;
  return {
    ...active,
    ...row,
    ...(active.witness ? {
      witness: { ...active.witness, vendorSlug: row.vendorSlug, chosenName: row.name },
    } : {}),
  };
};
