import { formatCompact, formatFCFA, roundMoney } from '../src/core/currency';
import {
  addDays,
  daysInMonth,
  fileTimestamp,
  formatMonthLabel,
  fromIso,
  isSameDay,
  isWeekendWindow,
  nextMonthKey,
  startOfMonth,
  toLocalIso,
} from '../src/core/dates';
import { fingerprint, generateId } from '../src/core/id';
import { buildJsonBackup, transactionsToCsv } from '../src/services/exportBuilders';
import { tx } from './helpers/inMemoryRepositories';

describe('core', () => {
  test('formatFCFA / formatCompact', () => {
    expect(formatFCFA(1234567.8)).toBe('1 234 568 FCFA');
    expect(formatFCFA(-500)).toBe('-500 FCFA');
    expect(formatFCFA(500, { signed: true, withUnit: false })).toBe('+500');
    expect(formatFCFA(0, { signed: true })).toBe('0 FCFA');
    expect(formatCompact(1250000)).toBe('1,25 M');
    expect(formatCompact(-15000)).toBe('-15 k');
    expect(formatCompact(9500)).toBe('9 500');
    expect(roundMoney(4.34781)).toBe(4.35);
  });

  test('dates', () => {
    expect(toLocalIso(new Date(2026, 0, 2, 3, 4, 5))).toBe('2026-01-02T03:04:05');
    expect(fromIso('2026-01-02T03:04:05').getHours()).toBe(3);
    expect(nextMonthKey('2026-12')).toBe('2027-01');
    expect(nextMonthKey('2026-02')).toBe('2026-03');
    expect(daysInMonth(new Date(2028, 1, 10))).toBe(29);
    expect(startOfMonth(new Date(2026, 9, 13)).getDate()).toBe(1);
    expect(isSameDay(addDays(new Date(2026, 9, 31, 22), 1), new Date(2026, 10, 1))).toBe(true);
    expect(isWeekendWindow(new Date(2026, 9, 16, 17, 59))).toBe(false);
    expect(isWeekendWindow(new Date(2026, 9, 16, 18, 0))).toBe(true);
    expect(isWeekendWindow(new Date(2026, 9, 18, 23, 59))).toBe(true);
    expect(isWeekendWindow(new Date(2026, 9, 19, 0, 1))).toBe(false);
    expect(formatMonthLabel('2026-10')).toBe('octobre 2026');
    expect(fileTimestamp(new Date(2026, 9, 13, 21, 30, 5))).toBe('20261013-213005');
  });

  test('ids et empreintes', () => {
    expect(generateId('tx')).toMatch(/^tx_/);
    expect(generateId()).not.toBe(generateId());
    expect(fingerprint('abc')).toBe(fingerprint('abc'));
    expect(fingerprint('abc')).not.toBe(fingerprint('abd'));
  });
});

describe('export', () => {
  test('CSV ; avec BOM, échappement et sans SMS brut', () => {
    const csv = transactionsToCsv([
      tx({ id: 'a', counterpartyName: 'BOUTIQUE "CHEZ AWA"; OUAGA', note: 'ligne1\nligne2', rawSms: 'SECRET' }),
    ]);
    expect(csv.startsWith('﻿occurredAt;provider')).toBe(true);
    expect(csv).toContain('"BOUTIQUE ""CHEZ AWA""; OUAGA"');
    expect(csv).toContain('"ligne1\nligne2"');
    expect(csv).not.toContain('SECRET');
    expect(csv.trim().split('\r\n')).toHaveLength(2);
  });

  test('sauvegarde JSON', () => {
    const json = JSON.parse(
      buildJsonBackup({ exportedAt: 'x', accounts: [], transactions: [tx({})], debts: [], plannedItems: [] }),
    );
    expect(json).toMatchObject({ app: 'LigdiBe', version: 1, exportedAt: 'x' });
    expect(json.transactions).toHaveLength(1);
  });
});
