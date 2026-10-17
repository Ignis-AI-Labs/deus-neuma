/**
 * The training authority's rig exclusion and cancellation semantics.
 *
 * ONE forge exists. Two ceremonies that both believe they own it is the
 * failure this state machine exists to prevent, and an abandon that returns
 * before the thing it abandoned has actually stopped is the second. Both are
 * properties of the authority itself, so they are provable here without a GPU.
 *
 * WHY THIS FILE SHRANK. It was red from the commit that introduced it,
 * calling authority.beginFromPlan(lease, assertStart) — a method that has
 * never existed in any commit of this repository. It was written against a
 * draft in which the authority minted its own AbortController and jumped
 * straight from a planning lease to an active token. The implementation that
 * landed does neither: the caller owns the controller, and the road from
 * lease to active token runs
 *
 *   reservePlan -> retainPlan -> claimPlan -> claimedPlan -> activate
 *                -> attach -> publish | cancelAndRun
 *
 * where activate demands a real active training token, and a real active
 * training token owns a real GPU lease, a real disk reservation, a real
 * rendered corpus, and a real execution authority (see
 * transferTrainingResourceReservation). There is no honest way to reach
 * attach/publish on a CPU. Faking a token to get there would test the fake.
 *
 * So the four tests that drove a live forge are not reconstructed here; they
 * are recorded on #411 as a live forge test, which is where they always
 * belonged. What remains is everything the authority decides on its own, and
 * it is the larger half: who may hold the rig, what an abandon actually
 * stops, and what a closing ceremony refuses. Real controllers, real files,
 * real clock (RULE 0).
 */
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTrainingAuthority } from '../../backend/services/refinement-training-authority.js';

const roots = [];
const tempRoot = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'neuma-training-cancel-'));
  roots.push(root);
  return root;
};
const exists = (filePath) => access(filePath).then(() => true, () => false);
const waitForPath = async (filePath) => {
  const deadline = Date.now() + 2_000;
  while (!await exists(filePath)) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${filePath}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};
