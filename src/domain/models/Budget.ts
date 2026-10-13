export interface FixedExpense {
  id: string;
  label: string;
  amount: number;
  /** Jour du mois où la charge tombe (1-31). */
  dayOfMonth: number;
}

export interface SpecialDayMultiplier {
  /** Date 'YYYY-MM-DD' (ex: Tabaski, fête, anniversaire). */
  date: string;
  multiplier: number;
  label?: string;
}

export interface BudgetConfig {
  monthlyBudget: number;
  /** Coefficient appliqué du vendredi 18h au dimanche 23h59. */
  weekendMultiplier: number;
  fixedExpenses: FixedExpense[];
  /** Surpondérations ponctuelles par date. */
  specialDays: SpecialDayMultiplier[];
  /** Plafond d'alerte pour le crédit d'appel/data par mois. */
  monthlyAirtimeLimit: number;
  /** Plafond d'alerte annuel global (0 = aucun). */
  yearlyBudget: number;
  /** Enveloppes mensuelles par catégorie (ex: { Repas: 30000 }). */
  categoryLimits: Record<string, number>;
}

export const DEFAULT_BUDGET_CONFIG: BudgetConfig = {
  monthlyBudget: 150000,
  weekendMultiplier: 1.5,
  fixedExpenses: [],
  specialDays: [],
  monthlyAirtimeLimit: 5000,
  yearlyBudget: 0,
  categoryLimits: {},
};
