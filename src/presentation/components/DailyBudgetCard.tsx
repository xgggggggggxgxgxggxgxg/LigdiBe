import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Card, Chip, ProgressBar, Text } from 'react-native-paper';
import { formatFCFA } from '../../core/currency';
import type { DailyBudgetResult } from '../../domain/usecases/CalculateDailyBudget';
import { palette } from '../theme/theme';

interface Props {
  budget: DailyBudgetResult;
  streak?: number;
}

const statusColor = (status: DailyBudgetResult['status']) =>
  status === 'EXCEEDED' ? palette.red : status === 'WARNING' ? palette.orange : palette.green;

export const DailyBudgetCard = ({ budget, streak = 0 }: Props) => {
  const color = statusColor(budget.status);
  const exceeded = budget.status === 'EXCEEDED';
  return (
    <Card style={[styles.card, exceeded && styles.exceeded]} testID="daily-budget-card">
      <Card.Content>
        <View style={styles.header}>
          <Text variant="titleMedium">Enveloppe du jour</Text>
          <View style={styles.chips}>
            {budget.todayMultiplier > 1 && (
              <Chip compact icon="party-popper" testID="weekend-chip">
                ×{budget.todayMultiplier.toFixed(2).replace(/\.?0+$/, '')}
              </Chip>
            )}
            {streak > 0 && (
              <Chip compact icon="fire" testID="streak-chip">
                {streak} j
              </Chip>
            )}
          </View>
        </View>
        <Text variant="headlineMedium" style={[styles.amount, { color }]}>
          {formatFCFA(budget.todayRemaining)}
        </Text>
        <Text variant="bodySmall" style={styles.muted}>
          {exceeded ? 'de dépassement — ' : 'restants — '}
          {formatFCFA(budget.todaySpent)} dépensés sur {formatFCFA(budget.todayBudget)}
        </Text>
        <ProgressBar
          progress={Math.min(1, Number.isFinite(budget.progress) ? budget.progress : 1)}
          color={color}
          style={styles.bar}
        />
        {exceeded && (
          <Text variant="bodySmall" style={{ color: palette.red }} testID="budget-alert">
            ⚠️ Enveloppe dépassée : les jours suivants sont ré-équilibrés automatiquement.
          </Text>
        )}
        <View style={styles.footer}>
          <Text variant="labelSmall" style={styles.muted}>
            Mois : {formatFCFA(budget.monthSpent)} ({Math.round(budget.monthProgress * 100)} %)
          </Text>
          <Text variant="labelSmall" style={styles.muted}>
            {budget.remainingDays} j restants
          </Text>
        </View>
      </Card.Content>
    </Card>
  );
};

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, marginTop: 12, borderRadius: 16, backgroundColor: '#fff' },
  exceeded: { borderWidth: 1.5, borderColor: palette.red },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chips: { flexDirection: 'row', gap: 6 },
  amount: { fontWeight: '800', marginTop: 6 },
  muted: { opacity: 0.65 },
  bar: { height: 10, borderRadius: 5, marginVertical: 10 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
});
