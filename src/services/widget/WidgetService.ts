import { NativeModules } from 'react-native';
import { formatFCFA } from '../../core/currency';
import { dayKey, monthKey } from '../../core/dates';
import type { Repositories } from '../../domain/repositories';
import {
  calculateDailyBudget,
  computeBudgetStreak,
  type DailyBudgetResult,
} from '../../domain/usecases/CalculateDailyBudget';

export const WIDGET_SHOW_BALANCE_KEY = 'widgetShowBalance';

/** Données affichées par le widget Android (textes déjà formatés : le natif ne fait qu'afficher). */
export interface WidgetPayload {
  /** Jour de calcul (AAAA-MM-JJ) : le widget signale un budget périmé le lendemain. */
  day: string;
  remaining: string;
  caption: string;
  detail: string;
  /** 0 à 100. */
  progress: number;
  status: DailyBudgetResult['status'];
  badge: string;
  /** Vide si l'utilisateur masque son patrimoine sur l'écran d'accueil. */
  balance: string;
  updated: string;
}

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export const buildWidgetPayload = (input: {
  budget: DailyBudgetResult;
  streak: number;
  now: Date;
  totalBalance?: number;
}): WidgetPayload => {
  const { budget, streak, now, totalBalance } = input;
  const exceeded = budget.status === 'EXCEEDED';
  const badges = [
    budget.isWeekendBoostActive ? `🎉 Week-end ×${String(budget.todayMultiplier).replace('.', ',')}` : '',
    streak > 0 ? `🔥 ${streak} j` : '',
  ].filter(Boolean);
  return {
    day: dayKey(now),
    remaining: formatFCFA(exceeded ? budget.todaySpent - budget.todayBudget : budget.todayRemaining),
    caption: exceeded ? 'Dépassement du jour' : "Reste pour aujourd'hui",
    detail: `${formatFCFA(budget.todaySpent, { withUnit: false })} / ${formatFCFA(budget.todayBudget)} dépensés`,
    progress: Math.round(Math.min(1, Math.max(0, budget.progress)) * 100),
    status: budget.status,
    badge: badges.join('  ·  '),
    balance: totalBalance === undefined ? '' : `Patrimoine ${formatFCFA(totalBalance)}`,
    updated: `MAJ ${hhmm(now)}`,
  };
};

interface WidgetNativeModule {
  update(payload: WidgetPayload): Promise<void> | void;
}

/** Envoie les données au widget (sans effet hors Android ou si le module natif est absent). */
export const pushWidget = async (payload: WidgetPayload): Promise<boolean> => {
  const native: WidgetNativeModule | undefined = NativeModules.LigdiBeWidget;
  if (!native) {
    return false;
  }
  try {
    await native.update(payload);
    return true;
  } catch {
    return false;
  }
};

/** Recalcule le widget depuis la base (tâche Headless SMS, application fermée). */
export const refreshWidgetFromRepos = async (repos: Repositories, now = new Date()): Promise<boolean> => {
  const [config, transactions, paid, accounts, showBalance] = await Promise.all([
    repos.settings.getBudgetConfig(),
    repos.transactions.listBetween(`${now.getFullYear() - 1}-01-01`, '9999'),
    repos.settings.getJson<string[]>(`paidFixed:${monthKey(now)}`, []),
    repos.accounts.getAll(),
    repos.settings.getJson<boolean>(WIDGET_SHOW_BALANCE_KEY, false),
  ]);
  return pushWidget(
    buildWidgetPayload({
      budget: calculateDailyBudget(config, transactions, now, paid),
      streak: computeBudgetStreak(config, transactions, now),
      now,
      totalBalance: showBalance ? accounts.reduce((s, a) => s + a.currentBalance, 0) : undefined,
    }),
  );
};
