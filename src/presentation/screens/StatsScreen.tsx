import React, { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, Share, StyleSheet, View } from 'react-native';
import { Avatar, Button, Card, IconButton, List, ProgressBar, Text } from 'react-native-paper';
import { Screen } from '../components/Screen';
import { formatFCFA } from '../../core/currency';
import { formatMonthLabel, monthKey, nextMonthKey, previousMonthKey } from '../../core/dates';
import type { Transaction } from '../../domain/models/Transaction';
import { getRepositories } from '../../data/repositories';
import {
  buildInsights,
  compareMonths,
  familySupport,
  spendingByCategory,
  topRecipients,
  totalAirtime,
  totalCashWithdrawn,
  totalFees,
} from '../../domain/usecases/Statistics';
import { exportJsonBackup, exportTransactionsCsv } from '../../services/export/ExportService';
import { potentialSavings } from '../../domain/usecases/FeeComparator';
import { FeeComparatorModal } from '../components/FeeComparatorModal';
import { StatTile } from '../components/StatTile';
import { useFinanceStore } from '../store/useFinanceStore';
import { palette } from '../theme/theme';

export const StatsScreen = () => {
  const transactions = useFinanceStore(s => s.transactions);
  const now = useFinanceStore(s => s.now);
  const getMonthTransactions = useFinanceStore(s => s.getMonthTransactions);
  const [exporting, setExporting] = useState(false);
  const currentMonth = monthKey(now);
  const [month, setMonth] = useState(currentMonth);
  const [monthTxs, setMonthTxs] = useState<Transaction[]>([]);
  const [prevTxs, setPrevTxs] = useState<Transaction[]>([]);

  useEffect(() => {
    let alive = true;
    Promise.all([getMonthTransactions(month), getMonthTransactions(previousMonthKey(month))]).then(([cur, prev]) => {
      if (alive) {
        setMonthTxs(cur);
        setPrevTxs(prev);
      }
    });
    return () => {
      alive = false;
    };
    // `transactions` : recharge quand un nouveau SMS arrive.
  }, [month, transactions, getMonthTransactions]);

  const comparison = useMemo(
    () => compareMonths(monthTxs, prevTxs, formatMonthLabel(previousMonthKey(month)).split(' ')[0]),
    [monthTxs, prevTxs, month],
  );
  const top = useMemo(() => topRecipients(monthTxs, 5), [monthTxs]);
  const categories = useMemo(() => spendingByCategory(monthTxs).slice(0, 8), [monthTxs]);
  const insights = useMemo(() => buildInsights(monthTxs), [monthTxs]);
  const family = useMemo(() => familySupport(monthTxs), [monthTxs]);
  const fees = totalFees(monthTxs);
  const savings = useMemo(() => potentialSavings(monthTxs, transactions), [monthTxs, transactions]);
  const [comparing, setComparing] = useState(false);
  const airtime = totalAirtime(monthTxs);

  const runExport = async (kind: 'csv' | 'json') => {
    setExporting(true);
    try {
      const repos = await getRepositories();
      const res = kind === 'csv' ? await exportTransactionsCsv(repos) : await exportJsonBackup(repos, month);
      Alert.alert('Export réussi ✅', `${res.count} opérations exportées dans :\n${res.path}`);
    } catch (e) {
      Alert.alert('Export impossible', e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  const shareSummary = () =>
    Share.share({
      message:
        `Mon bilan ${formatMonthLabel(month)} avec LigdiBe 💚\n` +
        insights.map(i => `• ${i.message}`).join('\n') +
        '\nEt toi, tu sais où part ton argent ? Télécharge LigdiBe : 100 % hors-ligne, tes SMS MoMo deviennent un budget.',
    });

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.monthNav}>
          <IconButton icon="chevron-left" onPress={() => setMonth(previousMonthKey(month))} testID="prev-month" />
          <Text variant="titleLarge" style={styles.bold} testID="stats-month">
            {formatMonthLabel(month)}
          </Text>
          <IconButton
            icon="chevron-right"
            disabled={month >= currentMonth}
            onPress={() => setMonth(nextMonthKey(month))}
            testID="next-month"
          />
        </View>
        <Text style={styles.comparison} testID="month-comparison">
          {comparison.message}
        </Text>
        <View style={styles.tiles}>
          <StatTile
            testID="fees-tile"
            icon="percent-outline"
            label="Frais & taxes MoMo"
            value={formatFCFA(fees)}
            color={palette.red}
          />
          <StatTile
            icon="cellphone-wireless"
            label="Crédit d'appel"
            value={formatFCFA(airtime)}
            color={palette.orange}
          />
        </View>
        <View style={styles.tiles}>
          <StatTile
            icon="cash-fast"
            label="Retiré en espèces"
            value={formatFCFA(totalCashWithdrawn(monthTxs))}
            hint="Non compté en dépense"
          />
          <StatTile
            testID="family-tile"
            icon="hand-heart-outline"
            label="Solidarité famille"
            value={formatFCFA(family.total)}
            hint={
              family.shareOfIncome > 0
                ? `${Math.round(family.shareOfIncome * 100)} % des entrées`
                : `${family.people} proche(s)`
            }
            color={palette.gold}
          />
        </View>

        <Card style={styles.card} testID="fee-comparator-card">
          <Card.Title
            title="Comparateur de frais"
            subtitle={
              savings > 0
                ? `Économie possible ce mois : ${formatFCFA(savings)}`
                : 'Quel opérateur est le moins cher pour toi ?'
            }
            left={props => <Avatar.Icon {...props} icon="scale-balance" />}
          />
          <Card.Actions>
            <Button
              icon="calculator-variant-outline"
              mode="contained-tonal"
              onPress={() => setComparing(true)}
              testID="open-fee-comparator">
              Simuler
            </Button>
          </Card.Actions>
        </Card>

        <Card style={styles.card}>
          <Card.Title title="Top 5 : à qui j'envoie le plus" />
          {top.length === 0 && <Text style={styles.empty}>Pas encore de transferts ce mois-ci.</Text>}
          {top.map((r, i) => (
            <List.Item
              key={r.key}
              title={`${i + 1}. ${r.name}`}
              description={`${r.count} envoi(s)${r.phone ? ` · ${r.phone}` : ''}`}
              right={() => <Text style={styles.amount}>{formatFCFA(r.total)}</Text>}
            />
          ))}
        </Card>

        <Card style={styles.card}>
          <Card.Title title="Où part mon argent" />
          <Card.Content>
            {categories.length === 0 && <Text style={styles.empty}>Aucune dépense ce mois-ci.</Text>}
            {categories.map(c => (
              <View key={c.category} style={styles.catRow}>
                <View style={styles.rowBetween}>
                  <Text>{c.category}</Text>
                  <Text style={styles.bold}>{formatFCFA(c.total)}</Text>
                </View>
                <ProgressBar progress={c.share} color={palette.green} style={styles.bar} />
              </View>
            ))}
          </Card.Content>
        </Card>

        {insights.length > 0 && (
          <Card style={styles.card}>
            <Card.Title title="Le saviez-vous ?" />
            <Card.Content>
              {insights.map(i => (
                <Text key={i.id} style={styles.insight}>
                  • {i.message}
                </Text>
              ))}
            </Card.Content>
            <Card.Actions>
              <Button icon="share-variant" onPress={shareSummary}>
                Partager mon bilan
              </Button>
            </Card.Actions>
          </Card>
        )}

        <Card style={styles.card}>
          <Card.Title title="Exporter les données" subtitle="Fichiers horodatés dans Téléchargements" />
          <Card.Actions>
            <Button
              icon="file-delimited-outline"
              mode="contained"
              loading={exporting}
              disabled={exporting}
              onPress={() => runExport('csv')}
              testID="export-csv">
              CSV
            </Button>
            <Button icon="code-json" disabled={exporting} onPress={() => runExport('json')}>
              Sauvegarde JSON
            </Button>
          </Card.Actions>
        </Card>
      </ScrollView>
      <FeeComparatorModal visible={comparing} onDismiss={() => setComparing(false)} />
    </Screen>
  );
};

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48 },
  bold: { fontWeight: '800' },
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  comparison: { textAlign: 'center', opacity: 0.8 },
  tiles: { flexDirection: 'row', gap: 10, marginTop: 10 },
  card: { marginTop: 14 },
  empty: { textAlign: 'center', margin: 12, opacity: 0.6 },
  amount: { alignSelf: 'center', fontWeight: '700' },
  catRow: { marginBottom: 10 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between' },
  bar: { height: 8, borderRadius: 4, marginTop: 4 },
  insight: { marginBottom: 6 },
});
