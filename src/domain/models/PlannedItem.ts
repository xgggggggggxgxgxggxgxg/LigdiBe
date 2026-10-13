export type PlannedKind = 'EXPENSE' | 'INCOME';

/** Ligne du budget prévisionnel mensuel. */
export interface PlannedItem {
  id: string;
  /** Mois 'YYYY-MM'. */
  month: string;
  label: string;
  amount: number;
  kind: PlannedKind;
  category: string;
  /** Mots-clés utilisés pour cocher automatiquement la ligne via les transactions. */
  keywords: string[];
  isDone: boolean;
  matchedTransactionId?: string;
  /** Reconduite automatiquement le mois suivant. */
  recurring: boolean;
}
