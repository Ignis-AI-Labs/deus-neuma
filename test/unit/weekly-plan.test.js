import { describe, test, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { createWeeklyPlanStore, validatePlanDays, WEEKDAYS } from '../../backend/services/marketing/weekly-plan.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'weekly-plan-'));
const PLAN_PATH = () => path.join(root, 'plan.json');

describe('the weekly plan store (real disk, real laws)', () => {
  const good = [
    { day: 'monday', theme: 'ship log', objective: 'show what moved this week', posts: 2 },
    { day: 'thursday', theme: 'the algorithm', objective: 'teach one mechanism', posts: 1 },
  ];

  // The real factory on THIS test's file — the per-house door
  // (weeklyPlanStoreFor) is proven in marketing-house-isolation.test.js.
  let store;
  beforeEach(async () => {
    store = createWeeklyPlanStore({ path: PLAN_PATH });
    await fs.rm(PLAN_PATH(), { force: true });
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  test('validatePlanDays: garbage is named, an empty week is a decision', () => {
    expect(validatePlanDays('nope')).toContain('must be a list');
    expect(validatePlanDays([{ day: 'funday', theme: 'x', objective: 'y' }])).toContain('day must be one of');
    expect(validatePlanDays([{ day: 'monday', theme: '', objective: 'y' }])).toContain('needs a theme');
    expect(validatePlanDays([{ day: 'monday', theme: 't', objective: 'y', posts: 99 }])).toContain('0–12');
    expect(validatePlanDays([])).toBeNull();
    expect(validatePlanDays(good)).toBeNull();
  });

  test('approve persists a LOCKED plan; todaysSlot serves the right day', async () => {
    expect(await store.todaysSlot()).toBeNull(); // nothing locked yet

    await store.approve(good);
    const doc = JSON.parse(await fs.readFile(PLAN_PATH(), 'utf8'));
    expect(doc.status).toBe('approved');
    expect(doc.approvedAt).toBeTruthy();
    expect(doc.days).toHaveLength(2);
    expect(doc.days[0].day).toBe('monday');

    // Today's slot — monday-first weekday math, from the REAL clock.
    const slot = await store.todaysSlot();
    const today = WEEKDAYS[(new Date().getUTCDay() + 6) % 7];
    if (today === 'monday') {
      expect(slot.theme).toBe('ship log');
      expect(slot.posts).toBe(2);
    } else if (today === 'thursday') {
      expect(slot.theme).toBe('the algorithm');
    } else {
      expect(slot).toBeNull(); // a planned-quiet day is honestly quiet
    }
  });

  test('a re-proposal REPLACES the old lock (the new lock is the truth)', async () => {
    await store.approve(good);
    await store.approve([{ day: 'friday', theme: 'community', objective: 'answer everyone', posts: 3 }]);
    const doc = JSON.parse(await fs.readFile(PLAN_PATH(), 'utf8'));
    expect(doc.days).toHaveLength(1);
    expect(doc.days[0].day).toBe('friday');
  });
});
