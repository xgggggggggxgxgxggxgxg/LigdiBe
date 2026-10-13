export type DebtDirection = 'OWED_BY_ME' | 'OWED_TO_ME';

export interface Debt {
  id: string;
  contactName: string;
  phone?: string;
  amount: number;
  /** Montant déjà remboursé (remboursements partiels). */
  amountRepaid: number;
  direction: DebtDirection;
  isSettled: boolean;
  dueDate?: string;
  note?: string;
  createdAt: string;
}
