import { CATEGORIES } from '../../core/categories';
import type { Transaction } from '../models/Transaction';
import { isSpending } from '../models/Transaction';

export interface RecipientStat {
  key: string;
  name: string;
  phone?: string;
  total: number;
  count: number;
}

/** Top N des contacts à qui l'utilisateur envoie le plus d'argent (transferts & paiements à des tiers). */
export const topRecipients = (transactions: ReadonlyArray<Transaction>, limit = 5): RecipientStat[] => {
  const map = new Map<string, RecipientStat>();
  for (const t of transactions) {
    if (t.type !== 'EXPENSE' || (!t.counterpartyName && !t.counterpartyPhone)) {
      continue;
    }
    const key = (t.counterpartyPhone ?? t.counterpartyName ?? '').toUpperCase().replace(/\s+/g, ' ');
    const stat = map.get(key) ?? { key, name: t.counterpartyName ?? t.counterpartyPhone ?? key, phone: t.counterpartyPhone, total: 0, count: 0 };
    stat.total += t.amount;
    stat.count += 1;
    map.set(key, stat);
  }
  return [...map.values()].sort((a, b) => b.total - a.total).slice(0, limit);
};

/** Total des frais & taxes MoMo payés sur la période. */
export const totalFees = (transactions: ReadonlyArray<Transaction>): number =>
  transactions.filter(t => t.type === 'FEE').reduce((s, t) => s + t.amount, 0);

export const totalAirtime = (transactions: ReadonlyArray<Transaction>): number =>
  transactions.filter(t => t.type === 'AIRTIME_RECHARGE').reduce((s, t) => s + t.amount, 0);

export interface CategoryStat {
  category: string;
  total: number;
  share: number;
}

export const spendingByCategory = (transactions: ReadonlyArray<Transaction>): CategoryStat[] => {
  const spending = transactions.filter(isSpending);
  const total = spending.reduce((s, t) => s + t.amount, 0);
  const map = new Map<string, number>();
  for (const t of spending) {
    map.set(t.category, (map.get(t.category) ?? 0) + t.amount);
  }
  return [...map.entries()]
    .map(([category, sum]) => ({ category, total: sum, share: total > 0 ? sum / total : 0 }))
    .sort((a, b) => b.total - a.total);
};

/** Montant total retiré en espèces (non compté comme dépense). */
export const totalCashWithdrawn = (transactions: ReadonlyArray<Transaction>): number =>
  transactions.filter(t => t.type === 'CASH_WITHDRAWAL').reduce((s, t) => s + t.amount, 0);

export interface Insight {
  id: string;
  message: string;
}

/** Petits constats percutants à partager (moteur de viralité). */
export const buildInsights = (monthTransactions: ReadonlyArray<Transaction>): Insight[] => {
  const insights: Insight[] = [];
  const fees = totalFees(monthTransactions);
  const airtime = totalAirtime(monthTransactions);
  if (fees > 0) {
    insights.push({ id: 'fees', message: `Ce mois, les opérateurs t'ont pris ${Math.round(fees)} FCFA de frais.` });
  }
  if (airtime > 0) {
    const n = monthTransactions.filter(t => t.type === 'AIRTIME_RECHARGE').length;
    insights.push({ id: 'airtime', message: `${n} recharges de crédit = ${Math.round(airtime)} FCFA partis en unités.` });
  }
  const top = spendingByCategory(monthTransactions).find(c => c.category !== CATEGORIES.FEES);
  if (top) {
    insights.push({ id: 'top-category', message: `Ton premier poste de dépense : ${top.category} (${Math.round(top.share * 100)} %).` });
  }
  return insights;
};
