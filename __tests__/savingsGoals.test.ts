import { runMigrations } from '../src/data/database/schema';
import { createSqliteRepositories } from '../src/data/repositories/SqliteRepositories';
import type { SavingsGoal } from '../src/domain/models/SavingsGoal';
import { goalMotivation, goalStatus } from '../src/domain/usecases/SavingsGoals';
import { configureFinanceStore, useFinanceStore } from '../src/presentation/store/useFinanceStore';
import { createInMemoryRepositories } from './helpers/inMemoryRepositories';
import { createNodeSqliteDatabase } from './helpers/nodeSqliteDatabase';

const NOW = new Date(2026, 9, 13, 10);
const goal = (over: Partial<SavingsGoal> = {}): SavingsGoal => ({
  id: 'g',
  name: 'Tabaski',
  emoji: '🐏',
  targetAmount: 150000,
  deadline: '2026-11-12',
  contributions: [],
  createdAt: '2026-10-03T08:00:00',
  ...over,
});

describe('goalStatus', () => {
  test('progression, effort quotidien et hebdomadaire', () => {
    const s = goalStatus(goal({ contributions: [{ date: 'x', amount: 30000 }] }), NOW);
    expect(s).toMatchObject({
      saved: 30000,
      remaining: 120000,
      progress: 0.2,
      isReached: false,
      daysLeft: 30,
      perDayNeeded: 4000,
      perWeekNeeded: 28000,
      isOverdue: false,
    });
    // rythme 3 000/jour sur 10 jours → 90 000 en 30 jours < 120 000
    expect(s.onTrack).toBe(false);
    expect(goalStatus(goal({ contributions: [{ date: 'x', amount: 60000 }] }), NOW).onTrack).toBe(true);
  });

  test('atteint, en retard, sans échéance, retraits', () => {
    expect(goalStatus(goal({ contributions: [{ date: 'x', amount: 200000 }] }), NOW)).toMatchObject({
      isReached: true,
      progress: 1,
      onTrack: true,
    });
    expect(goalStatus(goal({ deadline: '2026-10-01' }), NOW)).toMatchObject({
      isOverdue: true,
      daysLeft: -12,
      perDayNeeded: 150000,
    });
    expect(goalStatus(goal({ deadline: undefined }), NOW)).toEqual({
      saved: 0,
      remaining: 150000,
      progress: 0,
      isReached: false,
      isOverdue: false,
    });
    expect(
      goalStatus(
        goal({
          contributions: [
            { date: 'x', amount: 10000 },
            { date: 'y', amount: -15000 },
          ],
        }),
        NOW,
      ).saved,
    ).toBe(0);
    expect(goalStatus(goal({ targetAmount: 0 }), NOW).progress).toBe(1);
  });

  test('messages de motivation', () => {
    const m = (g: SavingsGoal) => goalMotivation(g, goalStatus(g, NOW));
    expect(m(goal({ contributions: [{ date: 'x', amount: 150000 }] }))).toMatch(/atteint/);
    expect(m(goal({ deadline: '2026-10-01' }))).toMatch(/échéance est passée/);
    expect(m(goal({ contributions: [{ date: 'x', amount: 120000 }] }))).toMatch(/80 %/);
    expect(m(goal())).toMatch(/5000 FCFA de côté par jour/);
    expect(m(goal({ deadline: undefined }))).toMatch(/0 % atteint/);
  });
});

describe('Objectifs : persistance et store', () => {
  test('dépôt SQLite (migration v2)', async () => {
    const db = createNodeSqliteDatabase();
    await runMigrations(db);
    const repos = createSqliteRepositories(db);
    await repos.savingsGoals.save(goal());
    await repos.savingsGoals.save(goal({ id: 'h', deadline: undefined, contributions: [{ date: 'd', amount: 5 }] }));
    expect(await repos.savingsGoals.getAll()).toEqual([
      goal(),
      goal({ id: 'h', deadline: undefined, contributions: [{ date: 'd', amount: 5 }] }),
    ]);
    await repos.savingsGoals.delete('g');
    expect(await repos.savingsGoals.getAll()).toHaveLength(1);
  });

  test('store : création, versement, suppression', async () => {
    const repos = createInMemoryRepositories();
    configureFinanceStore(async () => repos);
    const store = useFinanceStore.getState;
    await store().hydrate(NOW);
    await store().saveGoal({ name: 'Rentrée', emoji: '🎒', targetAmount: 80000 });
    const id = store().savingsGoals[0].id;
    await store().contributeToGoal(id, 5000);
    await store().contributeToGoal(id, 0);
    await store().contributeToGoal('nope', 10);
    expect(store().savingsGoals[0].contributions).toHaveLength(1);
    await store().hydrate(NOW);
    expect(store().savingsGoals).toHaveLength(1);
    await store().deleteGoal(id);
    expect(store().savingsGoals).toEqual([]);
  });
});
