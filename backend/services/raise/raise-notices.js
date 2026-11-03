// The raise room tells the operator what only they can do — sign a mandate,
// carry counsel's review back. The floor: it reaches them at every dial stop.
// A notice that cannot land is logged, never thrown: the draft stands, and
// WAITING ON YOU carries it.
// impure (notification bus).

import { notifyOperator } from '../notification-bus.js';
import { KIND, STANDING } from '../../../core/runtime/notification-record.js';
import { createLogger } from '../logger.js';

const log = createLogger('Raise.Notices');

/** @param {{wallet: string, company: object, title: string, detail: string, by: string, ref: object}} args */
export const announceRaise = async ({ wallet, company, title, detail, by, ref }) => {
  try {
    await notifyOperator({ wallet, kind: KIND.companyLine, standing: STANDING.system, title, detail, actor: { id: by, name: by }, ref: { companyId: company.id, ...ref } });
  } catch (err) {
    log.warn('A raise notice did not land — WAITING ON YOU still carries it', { company: company.id, err: err.message });
  }
};
