import { DEFAULT_BUDGET_CONFIG } from '../src/domain/models/Budget';
import { computeBadges, startOfWeek, weeklyChallenge } from '../src/domain/usecases/Gamification';
import { addDays, toLocalIso } from '../src/core/dates';
import { tx } from './helpers/inMemoryRepositories';

const shift = (iso: string, days: number) => toLocalIso(addDays(new Date(iso), days));

const NOW = new Date(2026, 9, 13, 10); // mardi
const base = {
  debts: [],
  plannedItems: [],
  savingsGoals: [],
  config: { ...DEFAULT_BUDGET_CONFIG, monthlyAirtimeLimit: 1000 },
  streak: 0,
  now: NOW,
};
const earned = (b: ReturnType<typeof computeBadges>) => b.filter(x => x.earned).map(x => x.id);

test('aucun badge sans données', () => {
  expect(earned(computeBadges({ ...base, transactions: [] }))).toEqual([]);
});

test('badges débloqués par les données', () => {
  const transactions = [
    tx({ source: 'SMS', occurredAt: '2026-10-02T10:00:00' }),
    tx({ type: 'FEE', amount: 100, occurredAt: '2026-09-10T10:00:00' }),
    tx({ type: 'FEE', amount: 40, occurredAt: '2026-10-10T10:00:00' }),
    tx({ type: 'AIRTIME_RECHARGE', amount: 500, occurredAt: '2026-10-10T10:00:00' }),
  ];
  const plan = (id: string) => ({
    id,
    month: '2026-10',
    label: id,
    amount: 1,
    kind: 'EXPENSE' as const,
    category: 'x',
    keywords: [],
    isDone: true,
    recurring: false,
  });
  const b = computeBadges({
    ...base,
    transactions,
    streak: 31,
    plannedItems: [plan('a'), plan('b'), plan('c')],
    savingsGoals: [
      {
        id: 'g',
        name: 'T',
        emoji: '🐏',
        targetAmount: 10,
        contributions: [{ date: 'x', amount: 10 }],
        createdAt: '2026-10-01',
      },
    ],
    debts: [
      {
        id: 'd',
        contactName: 'A',
        amount: 1,
        amountRepaid: 1,
        direction: 'OWED_BY_ME',
        isSettled: true,
        createdAt: 'c',
      },
    ],
  });
  expect(earned(b)).toEqual([
    'first-sms',
    'streak-7',
    'streak-30',
    'fee-hunter',
    'airtime-tamer',
    'planner',
    'saver',
    'debt-free',
  ]);
});

test('défi hebdomadaire : rotation, progression, jours restants', () => {
  expect(startOfWeek(NOW)).toEqual(new Date(2026, 9, 12));
  expect(startOfWeek(new Date(2026, 9, 18, 23))).toEqual(new Date(2026, 9, 12));
  const ids = new Set(
    [0, 7, 14, 21, 28].map(d => weeklyChallenge([], DEFAULT_BUDGET_CONFIG, new Date(2026, 9, 13 + d)).id),
  );
  expect(ids.size).toBe(4);
  const c = weeklyChallenge([], DEFAULT_BUDGET_CONFIG, NOW);
  expect(c.daysLeft).toBe(6);
  expect(weeklyChallenge([], DEFAULT_BUDGET_CONFIG, new Date(2026, 9, 18, 20)).daysLeft).toBe(1);

  const week = [
    tx({ type: 'AIRTIME_RECHARGE', amount: 100, occurredAt: '2026-10-12T08:00:00' }),
    tx({ type: 'AIRTIME_RECHARGE', amount: 100, occurredAt: '2026-10-13T08:00:00' }),
    tx({ type: 'EXPENSE', source: 'MANUAL', amount: 1000, occurredAt: '2026-10-13T08:00:00' }),
    tx({ type: 'FEE', amount: 600, occurredAt: '2026-10-13T08:00:00' }),
    tx({ type: 'AIRTIME_RECHARGE', amount: 100, occurredAt: '2026-10-11T08:00:00' }), // semaine précédente
  ];
  for (let d = 0; d < 28; d += 7) {
    const shifted = week.map(t => ({ ...t, occurredAt: shift(t.occurredAt, d) }));
    const ch = weeklyChallenge(shifted, DEFAULT_BUDGET_CONFIG, new Date(2026, 9, 13 + d, 12));
    if (ch.id === 'max-airtime-recharges') {
      expect(ch).toMatchObject({ current: 2, achieved: true }); // la recharge du dimanche précédent ne compte pas
    } else if (ch.id === 'note-cash') {
      expect(ch).toMatchObject({ current: 1, achieved: false, mode: 'MIN' });
    } else if (ch.id === 'max-fees') {
      expect(ch).toMatchObject({ current: 600, achieved: false });
    } else {
      expect(ch.mode).toBe('MAX');
    }
  }
});
