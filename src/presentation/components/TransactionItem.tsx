import React from 'react';
import { StyleSheet } from 'react-native';
import { List, Text } from 'react-native-paper';
import { formatFCFA } from '../../core/currency';
import type { Transaction } from '../../domain/models/Transaction';
import { palette } from '../theme/theme';

const ICONS: Record<Transaction['type'], string> = {
  EXPENSE: 'cart-outline',
  INCOME: 'arrow-bottom-left',
  CASH_WITHDRAWAL: 'cash-fast',
  AIRTIME_RECHARGE: 'cellphone-wireless',
  FEE: 'percent-outline',
  CASH_DEPOSIT: 'wallet-plus-outline',
  AGENT_DEPOSIT: 'bank-transfer-in',
  CASH_OUT: 'wallet-outline',
};

/** Sens affiché : + revenu / poche alimentée, − dépense, ⇄ retrait (neutre). */
export const transactionSign = (t: Transaction): '+' | '-' | '⇄' =>
  t.type === 'INCOME' || t.type === 'CASH_DEPOSIT'
    ? '+'
    : t.type === 'CASH_WITHDRAWAL' || t.type === 'AGENT_DEPOSIT' || t.type === 'CASH_OUT'
    ? '⇄'
    : '-';

interface Props {
  transaction: Transaction;
  onPress?: (t: Transaction) => void;
}

export const TransactionItem = ({ transaction: t, onPress }: Props) => {
  const sign = transactionSign(t);
  const color = sign === '+' ? palette.green : sign === '-' ? palette.red : '#555';
  const time = t.occurredAt.slice(8, 10) + '/' + t.occurredAt.slice(5, 7) + ' ' + t.occurredAt.slice(11, 16);
  return (
    <List.Item
      testID={`tx-${t.id}`}
      onPress={onPress ? () => onPress(t) : undefined}
      title={t.counterpartyName ?? t.note ?? t.category}
      titleNumberOfLines={1}
      description={`${t.category} · ${time}`}
      left={props => <List.Icon {...props} icon={ICONS[t.type]} />}
      right={() => (
        <Text style={[styles.amount, { color }]}>
          {sign === '⇄' ? '⇄ ' : sign}
          {formatFCFA(t.amount)}
        </Text>
      )}
    />
  );
};

const styles = StyleSheet.create({
  amount: { alignSelf: 'center', fontWeight: '700' },
});
