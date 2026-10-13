import { dayKey, daysInMonth, monthKey, yearKey } from '../../core/dates';
import type { Transaction } from '../models/Transaction';

export interface AirtimeSummary {
  daily_airtime_spent: number;
  monthly_airtime_spent: number;
  yearly_airtime_spent: number;
  monthlyRechargeCount: number;
  averageRecharge: number;
  /** Projection annuelle au rythme du mois en cours. */
  projectedYearly: number;
  isOverMonthlyLimit: boolean;
}

/**
 * Agrégateur « Crédit d'appel & Data » : isole les micro-recharges (100 F, 200 F…)
 * pour révéler ces fuites imperceptibles.
 */
export const summarizeAirtime = (
  transactions: ReadonlyArray<Transaction>,
  now: Date,
  monthlyLimit = 0,
): AirtimeSummary => {
  const airtime = transactions.filter(t => t.type === 'AIRTIME_RECHARGE');
  const sum = (prefix: string) =>
    airtime.filter(t => t.occurredAt.startsWith(prefix)).reduce((s, t) => s + t.amount, 0);
  const month = airtime.filter(t => t.occurredAt.startsWith(monthKey(now)));
  const monthly = sum(monthKey(now));
  return {
    daily_airtime_spent: sum(dayKey(now)),
    monthly_airtime_spent: monthly,
    yearly_airtime_spent: sum(yearKey(now)),
    monthlyRechargeCount: month.length,
    averageRecharge: month.length ? Math.round(monthly / month.length) : 0,
    projectedYearly: Math.round((monthly / now.getDate()) * daysInMonth(now) * 12),
    isOverMonthlyLimit: monthlyLimit > 0 && monthly > monthlyLimit,
  };
};
