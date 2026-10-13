import React, { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Button, Modal, Portal, SegmentedButtons, Text, TextInput } from 'react-native-paper';
import { CATEGORIES } from '../../core/categories';
import { CASH_ACCOUNT_ID } from '../../domain/models/Account';
import { useFinanceStore } from '../store/useFinanceStore';
import { AmountInput, parseInputAmount } from './AmountInput';
import { CategoryPicker } from './CategoryPicker';

interface Props {
  visible: boolean;
  onDismiss: () => void;
}

/** Saisie rapide (surtout pour les dépenses en espèces, invisibles par SMS). */
export const AddTransactionModal = ({ visible, onDismiss }: Props) => {
  const accounts = useFinanceStore(s => s.accounts);
  const addManualTransaction = useFinanceStore(s => s.addManualTransaction);
  const [type, setType] = useState<'EXPENSE' | 'INCOME'>('EXPENSE');
  const [accountId, setAccountId] = useState(CASH_ACCOUNT_ID);
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<string>(CATEGORIES.FOOD);
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const value = parseInputAmount(amount);
    if (value <= 0) {
      return;
    }
    setSaving(true);
    try {
      await addManualTransaction({
        accountId,
        type,
        amount: value,
        category: type === 'INCOME' ? CATEGORIES.INCOME : category,
        counterpartyName: label.trim() || undefined,
      });
      setAmount('');
      setLabel('');
      onDismiss();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Portal>
      <Modal visible={visible} onDismiss={onDismiss} contentContainerStyle={styles.modal}>
        <ScrollView keyboardShouldPersistTaps="handled">
          <Text variant="titleLarge" style={styles.title}>
            Nouvelle opération
          </Text>
          <SegmentedButtons
            value={type}
            onValueChange={v => setType(v as 'EXPENSE' | 'INCOME')}
            buttons={[
              { value: 'EXPENSE', label: 'Dépense', icon: 'minus' },
              { value: 'INCOME', label: 'Entrée', icon: 'plus' },
            ]}
            style={styles.block}
          />
          <AmountInput label="Montant" value={amount} onChangeText={setAmount} testID="manual-amount" />
          <TextInput mode="outlined" label="Libellé (ex: Maquis, Taxi, Marché)" value={label} onChangeText={setLabel} style={styles.block} />
          <Text variant="labelLarge">Compte</Text>
          <CategoryPicker
            value={accounts.find(a => a.id === accountId)?.name ?? ''}
            onChange={name => setAccountId(accounts.find(a => a.name === name)?.id ?? CASH_ACCOUNT_ID)}
            categories={accounts.map(a => a.name)}
          />
          {type === 'EXPENSE' && (
            <>
              <Text variant="labelLarge">Catégorie</Text>
              <CategoryPicker value={category} onChange={setCategory} />
            </>
          )}
          <Button mode="contained" onPress={save} loading={saving} disabled={saving || parseInputAmount(amount) <= 0} style={styles.block} testID="manual-save">
            Enregistrer
          </Button>
        </ScrollView>
      </Modal>
    </Portal>
  );
};

const styles = StyleSheet.create({
  modal: { backgroundColor: '#fff', margin: 16, padding: 20, borderRadius: 20, maxHeight: '90%' },
  title: { marginBottom: 12, fontWeight: '700' },
  block: { marginVertical: 8 },
});
