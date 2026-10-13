/** Objectif d'épargne (« Ma Tabaski », « Rentrée scolaire », « Moto »…). */
export interface SavingsGoal {
  id: string;
  name: string;
  emoji: string;
  targetAmount: number;
  /** Date cible 'YYYY-MM-DD' (optionnelle). */
  deadline?: string;
  /** Versements : date ISO + montant (négatif = retrait). */
  contributions: Array<{ date: string; amount: number }>;
  createdAt: string;
}
