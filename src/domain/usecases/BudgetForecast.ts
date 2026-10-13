import { nextMonthKey } from '../../core/dates';
import { generateId } from '../../core/id';
import type { PlannedItem } from '../models/PlannedItem';
import { isIncome, isSpending, type Transaction } from '../models/Transaction';

export interface ForecastSummary {
  plannedIncome: number;
  plannedExpense: number;
  plannedBalance: number;
  actualIncome: number;
  actualExpense: number;
  actualBalance: number;
  doneCount: number;
  totalCount: number;
  /** Le prévisionnel est-il tenable (revenus ≥ dépenses prévues) ? */
  isViable: boolean;
  /** Taux d'épargne prévu (0-1). */
  plannedSavingsRate: number;
  /** Dépenses réelles hors prévisionnel (imprévus). */
  unplannedExpense: number;
}

export const summarizeForecast = (
  items: ReadonlyArray<PlannedItem>,
  monthTransactions: ReadonlyArray<Transaction>,
): ForecastSummary => {
  const sum = (arr: ReadonlyArray<{ amount: number }>) => arr.reduce((s, x) => s + x.amount, 0);
  const plannedIncome = sum(items.filter(i => i.kind === 'INCOME'));
  const plannedExpense = sum(items.filter(i => i.kind === 'EXPENSE'));
  const actualIncome = sum(monthTransactions.filter(isIncome));
  const actualExpense = sum(monthTransactions.filter(isSpending));
  const matchedIds = new Set(items.map(i => i.matchedTransactionId).filter(Boolean));
  const unplannedExpense = sum(monthTransactions.filter(t => isSpending(t) && !matchedIds.has(t.id)));
  return {
    plannedIncome,
    plannedExpense,
    plannedBalance: plannedIncome - plannedExpense,
    actualIncome,
    actualExpense,
    actualBalance: actualIncome - actualExpense,
    doneCount: items.filter(i => i.isDone).length,
    totalCount: items.length,
    isViable: plannedIncome >= plannedExpense,
    plannedSavingsRate: plannedIncome > 0 ? Math.max(0, (plannedIncome - plannedExpense) / plannedIncome) : 0,
    unplannedExpense,
  };
};

const normalize = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const STOP_WORDS = new Set(['DE', 'DU', 'LA', 'LE', 'LES', 'DES', 'ET', 'A', 'AU', 'POUR', 'MME', 'M', 'MR']);

const tokens = (s: string): string[] =>
  normalize(s)
    .split(' ')
    .filter(w => w.length > 1 && !STOP_WORDS.has(w));

export interface MatchCandidate {
  transaction: Transaction;
  /** Score 0-1 : similarité de nom (70 %) + proximité du montant (30 %). */
  score: number;
}

/**
 * Classe les transactions candidates pour cocher une ligne du prévisionnel :
 * similarité entre les mots-clés/libellé et le nom de la contrepartie/catégorie/note,
 * pondérée par la proximité du montant.
 */
export const suggestMatches = (
  item: PlannedItem,
  transactions: ReadonlyArray<Transaction>,
  excludeIds: ReadonlySet<string> = new Set(),
): MatchCandidate[] => {
  const wanted = new Set([...item.keywords.flatMap(tokens), ...tokens(item.label)]);
  return transactions
    .filter(t => !excludeIds.has(t.id))
    .filter(t => (item.kind === 'INCOME' ? isIncome(t) : isSpending(t)))
    .map(t => {
      const hay = new Set(
        tokens(`${t.counterpartyName ?? ''} ${t.counterpartyPhone ?? ''} ${t.category} ${t.note ?? ''}`),
      );
      const hits = [...wanted].filter(w => hay.has(w)).length;
      const nameScore = wanted.size ? hits / wanted.size : 0;
      const amountScore = item.amount > 0 ? Math.max(0, 1 - Math.abs(t.amount - item.amount) / item.amount) : 0;
      return { transaction: t, score: nameScore > 0 ? 0.7 * nameScore + 0.3 * amountScore : 0 };
    })
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score);
};

/**
 * Coche automatiquement les lignes du prévisionnel dont une transaction du mois
 * correspond (nom reconnu ET montant à ±30 %). Retourne les lignes mises à jour.
 */
export const autoMatchPlannedItems = (
  items: ReadonlyArray<PlannedItem>,
  monthTransactions: ReadonlyArray<Transaction>,
): PlannedItem[] => {
  const used = new Set(items.map(i => i.matchedTransactionId).filter((x): x is string => !!x));
  const updated: PlannedItem[] = [];
  for (const item of items) {
    if (item.isDone) {
      continue;
    }
    const best = suggestMatches(item, monthTransactions, used).find(
      c => Math.abs(c.transaction.amount - item.amount) <= item.amount * 0.3,
    );
    if (best) {
      used.add(best.transaction.id);
      updated.push({ ...item, isDone: true, matchedTransactionId: best.transaction.id });
    }
  }
  return updated;
};

/**
 * Report sur le mois suivant : les lignes récurrentes sont reconduites (décochées),
 * les lignes non réalisées sont reportées. Les libellés déjà présents sont ignorés.
 */
export const carryOverToNextMonth = (
  items: ReadonlyArray<PlannedItem>,
  existingNextMonth: ReadonlyArray<PlannedItem> = [],
  idGen: (p: string) => string = generateId,
): PlannedItem[] => {
  const existing = new Set(existingNextMonth.map(i => normalize(i.label)));
  return items
    .filter(i => i.recurring || !i.isDone)
    .filter(i => !existing.has(normalize(i.label)))
    .map(i => ({
      ...i,
      id: idGen('plan'),
      month: nextMonthKey(i.month),
      isDone: false,
      matchedTransactionId: undefined,
    }));
};
