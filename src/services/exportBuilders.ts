import type { FamilyRequest } from '../domain/models/FamilyRequest';
import type { Account } from '../domain/models/Account';
import type { Debt } from '../domain/models/Debt';
import type { PlannedItem } from '../domain/models/PlannedItem';
import type { Transaction } from '../domain/models/Transaction';
import type { BudgetConfig } from '../domain/models/Budget';
import type { SavingsGoal } from '../domain/models/SavingsGoal';
import type { Tontine } from '../domain/models/Tontine';

const CSV_COLUMNS: ReadonlyArray<keyof Transaction> = [
  'occurredAt',
  'provider',
  'accountId',
  'type',
  'category',
  'amount',
  'fee',
  'tax',
  'counterpartyName',
  'counterpartyPhone',
  'balanceAfter',
  'reference',
  'note',
  'source',
  'id',
  'parentId',
];

const escapeCsv = (value: unknown, sep: string): string => {
  if (value === undefined || value === null) {
    return '';
  }
  const s = String(value);
  return /["\n\r]/.test(s) || s.includes(sep) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * CSV compatible Excel FR / LibreOffice / Google Sheets :
 * séparateur « ; », BOM UTF-8 pour les accents. Les SMS bruts ne sont pas exportés.
 */
export const transactionsToCsv = (transactions: ReadonlyArray<Transaction>, sep = ';'): string => {
  const header = CSV_COLUMNS.join(sep);
  const rows = transactions.map(t => CSV_COLUMNS.map(c => escapeCsv(t[c], sep)).join(sep));
  return `﻿${[header, ...rows].join('\r\n')}\r\n`;
};

export interface BackupSnapshot {
  app: 'LigdiBe';
  /** v1 : comptes, transactions, dettes, prévisionnel du mois. v2 : + tout le prévisionnel, tontines, objectifs, budget. */
  version: 1 | 2;
  exportedAt: string;
  accounts: Account[];
  transactions: Transaction[];
  debts: Debt[];
  plannedItems: PlannedItem[];
  tontines?: Tontine[];
  savingsGoals?: SavingsGoal[];
  budgetConfig?: BudgetConfig;
  familyRequests?: FamilyRequest[];
  solidarityBudget?: number;
}

export const buildJsonBackup = (data: Omit<BackupSnapshot, 'app' | 'version'>): string =>
  JSON.stringify({ app: 'LigdiBe', version: 2, ...data } satisfies BackupSnapshot, null, 2);

const isArray = (v: unknown): v is unknown[] => Array.isArray(v);

/** Valide une sauvegarde JSON (fichier choisi par l'utilisateur : jamais digne de confiance). */
export const parseJsonBackup = (json: string): BackupSnapshot => {
  let data: Partial<BackupSnapshot>;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('Fichier illisible : ce n’est pas une sauvegarde JSON.');
  }
  if (!data || data.app !== 'LigdiBe' || (data.version !== 1 && data.version !== 2)) {
    throw new Error('Ce fichier n’est pas une sauvegarde LigdiBe.');
  }
  if (!isArray(data.accounts) || !isArray(data.transactions) || !isArray(data.debts) || !isArray(data.plannedItems)) {
    throw new Error('Sauvegarde incomplète ou corrompue.');
  }
  const validTx = data.transactions.every(
    t =>
      typeof t?.id === 'string' &&
      typeof t.amount === 'number' &&
      typeof t.type === 'string' &&
      typeof t.occurredAt === 'string',
  );
  if (!validTx) {
    throw new Error('Sauvegarde corrompue : transactions invalides.');
  }
  return data as BackupSnapshot;
};
