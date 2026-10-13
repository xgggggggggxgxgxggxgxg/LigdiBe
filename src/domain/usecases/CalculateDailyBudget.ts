import { addDays, dayKey, daysInMonth, isWeekendWindow, monthKey, startOfDay, yearKey } from '../../core/dates';
import type { BudgetConfig } from '../models/Budget';
import { isSpending, type Transaction } from '../models/Transaction';

export type BudgetStatus = 'OK' | 'WARNING' | 'EXCEEDED';

export interface DailyBudgetResult {
  /** Enveloppe autorisée aujourd'hui (pondération incluse). */
  todayBudget: number;
  todaySpent: number;
  todayRemaining: number;
  /** Ratio dépensé / enveloppe (peut dépasser 1). */
  progress: number;
  status: BudgetStatus;
  /** Coefficient appliqué aujourd'hui (1, week-end, jour spécial). */
  todayMultiplier: number;
  /** Vrai entre vendredi 18h et dimanche 23h59. */
  isWeekendBoostActive: boolean;
  /** Enveloppe d'un jour « normal » (coefficient 1). */
  baseDailyUnit: number;
  monthSpent: number;
  monthSpentBeforeToday: number;
  remainingFixedExpenses: number;
  /** Budget disponible pour le reste du mois (après charges fixes restantes). */
  availableForRestOfMonth: number;
  remainingDays: number;
  monthProgress: number;
  /** Projection de fin de mois au rythme actuel. */
  projectedMonthSpent: number;
  yearSpent: number;
  yearProgress?: number;
}

/**
 * Poids d'une journée dans la répartition du budget :
 * - jour spécial paramétré → son coefficient,
 * - samedi / dimanche → coefficient week-end,
 * - vendredi → 1 + (coef - 1) × 6/24 (seule la soirée 18h-24h est surpondérée),
 * - autre → 1.
 */
export const dayWeight = (date: Date, config: Pick<BudgetConfig, 'weekendMultiplier' | 'specialDays'>): number => {
  const special = config.specialDays.find(s => s.date === dayKey(date));
  if (special) {
    return special.multiplier;
  }
  const m = config.weekendMultiplier;
  const day = date.getDay();
  if (day === 0 || day === 6) {
    return m;
  }
  if (day === 5) {
    return 1 + (m - 1) * (6 / 24);
  }
  return 1;
};

const sumSpending = (txs: ReadonlyArray<Transaction>): number =>
  txs.filter(isSpending).reduce((s, t) => s + t.amount, 0);

/**
 * Budget quotidien adaptatif :
 *   unité = (budget mensuel − dépensé avant aujourd'hui − charges fixes restantes) / Σ poids(jours restants)
 *   enveloppe du jour = unité × poids(aujourd'hui)
 * Le budget se ré-équilibre automatiquement chaque jour : un excès hier réduit
 * l'enveloppe des jours suivants, une économie l'augmente.
 */
export const calculateDailyBudget = (
  config: BudgetConfig,
  transactions: ReadonlyArray<Transaction>,
  now: Date,
  paidFixedExpenseIds: ReadonlyArray<string> = [],
): DailyBudgetResult => {
  const today = startOfDay(now);
  const todayKey = dayKey(now);
  const month = monthKey(now);
  const monthTxs = transactions.filter(t => t.occurredAt.startsWith(month));
  const todayTxs = monthTxs.filter(t => t.occurredAt.startsWith(todayKey));
  const monthSpent = sumSpending(monthTxs);
  const todaySpent = sumSpending(todayTxs);
  const monthSpentBeforeToday = monthSpent - todaySpent;

  const remainingFixedExpenses = config.fixedExpenses
    .filter(f => f.dayOfMonth >= now.getDate() && !paidFixedExpenseIds.includes(f.id))
    .reduce((s, f) => s + f.amount, 0);

  const totalDays = daysInMonth(now);
  const remainingDays = totalDays - now.getDate() + 1;
  let units = 0;
  for (let i = 0; i < remainingDays; i++) {
    units += dayWeight(addDays(today, i), config);
  }
  const availableForRestOfMonth = config.monthlyBudget - monthSpentBeforeToday - remainingFixedExpenses;
  const baseDailyUnit = Math.max(0, availableForRestOfMonth) / units;
  const todayMultiplier = dayWeight(today, config);
  const todayBudget = baseDailyUnit * todayMultiplier;
  const progress = todayBudget > 0 ? todaySpent / todayBudget : todaySpent > 0 ? Infinity : 0;
  const status: BudgetStatus = progress > 1 ? 'EXCEEDED' : progress >= 0.8 ? 'WARNING' : 'OK';

  const year = yearKey(now);
  const yearSpent = sumSpending(transactions.filter(t => t.occurredAt.startsWith(year)));
  const elapsedDays = now.getDate();

  return {
    todayBudget: Math.round(todayBudget),
    todaySpent,
    todayRemaining: Math.round(todayBudget - todaySpent),
    progress,
    status,
    todayMultiplier,
    isWeekendBoostActive: isWeekendWindow(now),
    baseDailyUnit: Math.round(baseDailyUnit),
    monthSpent,
    monthSpentBeforeToday,
    remainingFixedExpenses,
    availableForRestOfMonth,
    remainingDays,
    monthProgress: config.monthlyBudget > 0 ? monthSpent / config.monthlyBudget : 0,
    projectedMonthSpent: Math.round((monthSpent / elapsedDays) * totalDays),
    yearSpent,
    yearProgress: config.yearlyBudget > 0 ? yearSpent / config.yearlyBudget : undefined,
  };
};

/**
 * Série de jours consécutifs (jusqu'à hier inclus) où les dépenses sont restées
 * sous l'enveloppe théorique du jour — moteur de gamification (« flamme »).
 */
export const computeBudgetStreak = (
  config: BudgetConfig,
  transactions: ReadonlyArray<Transaction>,
  now: Date,
  maxDays = 365,
): number => {
  const byDay = new Map<string, number>();
  for (const t of transactions) {
    if (isSpending(t)) {
      const k = t.occurredAt.slice(0, 10);
      byDay.set(k, (byDay.get(k) ?? 0) + t.amount);
    }
  }
  if (byDay.size === 0) {
    return 0;
  }
  const firstDay = [...byDay.keys()].sort()[0];
  let streak = 0;
  for (let i = 1; i <= maxDays; i++) {
    const d = addDays(startOfDay(now), -i);
    if (dayKey(d) < firstDay) {
      break;
    }
    const fixed = config.fixedExpenses.reduce((s, f) => s + f.amount, 0);
    const target = (Math.max(0, config.monthlyBudget - fixed) / daysInMonth(d)) * dayWeight(d, config);
    if ((byDay.get(dayKey(d)) ?? 0) > target) {
      break;
    }
    streak++;
  }
  return streak;
};
