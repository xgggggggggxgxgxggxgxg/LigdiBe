import type { PlannedItem } from '../models/PlannedItem';
import { isIncome, isSpending, type Transaction } from '../models/Transaction';
import { counterpartyKey } from './CategorizeTransaction';

export interface RecurringSuggestion {
  key: string;
  label: string;
  kind: PlannedItem['kind'];
  /** Montant médian observé. */
  amount: number;
  category: string;
  /** Mois distincts où l'opération a été vue. */
  monthsSeen: number;
  /** Mots-clés pour la coche automatique. */
  keywords: string[];
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

/**
 * Repère les opérations qui reviennent chaque mois (abonnement TV, loyer, envoi à
 * la famille, salaire…) : même contrepartie sur au moins `minMonths` mois
 * distincts, montants à ±25 % de la médiane. Les lignes déjà présentes au
 * prévisionnel (même libellé ou mot-clé) ne sont pas re-suggérées.
 */
export const detectRecurring = (
  transactions: ReadonlyArray<Transaction>,
  existing: ReadonlyArray<PlannedItem> = [],
  minMonths = 2,
): RecurringSuggestion[] => {
  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (t.type !== 'EXPENSE' && !isIncome(t)) {
      continue;
    }
    const key = counterpartyKey(t);
    if (!key) {
      continue;
    }
    const gk = `${isIncome(t) ? 'IN' : 'OUT'}|${key}`;
    groups.set(gk, [...(groups.get(gk) ?? []), t]);
  }
  const known = new Set(existing.flatMap(i => [normalize(i.label), ...i.keywords.map(normalize)]));

  const out: RecurringSuggestion[] = [];
  for (const [gk, txs] of groups) {
    const amount = median(txs.map(t => t.amount));
    const regular = txs.filter(t => Math.abs(t.amount - amount) <= amount * 0.25);
    const months = new Set(regular.map(t => t.occurredAt.slice(0, 7)));
    if (months.size < minMonths) {
      continue;
    }
    const sample = regular[regular.length - 1];
    const label = sample.counterpartyName ?? sample.counterpartyPhone ?? gk.split('|')[1];
    const keyword = normalize(sample.counterpartyName ?? sample.counterpartyPhone ?? label);
    if (known.has(normalize(label)) || known.has(keyword)) {
      continue;
    }
    out.push({
      key: gk,
      label,
      kind: isSpending(sample) ? 'EXPENSE' : 'INCOME',
      amount,
      category: sample.category,
      monthsSeen: months.size,
      keywords: [keyword],
    });
  }
  return out.sort((a, b) => b.monthsSeen - a.monthsSeen || b.amount - a.amount);
};
