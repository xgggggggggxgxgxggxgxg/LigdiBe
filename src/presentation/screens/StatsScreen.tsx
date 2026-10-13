import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, Share, StyleSheet, View } from 'react-native';
import { Button, Card, List, ProgressBar, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatFCFA } from '../../core/currency';
import { formatMonthLabel, monthKey } from '../../core/dates';
import { getRepositories } from '../../data/repositories';
import {
  buildInsights,
  spendingByCategory,
  topRecipients,
  totalAirtime,
  totalCashWithdrawn,
  totalFees,
} from '../../domain/usecases/Statistics';
import { exportJsonBackup, exportTransactionsCsv } from '../../services/export/ExportService';
import { StatTile } from '../components/StatTile';
import { useFinanceStore } from '../store/useFinanceStore';
import { palette } from '../theme/theme';

export const StatsScreen = () => {
  const transactions = useFinanceStore(s => s.transactions);
  const now = useFinanceStore(s => s.now);
  const [exporting, setExporting] = useState(false);
  const month = monthKey(now);
  const monthTxs = useMemo(() => transactions.filter(t => t.occurredAt.startsWith(month)), [transactions, month]);
  const top = useMemo(() => topRecipients(monthTxs, 5), [monthTxs]);
  const categories = useMemo(() => spendingByCategory(monthTxs).slice(0, 8), [monthTxs]);
  const insights = useMemo(() => buildInsights(monthTxs), [monthTxs]);
  const fees = totalFees(monthTxs);
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
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text variant="headlineSmall" style={styles.bold}>
          Statistiques — {formatMonthLabel(month)}
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
        </View>

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
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surface },
  content: { padding: 16, paddingBottom: 48 },
  bold: { fontWeight: '800' },
  tiles: { flexDirection: 'row', gap: 10, marginTop: 10 },
  card: { marginTop: 14, backgroundColor: '#fff' },
  empty: { textAlign: 'center', margin: 12, opacity: 0.6 },
  amount: { alignSelf: 'center', fontWeight: '700' },
  catRow: { marginBottom: 10 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between' },
  bar: { height: 8, borderRadius: 4, marginTop: 4 },
  insight: { marginBottom: 6 },
});
