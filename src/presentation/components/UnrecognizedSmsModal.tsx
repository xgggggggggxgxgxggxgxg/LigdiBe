import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, SegmentedButtons, Text } from 'react-native-paper';
import { CATEGORIES } from '../../core/categories';
import { formatFCFA } from '../../core/currency';
import { providerFromSender } from '../../data/parser/securityFilters';
import { accountIdForProvider, CASH_ACCOUNT_ID } from '../../domain/models/Account';
import type { UnrecognizedSms } from '../../domain/usecases/UnrecognizedSms';
import { useFinanceStore } from '../store/useFinanceStore';
import { palette } from '../theme/theme';
import { AmountInput, parseInputAmount } from './AmountInput';
import { CategoryPicker } from './CategoryPicker';
import { Field } from './Field';
import { AppModal } from './Screen';

interface Props {
  visible: boolean;
  onDismiss: () => void;
}

/** File des SMS opérateur non reconnus : saisie en un tap (montant et compte pré-remplis) ou rejet. */
export const UnrecognizedSmsModal = ({ visible, onDismiss }: Props) => {
  const pending = useFinanceStore(s => s.unrecognizedSms);
  const [current, setCurrent] = useState<UnrecognizedSms>();

  useEffect(() => {
    if (visible && pending.length === 0) {
      onDismiss();
    }
  }, [visible, pending.length, onDismiss]);

  return (
    <AppModal visible={visible} onDismiss={onDismiss}>
      {current ? (
        <ResolveForm sms={current} onDone={() => setCurrent(undefined)} />
      ) : (
        <ScrollView>
          <Text variant="titleLarge" style={styles.title}>
            SMS à vérifier ({pending.length})
          </Text>
          <Text variant="bodySmall" style={styles.muted}>
            Ces SMS viennent de ton opérateur mais leur format est nouveau. Ajoute-les en un tap pour garder des soldes
            justes.
          </Text>
          {pending.map(p => (
            <Card key={p.id} style={styles.card} onPress={() => setCurrent(p)} testID={`unrecognized-${p.id}`}>
              <Card.Content>
                <View style={styles.row}>
                  <Text variant="labelLarge">{p.sender}</Text>
                  {p.suggestedAmount !== undefined && (
                    <Text
                      variant="labelLarge"
                      style={{ color: p.suggestedType === 'INCOME' ? palette.green : palette.red }}>
                      {formatFCFA(p.suggestedAmount)}
                    </Text>
                  )}
                </View>
                <Text variant="bodySmall" numberOfLines={3} style={styles.muted}>
                  {p.body}
                </Text>
              </Card.Content>
            </Card>
          ))}
        </ScrollView>
      )}
    </AppModal>
  );
};

const ResolveForm = ({ sms, onDone }: { sms: UnrecognizedSms; onDone: () => void }) => {
  const accounts = useFinanceStore(s => s.accounts);
  const resolve = useFinanceStore(s => s.resolveUnrecognizedSms);
  const dismiss = useFinanceStore(s => s.dismissUnrecognizedSms);
  const provider = providerFromSender(sms.sender);
  const defaultAccount = provider ? accountIdForProvider(provider) : CASH_ACCOUNT_ID;
  const [type, setType] = useState<'EXPENSE' | 'INCOME'>(sms.suggestedType ?? 'EXPENSE');
  const [amount, setAmount] = useState(sms.suggestedAmount ? String(Math.round(sms.suggestedAmount)) : '');
  const [accountId, setAccountId] = useState(
    accounts.some(a => a.id === defaultAccount) ? defaultAccount : CASH_ACCOUNT_ID,
  );
  const [category, setCategory] = useState<string>(CATEGORIES.OTHER);
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await resolve(sms.id, {
        accountId,
        type,
        amount: parseInputAmount(amount),
        category: type === 'INCOME' ? CATEGORIES.INCOME : category,
        counterpartyName: label.trim() || undefined,
      });
      onDone();
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      <Text variant="titleMedium" style={styles.title}>
        {sms.sender}
      </Text>
      <Text variant="bodySmall" selectable style={styles.sms} testID="unrecognized-body">
        {sms.body}
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
      <AmountInput label="Montant" value={amount} onChangeText={setAmount} testID="unrecognized-amount" />
      <Field mode="outlined" label="Libellé" value={label} onChangeText={setLabel} style={styles.block} />
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
      <View style={styles.row}>
        <Button
          onPress={async () => {
            await dismiss(sms.id);
            onDone();
          }}
          testID="unrecognized-dismiss">
          Ignorer ce SMS
        </Button>
        <Button
          mode="contained"
          onPress={save}
          loading={saving}
          disabled={saving || parseInputAmount(amount) <= 0}
          testID="unrecognized-save">
          Ajouter
        </Button>
      </View>
      <Button onPress={onDone}>Retour</Button>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  title: { marginBottom: 8, fontWeight: '700' },
  muted: { opacity: 0.7 },
  card: { marginTop: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 8 },
  sms: { padding: 10, borderRadius: 10, backgroundColor: 'rgba(127,127,127,0.12)', marginBottom: 8 },
  block: { marginVertical: 8 },
});
