import { DEFAULT_BUDGET_CONFIG, type BudgetConfig } from '../src/domain/models/Budget';
import { calculateDailyBudget, computeBudgetStreak, dayWeight } from '../src/domain/usecases/CalculateDailyBudget';
import { tx } from './helpers/inMemoryRepositories';

const config: BudgetConfig = { ...DEFAULT_BUDGET_CONFIG, monthlyBudget: 150000, weekendMultiplier: 1.5 };
// Octobre 2026 : 31 jours, le 13 est un mardi, le 16 un vendredi, le 17 un samedi.
const TUESDAY = new Date(2026, 9, 13, 10, 0);

describe('dayWeight - pondération week-end', () => {
  test('semaine = 1, vendredi soirée partiellement surpondérée, samedi/dimanche = coef', () => {
    expect(dayWeight(new Date(2026, 9, 13), config)).toBe(1);
    expect(dayWeight(new Date(2026, 9, 16), config)).toBeCloseTo(1.125);
    expect(dayWeight(new Date(2026, 9, 17), config)).toBe(1.5);
    expect(dayWeight(new Date(2026, 9, 18), config)).toBe(1.5);
  });

  test('un jour spécial (Tabaski) prime sur la règle week-end', () => {
    const c = { ...config, specialDays: [{ date: '2026-10-17', multiplier: 3, label: 'Fête' }] };
    expect(dayWeight(new Date(2026, 9, 17), c)).toBe(3);
  });
});

describe('calculateDailyBudget', () => {
  test('formule (budget disponible − charges fixes) / jours restants pondérés', () => {
    const r = calculateDailyBudget(config, [], TUESDAY);
    // 19 jours restants : 11 × 1 + 3 vendredis × 1.125 + 5 jours de week-end × 1.5 = 21.875 unités
    expect(r.remainingDays).toBe(19);
    expect(r.baseDailyUnit).toBe(Math.round(150000 / 21.875));
    expect(r.todayBudget).toBe(6857);
    expect(r.todayMultiplier).toBe(1);
    expect(r.isWeekendBoostActive).toBe(false);
    expect(r.status).toBe('OK');
    expect(r.progress).toBe(0);
  });

  test('samedi : enveloppe multipliée par 1.5 et boost week-end actif', () => {
    const r = calculateDailyBudget(config, [], new Date(2026, 9, 17, 12));
    expect(r.todayMultiplier).toBe(1.5);
    expect(r.isWeekendBoostActive).toBe(true);
    expect(r.todayBudget).toBe(Math.round((150000 / 17.75) * 1.5));
  });

  test('les charges fixes restantes et les dépenses passées réduisent l’enveloppe', () => {
    const c = { ...config, fixedExpenses: [
      { id: 'loyer', label: 'Loyer', amount: 50000, dayOfMonth: 28 },
      { id: 'canal', label: 'Canal+', amount: 10000, dayOfMonth: 5 },
    ] };
    const txs = [
      tx({ amount: 20000, occurredAt: '2026-10-02T09:00:00' }),
      tx({ type: 'CASH_WITHDRAWAL', amount: 50000, occurredAt: '2026-10-03T09:00:00' }),
      tx({ type: 'CASH_DEPOSIT', amount: 50000, occurredAt: '2026-10-03T09:00:00' }),
      tx({ type: 'INCOME', amount: 300000, occurredAt: '2026-10-01T09:00:00' }),
      tx({ amount: 5000, occurredAt: '2026-09-30T09:00:00' }),
    ];
    const r = calculateDailyBudget(c, txs, TUESDAY);
    expect(r.monthSpentBeforeToday).toBe(20000); // le retrait cash n'est PAS une dépense
    expect(r.remainingFixedExpenses).toBe(50000); // Canal+ (le 5) déjà passé
    expect(r.availableForRestOfMonth).toBe(80000);
    expect(r.todayBudget).toBe(Math.round(80000 / 21.875));
  });

  test('charge fixe marquée payée exclue', () => {
    const c = { ...config, fixedExpenses: [{ id: 'loyer', label: 'Loyer', amount: 50000, dayOfMonth: 28 }] };
    expect(calculateDailyBudget(c, [], TUESDAY, ['loyer']).remainingFixedExpenses).toBe(0);
  });

  test('statuts WARNING / EXCEEDED et projection', () => {
    const warn = calculateDailyBudget(config, [tx({ amount: 6000, occurredAt: '2026-10-13T08:00:00' })], TUESDAY);
    expect(warn.status).toBe('WARNING');
    expect(warn.todayRemaining).toBe(857);
    const over = calculateDailyBudget(
      config,
      [tx({ amount: 8000, occurredAt: '2026-10-13T08:00:00' }), tx({ type: 'FEE', amount: 100, occurredAt: '2026-10-13T08:00:00' })],
      TUESDAY,
    );
    expect(over.status).toBe('EXCEEDED');
    expect(over.todaySpent).toBe(8100);
    expect(over.monthProgress).toBeCloseTo(8100 / 150000);
    expect(over.projectedMonthSpent).toBe(Math.round((8100 / 13) * 31));
  });

  test('budget épuisé : enveloppe nulle, progression infinie si dépense', () => {
    const r = calculateDailyBudget(
      { ...config, monthlyBudget: 1000 },
      [tx({ amount: 5000, occurredAt: '2026-10-01T08:00:00' }), tx({ amount: 10, occurredAt: '2026-10-13T08:00:00' })],
      TUESDAY,
    );
    expect(r.todayBudget).toBe(0);
    expect(r.progress).toBe(Infinity);
    expect(r.status).toBe('EXCEEDED');
    const zero = calculateDailyBudget({ ...config, monthlyBudget: 0 }, [], TUESDAY);
    expect(zero.progress).toBe(0);
    expect(zero.monthProgress).toBe(0);
  });

  test('budget annuel optionnel', () => {
    expect(calculateDailyBudget(config, [], TUESDAY).yearProgress).toBeUndefined();
    const r = calculateDailyBudget({ ...config, yearlyBudget: 1000000 }, [tx({ amount: 100000, occurredAt: '2026-03-01T08:00:00' })], TUESDAY);
    expect(r.yearSpent).toBe(100000);
    expect(r.yearProgress).toBeCloseTo(0.1);
  });
});

describe('computeBudgetStreak', () => {
  test('compte les jours consécutifs sous l’objectif jusqu’à hier', () => {
    const txs = [
      tx({ amount: 1000, occurredAt: '2026-10-08T10:00:00' }),
      tx({ amount: 99999, occurredAt: '2026-10-09T10:00:00' }), // dépassement
      tx({ amount: 1000, occurredAt: '2026-10-10T10:00:00' }),
      tx({ amount: 2000, occurredAt: '2026-10-12T10:00:00' }),
    ];
    expect(computeBudgetStreak(config, txs, TUESDAY)).toBe(3); // 10, 11, 12
  });

  test('aucun historique = 0, borne au premier jour d’usage', () => {
    expect(computeBudgetStreak(config, [], TUESDAY)).toBe(0);
    expect(computeBudgetStreak(config, [tx({ amount: 10, occurredAt: '2026-10-11T10:00:00' })], TUESDAY)).toBe(2);
    expect(computeBudgetStreak(config, [tx({ amount: 10, occurredAt: '2025-10-11T10:00:00' })], TUESDAY, 5)).toBe(5);
  });
});
