import { roundMoney } from '../../core/currency';
import { isIncome, isSpending, type Transaction } from '../models/Transaction';

export interface SearchResult {
  transactions: Transaction[];
  totalOut: number;
  totalIn: number;
}

/** Minuscules, sans accents ni espaces multiples : « Épargne » ≈ « epargne ». */
export const foldText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const haystack = (t: Transaction): string =>
  foldText(
    [t.counterpartyName, t.counterpartyPhone, t.note, t.category, t.reference, t.provider].filter(Boolean).join(' '),
  );

/**
 * Recherche plein texte locale dans l'historique : nom, numéro, note, catégorie,
 * référence. Chaque mot doit apparaître ; un terme purement numérique (≥ 3 chiffres)
 * peut aussi désigner un montant exact (« 5000 »). Les écritures système (frais,
 * crédit Poche) sont exclues pour ne pas doubler les résultats.
 */
export const searchTransactions = (txs: ReadonlyArray<Transaction>, query: string): SearchResult => {
  const terms = foldText(query)
    // « 1 500 » ou « 1.500 » : un seul montant, pas deux mots.
    .replace(/(\d)[ .,](?=\d{3}\b)/g, '$1')
    .split(' ')
    .filter(w => w.length > 0);
  if (terms.length === 0) {
    return { transactions: [], totalOut: 0, totalIn: 0 };
  }
  const matches = txs
    .filter(t => t.source !== 'SYSTEM')
    .filter(t => {
      const text = haystack(t);
      return terms.every(term => {
        if (/^\d{3,}$/.test(term) && Number(term) === Math.round(t.amount)) {
          return true;
        }
        return text.includes(term);
      });
    })
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  return {
    transactions: matches,
    totalOut: roundMoney(matches.filter(isSpending).reduce((s, t) => s + t.amount + t.fee + t.tax, 0)),
    totalIn: roundMoney(matches.filter(isIncome).reduce((s, t) => s + t.amount, 0)),
  };
};
