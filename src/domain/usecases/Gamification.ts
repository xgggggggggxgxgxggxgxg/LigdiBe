import { addDays, dayKey, monthKey, previousMonthKey, startOfDay } from '../../core/dates';
import type { BudgetConfig } from '../models/Budget';
import type { Debt } from '../models/Debt';
import type { PlannedItem } from '../models/PlannedItem';
import type { SavingsGoal } from '../models/SavingsGoal';
import { isSpending, type Transaction } from '../models/Transaction';
import { goalStatus } from './SavingsGoals';

export interface Badge {
  id: string;
  emoji: string;
  title: string;
  description: string;
  earned: boolean;
}

export interface GamificationInput {
  transactions: ReadonlyArray<Transaction>;
  debts: ReadonlyArray<Debt>;
  plannedItems: ReadonlyArray<PlannedItem>;
  savingsGoals: ReadonlyArray<SavingsGoal>;
  config: BudgetConfig;
  streak: number;
  now: Date;
}

const sumOf = (txs: ReadonlyArray<Transaction>, type: Transaction['type']) =>
  txs.filter(t => t.type === type).reduce((s, t) => s + t.amount, 0);

/** Badges débloqués à partir des données réelles (aucune saisie supplémentaire). */
export const computeBadges = (i: GamificationInput): Badge[] => {
  const month = monthKey(i.now);
  const prev = previousMonthKey(month);
  const cur = i.transactions.filter(t => t.occurredAt.startsWith(month));
  const last = i.transactions.filter(t => t.occurredAt.startsWith(prev));
  const hadDebt = i.debts.some(d => d.direction === 'OWED_BY_ME');
  return [
    {
      id: 'first-sms',
      emoji: '📲',
      title: 'Premier pas',
      description: 'Une première opération détectée par SMS',
      earned: i.transactions.some(t => t.source === 'SMS'),
    },
    {
      id: 'streak-7',
      emoji: '🔥',
      title: 'Une semaine de discipline',
      description: '7 jours d’affilée sous ton enveloppe',
      earned: i.streak >= 7,
    },
    {
      id: 'streak-30',
      emoji: '🏆',
      title: 'Maître du budget',
      description: '30 jours d’affilée sous ton enveloppe',
      earned: i.streak >= 30,
    },
    {
      id: 'fee-hunter',
      emoji: '✂️',
      title: 'Chasseur de frais',
      description: 'Moins de frais MoMo que le mois dernier',
      earned: sumOf(last, 'FEE') > 0 && sumOf(cur, 'FEE') < sumOf(last, 'FEE'),
    },
    {
      id: 'airtime-tamer',
      emoji: '📶',
      title: 'Crédit maîtrisé',
      description: 'Crédit & data du mois sous ton plafond',
      earned:
        i.config.monthlyAirtimeLimit > 0 &&
        sumOf(cur, 'AIRTIME_RECHARGE') > 0 &&
        sumOf(cur, 'AIRTIME_RECHARGE') <= i.config.monthlyAirtimeLimit,
    },
    {
      id: 'planner',
      emoji: '🗓️',
      title: 'Bon gestionnaire',
      description: 'Tout ton prévisionnel du mois est coché',
      earned: i.plannedItems.length >= 3 && i.plannedItems.every(p => p.isDone),
    },
    {
      id: 'saver',
      emoji: '🐏',
      title: 'Objectif atteint',
      description: 'Un objectif d’épargne atteint',
      earned: i.savingsGoals.some(g => goalStatus(g, i.now).isReached),
    },
    {
      id: 'debt-free',
      emoji: '🕊️',
      title: 'Libre de dettes',
      description: 'Toutes tes dettes sont remboursées',
      earned: hadDebt && i.debts.filter(d => d.direction === 'OWED_BY_ME').every(d => d.isSettled),
    },
  ];
};

export interface WeeklyChallenge {
  id: string;
  title: string;
  /** Valeur actuelle / objectif (unités propres au défi). */
  current: number;
  target: number;
  /** Le défi « plafond » est réussi si current ≤ target, le défi « palier » si current ≥ target. */
  mode: 'MAX' | 'MIN';
  achieved: boolean;
  daysLeft: number;
}

/** Lundi 00h de la semaine de `d`. */
export const startOfWeek = (d: Date): Date => {
  const day = (d.getDay() + 6) % 7;
  return addDays(startOfDay(d), -day);
};

const weekIndex = (d: Date): number => Math.floor(startOfWeek(d).getTime() / (7 * 24 * 3600 * 1000));

/** Défi de la semaine (rotation automatique chaque lundi). */
export const weeklyChallenge = (
  transactions: ReadonlyArray<Transaction>,
  config: BudgetConfig,
  now: Date,
): WeeklyChallenge => {
  const start = startOfWeek(now);
  const from = dayKey(start);
  const to = dayKey(addDays(start, 7));
  const week = transactions.filter(t => t.occurredAt >= from && t.occurredAt < to);
  const daysLeft = 7 - Math.round((startOfDay(now).getTime() - start.getTime()) / (24 * 3600 * 1000));
  const weeklyBudget = Math.round((config.monthlyBudget / 30) * 7);

  const challenges: Array<Omit<WeeklyChallenge, 'achieved' | 'daysLeft'>> = [
    {
      id: 'max-airtime-recharges',
      title: 'Pas plus de 3 recharges de crédit cette semaine',
      current: week.filter(t => t.type === 'AIRTIME_RECHARGE').length,
      target: 3,
      mode: 'MAX',
    },
    {
      id: 'weekly-budget',
      title: `Dépenser moins de ${weeklyBudget} FCFA cette semaine`,
      current: week.filter(isSpending).reduce((s, t) => s + t.amount, 0),
      target: weeklyBudget,
      mode: 'MAX',
    },
    {
      id: 'note-cash',
      title: 'Noter 5 dépenses en espèces',
      current: week.filter(t => t.source === 'MANUAL' && t.type === 'EXPENSE').length,
      target: 5,
      mode: 'MIN',
    },
    {
      id: 'max-fees',
      title: 'Payer moins de 500 FCFA de frais MoMo',
      current: week.filter(t => t.type === 'FEE').reduce((s, t) => s + t.amount, 0),
      target: 500,
      mode: 'MAX',
    },
  ];
  const c = challenges[((weekIndex(now) % challenges.length) + challenges.length) % challenges.length];
  return { ...c, achieved: c.mode === 'MAX' ? c.current <= c.target : c.current >= c.target, daysLeft };
};
