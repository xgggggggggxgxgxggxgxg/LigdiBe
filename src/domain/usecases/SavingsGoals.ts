import { dayKey } from '../../core/dates';
import type { SavingsGoal } from '../models/SavingsGoal';

export interface GoalStatus {
  saved: number;
  remaining: number;
  /** 0-1 */
  progress: number;
  isReached: boolean;
  daysLeft?: number;
  /** Montant à mettre de côté par jour / semaine pour tenir l'échéance. */
  perDayNeeded?: number;
  perWeekNeeded?: number;
  /** Au rythme moyen des versements, l'objectif sera-t-il atteint à temps ? */
  onTrack?: boolean;
  isOverdue: boolean;
}

const DAY_MS = 24 * 3600 * 1000;

const localDate = (iso: string): Date => new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);

export const goalStatus = (goal: SavingsGoal, now: Date): GoalStatus => {
  const saved = Math.max(
    0,
    goal.contributions.reduce((s, c) => s + c.amount, 0),
  );
  const remaining = Math.max(0, goal.targetAmount - saved);
  const isReached = remaining === 0;
  const progress = goal.targetAmount > 0 ? Math.min(1, saved / goal.targetAmount) : 1;
  if (!goal.deadline) {
    return { saved, remaining, progress, isReached, isOverdue: false };
  }
  const today = localDate(dayKey(now));
  const daysLeft = Math.round((localDate(goal.deadline).getTime() - today.getTime()) / DAY_MS);
  const isOverdue = daysLeft < 0 && !isReached;
  const effectiveDays = Math.max(1, daysLeft);
  const elapsed = Math.max(
    1,
    Math.round((today.getTime() - localDate(goal.createdAt.slice(0, 10)).getTime()) / DAY_MS),
  );
  const pace = saved / elapsed;
  return {
    saved,
    remaining,
    progress,
    isReached,
    daysLeft,
    perDayNeeded: Math.ceil(remaining / effectiveDays),
    perWeekNeeded: Math.ceil((remaining / effectiveDays) * 7),
    onTrack: isReached || (daysLeft >= 0 && pace * daysLeft >= remaining),
    isOverdue,
  };
};

/** Message d'encouragement (ton positif = rétention). */
export const goalMotivation = (goal: SavingsGoal, s: GoalStatus): string => {
  if (s.isReached) {
    return `🎉 Objectif « ${goal.name} » atteint ! Bravo, tu l'as fait.`;
  }
  const pct = Math.round(s.progress * 100);
  if (s.isOverdue) {
    return `⏰ L'échéance est passée, mais tu es à ${pct} %. On fixe une nouvelle date ?`;
  }
  if (pct >= 75) {
    return `🔥 Plus que quelques pas : ${pct} % de « ${goal.name} » !`;
  }
  if (s.perDayNeeded !== undefined) {
    return `💪 Mets ${s.perDayNeeded} FCFA de côté par jour et « ${goal.name} » sera prêt à temps.`;
  }
  return `🌱 « ${goal.name} » : ${pct} % atteint. Chaque petit versement compte.`;
};