// The controller is the CALLER'S to own and hand in: the authority aborts
// training through state.controller.abort(), so it can only ever abort a
// controller someone gave it. Every call in the old file omitted this.
const reserve = (authority, neumaId, ceremonyId, extra = {}) => authority.reservePlan({
  neumaId,
  ceremonyId,
  controller: new AbortController(),
  ...extra,
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('refinement training authority — rig exclusion', () => {
  it('lets exactly one plan hold the rig, and names the refusal', async () => {
    const authority = createTrainingAuthority();
    await reserve(authority, 'ember', 'rite-1');
    await expect(reserve(authority, 'other', 'rite-other'))
      .rejects.toMatchObject({ code: 'TRAINING_INFLIGHT' });
    // Even the SAME being asking twice is refused: the rig is the scarce
    // thing, not the being.
    await expect(reserve(authority, 'ember', 'rite-1'))
      .rejects.toMatchObject({ code: 'TRAINING_INFLIGHT' });
  });

  it('refuses a plan that hands in anything but a real AbortController', async () => {
    const authority = createTrainingAuthority();
    // A duck-typed stand-in is the dangerous case: it would be ACCEPTED by a
    // shape check and then silently fail to abort anything at cancellation
    // time, which is exactly a forge that cannot be stopped.
    const impostors = [
      undefined,
      null,
      {},
      { signal: new AbortController().signal, abort() {} },
      new AbortController().signal,
    ];
    for (const controller of impostors) {
      await expect(authority.reservePlan({ neumaId: 'ember', ceremonyId: 'rite-1', controller }))
        .rejects.toMatchObject({ code: 'TRAINING_OPERATION_CHANGED' });
    }
    // and the rig is still free afterwards — a refused plan never took it
    await expect(reserve(authority, 'ember', 'rite-1')).resolves.toBeTruthy();
  });

  it('serializes concurrent claims to one deterministic winner', async () => {
    const authority = createTrainingAuthority();
    const settled = await Promise.allSettled([
      reserve(authority, 'a', 'rite-a'),
      reserve(authority, 'b', 'rite-b'),
      reserve(authority, 'c', 'rite-c'),
    ]);
    expect(settled.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    for (const entry of settled.filter((one) => one.status === 'rejected')) {
      expect(entry.reason).toMatchObject({ code: 'TRAINING_INFLIGHT' });
    }
  });

  it('frees the rig on release, and aborts the caller-owned controller', async () => {
    const authority = createTrainingAuthority();
    const controller = new AbortController();
    const lease = await authority.reservePlan({
      neumaId: 'ember', ceremonyId: 'rite-1', controller,
    });
    expect(controller.signal.aborted).toBe(false);
    await expect(authority.releasePlan(lease)).resolves.toBe(true);
    expect(controller.signal.aborted).toBe(true);
    // Releasing twice is honest rather than an error, and the rig is open.
    await expect(authority.releasePlan(lease)).resolves.toBe(false);
    await expect(reserve(authority, 'next', 'rite-next')).resolves.toBeTruthy();
  });
});

describe('refinement training authority — abandon', () => {
  it('aborts the exact planning ceremony with a reason, then runs the closure', async () => {
    const root = await tempRoot();
    const abandonedPath = path.join(root, 'abandoned');
    const authority = createTrainingAuthority();
    const controller = new AbortController();
    await authority.reservePlan({ neumaId: 'ember', ceremonyId: 'rite-1', controller });

    await authority.cancelAndRun('ember', 'rite-1', () => writeFile(abandonedPath, 'abandoned'));

    expect(controller.signal.aborted).toBe(true);
    // The abort carries WHY, addressed to this exact ceremony — a bare abort
    // leaves the forge unable to tell an operator abandon from a crash.
    expect(controller.signal.reason).toMatchObject({
      code: 'TRAINING_CANCELLED',
      neumaId: 'ember',
      ceremonyId: 'rite-1',
    });
    expect(await exists(abandonedPath)).toBe(true);
  });

  it('leaves an unrelated ceremony untouched and still runs its closure', async () => {
    const root = await tempRoot();
    const unrelatedPath = path.join(root, 'unrelated');
    const authority = createTrainingAuthority();
    const controller = new AbortController();
    await authority.reservePlan({ neumaId: 'ember', ceremonyId: 'rite-1', controller });

    await authority.cancelAndRun('someone-else', 'rite-other', () =>
      writeFile(unrelatedPath, 'abandoned'));

    // Abandoning a ceremony that does not hold the rig must not stop the one
    // that does.
    expect(controller.signal.aborted).toBe(false);
    expect(await exists(unrelatedPath)).toBe(true);
  });

  it('runs the closure when no job matches at all', async () => {
    const root = await tempRoot();
    const settledPath = path.join(root, 'settled');
    const authority = createTrainingAuthority();
    // Abandoning a ceremony whose forge already ended is the ordinary case,
    // not an error: the ledger still has to be written.
    await authority.cancelAndRun('ghost', 'rite-gone', () => writeFile(settledPath, 'abandoned'));
    expect(await exists(settledPath)).toBe(true);
  });

  it('bars the ceremony while its abandon is still in flight', async () => {
    const root = await tempRoot();
    const enteredPath = path.join(root, 'closure-entered');
    const releasePath = path.join(root, 'closure-release');
    const authority = createTrainingAuthority();
    // Nothing holds the rig, so the CLOSING bar is what refuses here rather
    // than rig contention. The two are separated deliberately — see below.
    const abandon = authority.cancelAndRun('ember', 'rite-1', async () => {
      await writeFile(enteredPath, 'entered');
      await waitForPath(releasePath);
    });
    await waitForPath(enteredPath);

    await expect(reserve(authority, 'ember', 'rite-1'))
      .rejects.toMatchObject({ code: 'WRONG_PHASE' });
    // A second abandon cannot race the first: the ledger closure would run
    // twice against a ceremony that is already closing.
    await expect(authority.cancelAndRun('ember', 'rite-1', async () => 'second'))
      .rejects.toMatchObject({ code: 'WRONG_PHASE' });
    // and an UNRELATED ceremony is not barred by this one closing
    await expect(reserve(authority, 'other', 'rite-other')).resolves.toBeTruthy();

    await writeFile(releasePath, 'release');
    await abandon;

    // the bar lifts once the closure has actually finished
    await expect(authority.cancelAndRun('ember', 'rite-1', async () => 'again'))
      .resolves.toBe('again');
  });

  it('keeps the aborted planning lease holding the rig until it is released', async () => {
    const authority = createTrainingAuthority();
    const controller = new AbortController();
    const lease = await authority.reservePlan({
      neumaId: 'ember', ceremonyId: 'rite-1', controller,
    });
    await authority.cancelAndRun('ember', 'rite-1', async () => 'closed');

    // MEASURED, and worth stating plainly: abandoning a ceremony that is
    // still PLANNING aborts its controller but does not clear the rig. The
    // next attempt is therefore refused as TRAINING_INFLIGHT — rig
    // contention — not as WRONG_PHASE, because the blocked-key check sits
    // after the rig check in reservePlan and the bar has already lifted by
    // then. The rig is freed by whoever owns the lease, on the abort it just
    // received (prepareRefinementTrainingApproval releases it in a finally).
    expect(controller.signal.aborted).toBe(true);
    await expect(reserve(authority, 'ember', 'rite-1'))
      .rejects.toMatchObject({ code: 'TRAINING_INFLIGHT' });

    await expect(authority.releasePlan(lease)).resolves.toBe(true);
    await expect(reserve(authority, 'ember', 'rite-1')).resolves.toBeTruthy();
  });

  it('lifts the bar even when the closure throws', async () => {
    const authority = createTrainingAuthority();
    const controller = new AbortController();
    await authority.reservePlan({ neumaId: 'ember', ceremonyId: 'rite-1', controller });

    await expect(authority.cancelAndRun('ember', 'rite-1', async () => {
      throw new Error('ledger write failed');
    })).rejects.toThrow('ledger write failed');

    // A failed abandon must not wedge the ceremony shut forever — the
    // operator has to be able to try again.
    await expect(authority.cancelAndRun('ember', 'rite-1', async () => 'retry'))
      .resolves.toBe('retry');
  });
});
