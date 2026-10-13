import type { Account } from '../domain/models/Account';
import type { Debt } from '../domain/models/Debt';
import type { PlannedItem } from '../domain/models/PlannedItem';
import type { Transaction } from '../domain/models/Transaction';

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
  version: 1;
  exportedAt: string;
  accounts: Account[];
  transactions: Transaction[];
  debts: Debt[];
  plannedItems: PlannedItem[];
}

export const buildJsonBackup = (data: Omit<BackupSnapshot, 'app' | 'version'>): string =>
  JSON.stringify({ app: 'LigdiBe', version: 1, ...data } satisfies BackupSnapshot, null, 2);
