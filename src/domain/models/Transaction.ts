export type Provider =
  | 'MOOV'
  | 'ORANGE'
  | 'UBA_WAVE'
  | 'WAVE'
  | 'TELECEL'
  | 'ECOBANK'
  | 'BANK'
  | 'CASH';

/** Types produits par le parseur SMS. */
export type ParsedTransactionType =
  | 'EXPENSE'
  | 'INCOME'
  | 'CASH_WITHDRAWAL'
  | 'AIRTIME_RECHARGE';

/**
 * Types du grand livre local. `FEE` isole les frais/taxes opérateur,
 * `CASH_DEPOSIT` est le crédit automatique du portefeuille espèces
 * consécutif à un retrait kiosque (jamais compté comme dépense).
 */
export type TransactionType = ParsedTransactionType | 'FEE' | 'CASH_DEPOSIT';

export type TransactionSource = 'SMS' | 'MANUAL' | 'SYSTEM';

export interface Transaction {
  id: string;
  accountId: string;
  provider: Provider;
  type: TransactionType;
  amount: number;
  fee: number;
  tax: number;
  counterpartyName?: string;
  counterpartyPhone?: string;
  category: string;
  note?: string;
  balanceAfter?: number;
  reference?: string;
  rawSms?: string;
  /** Empreinte du SMS brut pour la déduplication (SMS multiples, import historique). */
  smsFingerprint?: string;
  /** Lien vers la transaction mère (frais, crédit cash d'un retrait). */
  parentId?: string;
  source: TransactionSource;
  /** Date réelle de l'opération (ISO 8601). */
  occurredAt: string;
  /** Date d'enregistrement local (ISO 8601). */
  createdAt: string;
}

/** Transactions qui réduisent réellement le patrimoine de l'utilisateur. */
export const SPENDING_TYPES: ReadonlyArray<TransactionType> = [
  'EXPENSE',
  'AIRTIME_RECHARGE',
  'FEE',
];

export const isSpending = (tx: Pick<Transaction, 'type'>): boolean =>
  SPENDING_TYPES.includes(tx.type);

export const isIncome = (tx: Pick<Transaction, 'type'>): boolean =>
  tx.type === 'INCOME';
