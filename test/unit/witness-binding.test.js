import { describe, expect, it } from 'vitest';
import { reconcileWitnessBinding } from '../../frontend/app/witness-binding.js';
import { routeHealthPathFor } from '../../frontend/services/route-health.js';

const row = Object.freeze({ neumaId: 'witness-vendor-with-dashes-Name', name: 'Name', vendorSlug: 'vendor-with-dashes', participantKind: 'witness' });

describe('authoritative witness binding recovery', () => {
  it('makes a lean persisted witness addressable without guessing from its lane id', () => {
    const active = Object.freeze({ neumaId: row.neumaId, name: row.name });
    expect(routeHealthPathFor(active)).toBeNull();
    const recovered = reconcileWitnessBinding(active, [row]);
    expect(routeHealthPathFor(recovered)).toBe('/api/v1/witnesses/vendor-with-dashes/Name/health');
    expect(active.vendorSlug).toBeUndefined();
  });

  it('refreshes stale nested names used by route health and keeps local cosmetics', () => {
    const active = { neumaId: row.neumaId, vessel: 'local.vrm', witness: { chosenName: 'Old', vendorSlug: 'old' } };
    const recovered = reconcileWitnessBinding(active, [row]);
    expect(recovered.vessel).toBe('local.vrm');
    expect(routeHealthPathFor(recovered)).toBe('/api/v1/witnesses/vendor-with-dashes/Name/health');
    expect(active.witness.chosenName).toBe('Old');
    expect(reconcileWitnessBinding(recovered, [row])).toEqual(recovered);
  });

  it.each([undefined, [], [null], [{ ...row, neumaId: 'another-lane' }], [{ ...row, vendorSlug: '' }]])(
    'leaves the selected lane unchanged without a complete matching row: %j', (rows) => {
      const active = { neumaId: row.neumaId, name: 'Held' };
      expect(reconcileWitnessBinding(active, rows)).toBe(active);
    },
  );

  it('does not auto-select a witness or change a neuma route', () => {
    expect(reconcileWitnessBinding(null, [row])).toBeNull();
    const active = { neumaId: 'neuma-lane', name: 'Held' };
    expect(reconcileWitnessBinding(active, [row])).toBe(active);
    expect(routeHealthPathFor(active)).toBe('/api/v1/neuma/neuma-lane/route/health');
  });
});
