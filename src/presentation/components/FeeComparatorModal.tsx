import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Avatar, Button, Chip, SegmentedButtons, Surface, Text, useTheme } from 'react-native-paper';
import { formatFCFA } from '../../core/currency';
import type { Transaction } from '../../domain/models/Transaction';
import { compareOperators, type FeeOperation } from '../../domain/usecases/FeeComparator';
import { PROVIDER_LABELS } from '../../domain/usecases/ProcessIncomingSms';
import { useFinanceStore } from '../store/useFinanceStore';
import { palette, providerColor, providerIcon } from '../theme/theme';
import { AmountInput, parseInputAmount } from './AmountInput';
import { AppModal } from './Screen';

interface Props {
  visible: boolean;
  onDismiss: () => void;
}

const OPERATIONS: ReadonlyArray<{ value: FeeOperation; label: string; icon: string }> = [
  { value: 'TRANSFER', label: 'Envoi', icon: 'send-outline' },
  { value: 'WITHDRAWAL', label: 'Retrait', icon: 'cash-fast' },
  { value: 'PAYMENT', label: 'Paiement', icon: 'storefront-outline' },
];

const formatRate = (rate: number): string => `${(rate * 100).toFixed(rate < 0.01 ? 2 : 1).replace('.', ',')} %`;

/** « Combien ça me coûte ? » : frais estimés par opérateur d'après tes propres SMS. */
export const FeeComparatorModal = ({ visible, onDismiss }: Props) => {
  const theme = useTheme();
  const loadAll = useFinanceStore(s => s.loadAllTransactions);
  const recent = useFinanceStore(s => s.transactions);
  const [history, setHistory] = useState<Transaction[]>([]);
  const [operation, setOperation] = useState<FeeOperation>('TRANSFER');
  const [amount, setAmount] = useState('25000');

  useEffect(() => {
    if (visible) {
      loadAll().then(setHistory, () => setHistory(recent));
    }
  }, [visible, loadAll, recent]);

  const value = parseInputAmount(amount);
  const comparison = useMemo(() => compareOperators(history, operation, value), [history, operation, value]);

  return (
    <AppModal visible={visible} onDismiss={onDismiss}>
      <ScrollView keyboardShouldPersistTaps="handled">
        <Text variant="titleLarge" style={styles.title}>
          Combien ça coûte ?
        </Text>
        <Text variant="bodySmall" style={styles.muted}>
          Estimation à partir des frais réellement prélevés dans tes SMS, sur des montants proches.
        </Text>
        <SegmentedButtons
          value={operation}
          onValueChange={v => setOperation(v as FeeOperation)}
          buttons={OPERATIONS.map(o => ({ ...o, testID: `fee-op-${o.value}` }))}
          style={styles.block}
        />
        <AmountInput label="Montant" value={amount} onChangeText={setAmount} testID="fee-amount" />

        {comparison.estimates.length === 0 ? (
          <Surface style={styles.empty} elevation={0} testID="fee-empty">
            <Avatar.Icon
              icon="chart-timeline-variant"
              size={44}
              style={{ backgroundColor: theme.colors.secondaryContainer }}
            />
            <Text variant="bodyMedium" style={styles.emptyText}>
              Pas encore assez d'opérations de ce type avec frais détaillés. Chaque SMS reçu affine l'estimation.
            </Text>
          </Surface>
        ) : (
          <>
            {comparison.maxSaving > 0 && comparison.cheapest && (
              <Surface style={[styles.saving, { backgroundColor: theme.colors.primaryContainer }]} elevation={0}>
                <Text variant="labelLarge" style={{ color: theme.colors.onPrimaryContainer }} testID="fee-saving">
                  💡 Passe par {PROVIDER_LABELS[comparison.cheapest.provider]} : jusqu'à{' '}
                  {formatFCFA(comparison.maxSaving)} économisés
                </Text>
              </Surface>
            )}
            {comparison.estimates.map((e, i) => (
              <Surface key={e.provider} style={styles.row} elevation={1} testID={`fee-row-${e.provider}`}>
                <Avatar.Icon
                  icon={providerIcon(e.provider)}
                  size={40}
                  color="#fff"
                  style={{ backgroundColor: providerColor(e.provider) }}
                />
                <View style={styles.rowBody}>
                  <Text variant="titleSmall">{PROVIDER_LABELS[e.provider]}</Text>
                  <Text variant="labelSmall" style={styles.muted}>
                    {formatRate(e.rate)} · {e.samples} opération{e.samples > 1 ? 's' : ''}
                    {e.confidence === 'LOW' ? ' · estimation indicative' : ''}
                  </Text>
                </View>
                <View style={styles.rowEnd}>
                  <Text variant="titleMedium" style={[styles.fee, { color: i === 0 ? palette.green : palette.red }]}>
                    {formatFCFA(e.fee)}
                  </Text>
                  {i === 0 && comparison.estimates.length > 1 && (
                    <Chip compact icon="trophy-outline" style={styles.best} textStyle={styles.bestText}>
                      Le moins cher
                    </Chip>
                  )}
                </View>
              </Surface>
            ))}
          </>
        )}
        <Button onPress={onDismiss} style={styles.block}>
          Fermer
        </Button>
      </ScrollView>
    </AppModal>
  );
};

const styles = StyleSheet.create({
  title: { fontWeight: '800' },
  muted: { opacity: 0.7 },
  block: { marginVertical: 10 },
  empty: { alignItems: 'center', padding: 20, borderRadius: 16, backgroundColor: 'transparent' },
  emptyText: { textAlign: 'center', marginTop: 10, opacity: 0.75 },
  saving: { padding: 12, borderRadius: 14, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 16, marginBottom: 8, gap: 12 },
  rowBody: { flex: 1 },
  rowEnd: { alignItems: 'flex-end' },
  fee: { fontWeight: '800' },
  best: { marginTop: 4, backgroundColor: '#E3F4EC' },
  bestText: { fontSize: 11, color: palette.green },
});
