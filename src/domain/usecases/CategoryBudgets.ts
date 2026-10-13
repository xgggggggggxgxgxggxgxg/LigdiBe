import type { BudgetConfig } from '../models/Budget';
import { isSpending, type Transaction } from '../models/Transaction';

export type EnvelopeStatus = 'OK' | 'WARNING' | 'EXCEEDED';

export interface CategoryEnvelope {
  category: string;
  limit: number;
  spent: number;
  remaining: number;
  ratio: number;
  status: EnvelopeStatus;
}

const statusOf = (ratio: number): EnvelopeStatus => (ratio > 1 ? 'EXCEEDED' : ratio >= 0.8 ? 'WARNING' : 'OK');

/** État des enveloppes par catégorie pour le mois (les plus tendues d'abord). */
export const categoryEnvelopes = (
  config: Pick<BudgetConfig, 'categoryLimits'>,
  monthTransactions: ReadonlyArray<Transaction>,
): CategoryEnvelope[] =>
  Object.entries(config.categoryLimits)
    .filter(([, limit]) => limit > 0)
    .map(([category, limit]) => {
      const spent = monthTransactions
        .filter(t => isSpending(t) && t.category === category)
        .reduce((s, t) => s + t.amount, 0);
      const ratio = spent / limit;
      return { category, limit, spent, remaining: limit - spent, ratio, status: statusOf(ratio) };
    })
    .sort((a, b) => b.ratio - a.ratio);

/**
 * Enveloppe qui vient de franchir un seuil (80 % ou 100 %) à cause de `tx` :
 * sert à n'alerter qu'une seule fois par seuil.
 */
export const envelopeThresholdCrossed = (
  config: Pick<BudgetConfig, 'categoryLimits'>,
  monthTransactions: ReadonlyArray<Transaction>,
  tx: Transaction,
): { envelope: CategoryEnvelope; threshold: 0.8 | 1 } | undefined => {
  const limit = config.categoryLimits[tx.category];
  if (!limit || !isSpending(tx)) {
    return undefined;
  }
  const [after] = categoryEnvelopes({ categoryLimits: { [tx.category]: limit } }, monthTransactions);
  const before = (after.spent - tx.amount) / limit;
  if (before <= 1 && after.ratio > 1) {
    return { envelope: after, threshold: 1 };
  }
  if (before < 0.8 && after.ratio >= 0.8) {
    return { envelope: after, threshold: 0.8 };
  }
  return undefined;
};
