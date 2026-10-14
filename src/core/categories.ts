export const CATEGORIES = {
  FOOD: 'Repas',
  GROCERIES: 'Courses',
  FUEL: 'Carburant',
  TRANSPORT: 'Transport',
  AIRTIME: "Crédit d'appel & Data",
  DATA: 'Forfait internet (Data)',
  FEES: 'Frais & Taxes',
  BILLS: 'Factures (Eau, Élec, TV)',
  RENT: 'Loyer',
  HEALTH: 'Santé',
  EDUCATION: 'Scolarité',
  FAMILY: 'Famille & Solidarité',
  TONTINE: 'Tontine',
  TRANSFER: 'Transfert envoyé',
  CASH_WITHDRAWAL: 'Retrait Cash',
  CASH_IN: 'Alimentation Poche',
  MOMO_DEPOSIT: 'Dépôt sur MoMo',
  INCOME: 'Revenu',
  SALARY: 'Salaire',
  OTHER: 'Autre',
} as const;

export type CategoryName = (typeof CATEGORIES)[keyof typeof CATEGORIES];

/** Catégories proposées dans la notification post-dépense (3 actions max sur Android). */
export const QUICK_EXPENSE_CATEGORIES: ReadonlyArray<string> = [CATEGORIES.FUEL, CATEGORIES.GROCERIES, CATEGORIES.FOOD];

export const EXPENSE_CATEGORY_LIST: ReadonlyArray<string> = [
  CATEGORIES.FOOD,
  CATEGORIES.GROCERIES,
  CATEGORIES.FUEL,
  CATEGORIES.TRANSPORT,
  CATEGORIES.BILLS,
  CATEGORIES.RENT,
  CATEGORIES.HEALTH,
  CATEGORIES.EDUCATION,
  CATEGORIES.FAMILY,
  CATEGORIES.TONTINE,
  CATEGORIES.TRANSFER,
  CATEGORIES.AIRTIME,
  CATEGORIES.DATA,
  CATEGORIES.FEES,
  CATEGORIES.OTHER,
];
