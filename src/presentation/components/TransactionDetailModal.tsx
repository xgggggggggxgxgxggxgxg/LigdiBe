import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Button, Divider, Text } from 'react-native-paper';
import { AppModal } from './Screen';
import { formatFCFA } from '../../core/currency';
import type { Transaction } from '../../domain/models/Transaction';
import { useFinanceStore } from '../store/useFinanceStore';
import { CategoryPicker } from './CategoryPicker';

interface Props {
  transaction?: Transaction;
  onDismiss: () => void;
}

export const TransactionDetailModal = ({ transaction: t, onDismiss }: Props) => {
  const recategorize = useFinanceStore(s => s.recategorize);
  const deleteTransaction = useFinanceStore(s => s.deleteTransaction);
  const live = useFinanceStore(s => s.transactions.find(x => x.id === t?.id));
  if (!t) {
    return null;
  }
  const tx = live ?? t;
  return (
    <AppModal visible onDismiss={onDismiss}>
      <ScrollView>
        <Text variant="titleLarge" style={styles.bold}>
          {formatFCFA(tx.amount)}
        </Text>
        <Text variant="bodyMedium">{tx.counterpartyName ?? tx.note ?? '—'}</Text>
        <Text variant="bodySmall" style={styles.muted}>
          {tx.occurredAt.replace('T', ' à ').slice(0, 19)} · {tx.provider} ·{' '}
          {tx.source === 'SMS'
            ? 'Détecté par SMS'
            : tx.source === 'SYSTEM'
            ? 'Écriture automatique'
            : 'Saisie manuelle'}
        </Text>
        {tx.fee + tx.tax > 0 && (
          <Text variant="bodySmall">
            Frais {formatFCFA(tx.fee)} · Taxes {formatFCFA(tx.tax)}
          </Text>
        )}
        {tx.reference && <Text variant="bodySmall">Réf. {tx.reference}</Text>}
        <Divider style={styles.divider} />
        {tx.type === 'EXPENSE' && (
          <>
            <Text variant="labelLarge">Catégorie (LigdiBe s'en souviendra)</Text>
            <CategoryPicker value={tx.category} onChange={c => recategorize(tx.id, c)} allowCreate />
          </>
        )}
        {tx.rawSms && (
          <Text variant="bodySmall" style={[styles.muted, styles.sms]} selectable>
            {tx.rawSms}
          </Text>
        )}
        <Button
          icon="delete-outline"
          textColor="#C62828"
          onPress={async () => {
            await deleteTransaction(tx.id);
            onDismiss();
          }}>
          Supprimer
        </Button>
      </ScrollView>
    </AppModal>
  );
};

const styles = StyleSheet.create({
  bold: { fontWeight: '800' },
  muted: { opacity: 0.65 },
  divider: { marginVertical: 12 },
  sms: { marginVertical: 12, fontFamily: 'monospace' },
});
