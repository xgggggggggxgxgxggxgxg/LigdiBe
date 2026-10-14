import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import {
  Appbar,
  Avatar,
  Button,
  Card,
  Icon,
  IconButton,
  ProgressBar,
  SegmentedButtons,
  Surface,
  Text,
  useTheme,
} from 'react-native-paper';
import { formatFCFA } from '../../core/currency';
import type { Transaction } from '../../domain/models/Transaction';
import {
  dataInsights,
  formatVolume,
  isDataPurchase,
  periodRange,
  summarizeData,
  type DataBucket,
  type DataPeriod,
} from '../../domain/usecases/DataTracker';
import { PROVIDER_LABELS } from '../../domain/usecases/ProcessIncomingSms';
import { AmountInput, parseInputAmount } from '../components/AmountInput';
import { Screen } from '../components/Screen';
import { StatTile } from '../components/StatTile';
import { TransactionItem } from '../components/TransactionItem';
import { useFinanceStore } from '../store/useFinanceStore';
import { palette, providerColor, providerIcon } from '../theme/theme';

/** Teintes de barres validées (bande de luminance + contraste) pour chaque thème. */
const BAR_LIGHT = '#0F7B5F';
const BAR_DARK = '#24A076';

const BarChart = ({ buckets, dark }: { buckets: DataBucket[]; dark: boolean }) => {
  const theme = useTheme();
  const [selected, setSelected] = useState<string>();
  const max = Math.max(1, ...buckets.map(b => b.spent));
  const sel = buckets.find(b => b.key === selected);
  const dense = buckets.length > 12;
  return (
    <View testID="data-chart">
      <View style={styles.tooltipRow}>
        {sel ? (
          <Text variant="labelLarge" testID="data-chart-tooltip">
            {sel.label}
            {dense ? ` · ${sel.key.slice(8, 10)}/${sel.key.slice(5, 7)}` : ''} : {formatFCFA(sel.spent)}
            {sel.volumeMb > 0 ? ` · ${formatVolume(sel.volumeMb)}` : ''}
          </Text>
        ) : (
          <Text variant="labelSmall" style={styles.muted}>
            Touche une barre pour voir le détail
          </Text>
        )}
      </View>
      <View style={styles.chart} accessibilityRole="image" accessibilityLabel="Dépenses en forfaits par période">
        {buckets.map((b, i) => {
          const h = b.spent > 0 ? Math.max(4, (b.spent / max) * 120) : 0;
          const active = b.key === selected;
          return (
            <Pressable
              key={b.key}
              style={styles.barSlot}
              onPress={() => setSelected(active ? undefined : b.key)}
              hitSlop={4}
              accessibilityLabel={`${b.label} : ${formatFCFA(b.spent)}`}
              testID={`bar-${b.key}`}>
              <View style={[styles.barTrack, { borderBottomColor: theme.colors.outlineVariant }]}>
                <View
                  style={[
                    styles.bar,
                    selected && !active ? styles.barDimmed : undefined,
                    { height: h, backgroundColor: dark ? BAR_DARK : BAR_LIGHT },
                  ]}
                />
              </View>
              <Text
                variant="labelSmall"
                style={[styles.barLabel, { color: theme.colors.onSurfaceVariant }]}
                numberOfLines={1}>
                {!dense || i % 5 === 0 || i === buckets.length - 1 ? b.label : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
};

export const DataTrackerScreen = ({ navigation }: { navigation?: { goBack: () => void } }) => {
  const theme = useTheme();
  const recent = useFinanceStore(s => s.transactions);
  const loadAll = useFinanceStore(s => s.loadAllTransactions);
  const limit = useFinanceStore(s => s.monthlyDataLimit);
  const setLimit = useFinanceStore(s => s.setMonthlyDataLimit);
  const [all, setAll] = useState<Transaction[]>(recent);
  const [period, setPeriod] = useState<DataPeriod>('MONTH');
  const [offset, setOffset] = useState(0);
  const [editingLimit, setEditingLimit] = useState(false);
  const [limitInput, setLimitInput] = useState(limit > 0 ? String(limit) : '');

  useEffect(() => {
    loadAll().then(setAll, () => setAll(recent));
  }, [loadAll, recent]);

  const now = useMemo(() => new Date(), []);
  const range = useMemo(() => periodRange(period, now, offset), [period, now, offset]);
  const summary = useMemo(() => summarizeData(all, range), [all, range]);
  const previous = useMemo(() => summarizeData(all, periodRange(period, now, offset - 1)), [all, period, now, offset]);
  const insights = useMemo(() => dataInsights(summary, previous, limit), [summary, previous, limit]);
  const purchases = useMemo(
    () =>
      all
        .filter(t => isDataPurchase(t) && t.occurredAt >= range.from && t.occurredAt < range.to)
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
        .slice(0, 30),
    [all, range],
  );
  const total = summary.spent + summary.fromCreditAmount;
  const showLimit = period === 'MONTH';
  const limitRatio = limit > 0 ? total / limit : 0;
  const limitColor = limitRatio > 1 ? palette.red : limitRatio >= 0.8 ? palette.orange : palette.green;

  return (
    <Screen>
      <Appbar.Header mode="small" elevated={false} style={{ backgroundColor: theme.colors.background }}>
        {navigation && <Appbar.BackAction onPress={navigation.goBack} testID="data-back" />}
        <Appbar.Content title="Internet & crédit" />
      </Appbar.Header>
      <ScrollView contentContainerStyle={styles.content}>
        <SegmentedButtons
          value={period}
          onValueChange={v => {
            setPeriod(v as DataPeriod);
            setOffset(0);
          }}
          buttons={[
            { value: 'WEEK', label: 'Semaine', testID: 'period-WEEK' },
            { value: 'MONTH', label: 'Mois', testID: 'period-MONTH' },
            { value: 'YEAR', label: 'Année', testID: 'period-YEAR' },
          ]}
        />
        <View style={styles.periodNav}>
          <IconButton icon="chevron-left" onPress={() => setOffset(o => o - 1)} testID="data-prev" />
          <Text variant="titleMedium" style={styles.bold} testID="data-period-label">
            {range.label}
          </Text>
          <IconButton
            icon="chevron-right"
            disabled={offset >= 0}
            onPress={() => setOffset(o => o + 1)}
            testID="data-next"
          />
        </View>

        <Surface style={[styles.hero, { backgroundColor: theme.colors.primary }]} elevation={2} testID="data-hero">
          <View style={styles.rowCenter}>
            <Icon source="web" size={20} color={theme.colors.onPrimary} />
            <Text variant="labelLarge" style={[styles.heroMuted, { color: theme.colors.onPrimary }]}>
              Forfaits internet
            </Text>
          </View>
          <Text
            variant="displaySmall"
            style={[styles.heroValue, { color: theme.colors.onPrimary }]}
            testID="data-total">
            {formatFCFA(total)}
          </Text>
          <View style={styles.heroStats}>
            <HeroStat label="Volume" value={summary.volumeMb > 0 ? formatVolume(summary.volumeMb) : '—'} />
            <HeroStat label="Forfaits" value={String(summary.purchases)} />
            <HeroStat label="Prix du Go" value={summary.costPerGb !== undefined ? `${summary.costPerGb} F` : '—'} />
          </View>
          {summary.unknownVolumeCount > 0 && (
            <Text variant="labelSmall" style={[styles.heroMuted, { color: theme.colors.onPrimary }]}>
              {summary.unknownVolumeCount} forfait(s) sans volume lisible dans le SMS
            </Text>
          )}
        </Surface>

        {showLimit && (
          <Card style={styles.card} testID="data-limit-card">
            <Card.Title
              title="Plafond data du mois"
              subtitle={limit > 0 ? `${formatFCFA(total)} / ${formatFCFA(limit)}` : 'Fixe une limite pour être alerté'}
              right={() => (
                <IconButton
                  icon={editingLimit ? 'close' : 'pencil-outline'}
                  onPress={() => setEditingLimit(e => !e)}
                  testID="edit-data-limit"
                />
              )}
            />
            <Card.Content>
              {editingLimit ? (
                <View style={styles.rowCenter}>
                  <View style={styles.flex}>
                    <AmountInput
                      label="Plafond mensuel"
                      value={limitInput}
                      onChangeText={setLimitInput}
                      testID="data-limit-input"
                    />
                  </View>
                  <Button
                    mode="contained"
                    onPress={async () => {
                      await setLimit(parseInputAmount(limitInput));
                      setEditingLimit(false);
                    }}
                    testID="save-data-limit">
                    OK
                  </Button>
                </View>
              ) : (
                limit > 0 && (
                  <>
                    <ProgressBar progress={Math.min(1, limitRatio)} color={limitColor} style={styles.progress} />
                    <View style={styles.rowCenter}>
                      <Icon
                        source={
                          limitRatio > 1
                            ? 'alert-octagon-outline'
                            : limitRatio >= 0.8
                            ? 'alert-outline'
                            : 'check-circle-outline'
                        }
                        size={16}
                        color={limitColor}
                      />
                      <Text variant="labelMedium" testID="data-limit-status">
                        {limitRatio > 1
                          ? `Dépassé de ${formatFCFA(total - limit)}`
                          : `Il reste ${formatFCFA(limit - total)}`}
                      </Text>
                    </View>
                  </>
                )
              )}
            </Card.Content>
          </Card>
        )}

        <Card style={styles.card}>
          <Card.Title title="Dépenses en forfaits" subtitle={range.label} />
          <Card.Content>
            {summary.purchases === 0 ? (
              <Text style={styles.empty} testID="data-empty">
                Aucun forfait sur cette période. Les achats de pass internet par MoMo apparaissent ici automatiquement.
              </Text>
            ) : (
              <BarChart buckets={summary.buckets} dark={theme.dark} />
            )}
          </Card.Content>
        </Card>

        <View style={styles.tiles}>
          <StatTile
            icon="phone-outline"
            label="Crédit d'appel"
            value={formatFCFA(summary.voiceSpent)}
            hint="Recharges voix"
            color={palette.orange}
          />
          <StatTile
            icon="swap-horizontal"
            label="Payé avec le crédit"
            value={formatFCFA(summary.fromCreditAmount)}
            hint={`${summary.fromCreditCount} forfait(s)`}
            color={palette.gold}
          />
        </View>

        {summary.byProvider.length > 0 && (
          <Card style={styles.card}>
            <Card.Title title="Par opérateur" />
            <Card.Content>
              {summary.byProvider.map(p => (
                <View key={p.provider} style={styles.providerRow} testID={`data-provider-${p.provider}`}>
                  <Avatar.Icon
                    icon={providerIcon(p.provider)}
                    size={36}
                    color="#fff"
                    style={{ backgroundColor: providerColor(p.provider) }}
                  />
                  <View style={styles.flex}>
                    <Text variant="titleSmall">{PROVIDER_LABELS[p.provider]}</Text>
                    <Text variant="labelSmall" style={styles.muted}>
                      {p.count} forfait(s){p.volumeMb > 0 ? ` · ${formatVolume(p.volumeMb)}` : ''}
                      {p.costPerGb !== undefined ? ` · ${p.costPerGb} F/Go` : ''}
                    </Text>
                  </View>
                  <Text variant="titleSmall" style={styles.bold}>
                    {formatFCFA(p.spent)}
                  </Text>
                </View>
              ))}
            </Card.Content>
          </Card>
        )}

        {summary.topPacks.length > 0 && (
          <Card style={styles.card}>
            <Card.Title title="Forfaits les plus achetés" />
            <Card.Content>
              {summary.topPacks.map((p, i) => (
                <View key={p.label} style={styles.packRow}>
                  <Text variant="titleMedium" style={[styles.rank, { color: theme.colors.primary }]}>
                    {i + 1}
                  </Text>
                  <Text variant="bodyMedium" style={styles.flex}>
                    {p.label}
                  </Text>
                  <Text variant="labelLarge">
                    ×{p.count} · {formatFCFA(p.total)}
                  </Text>
                </View>
              ))}
            </Card.Content>
          </Card>
        )}

        {insights.length > 0 && (
          <Card style={styles.card} testID="data-insights">
            <Card.Title title="Conseils" left={props => <Avatar.Icon {...props} icon="lightbulb-on-outline" />} />
            <Card.Content>
              {insights.map(i => (
                <View key={i.id} style={styles.insight}>
                  <Icon source={i.icon} size={18} color={theme.colors.primary} />
                  <Text variant="bodyMedium" style={styles.flex}>
                    {i.message}
                  </Text>
                </View>
              ))}
            </Card.Content>
          </Card>
        )}

        {purchases.length > 0 && (
          <Card style={styles.card}>
            <Card.Title title="Derniers forfaits" />
            {purchases.map(t => (
              <TransactionItem key={t.id} transaction={t} />
            ))}
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
};

const HeroStat = ({ label, value }: { label: string; value: string }) => {
  const theme = useTheme();
  return (
    <View style={styles.heroStat}>
      <Text variant="titleMedium" style={[styles.bold, { color: theme.colors.onPrimary }]}>
        {value}
      </Text>
      <Text variant="labelSmall" style={[styles.heroMuted, { color: theme.colors.onPrimary }]}>
        {label}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48 },
  bold: { fontWeight: '800' },
  muted: { opacity: 0.7 },
  flex: { flex: 1 },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  periodNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  hero: { borderRadius: 24, padding: 20 },
  heroMuted: { opacity: 0.85 },
  heroValue: { fontWeight: '800', marginVertical: 4 },
  heroStats: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, marginBottom: 4 },
  heroStat: { alignItems: 'flex-start' },
  card: { marginTop: 14 },
  progress: { height: 10, borderRadius: 5, marginBottom: 8 },
  empty: { textAlign: 'center', opacity: 0.7, marginVertical: 12 },
  tooltipRow: { minHeight: 22, marginBottom: 6 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', height: 144 },
  barSlot: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', paddingHorizontal: 1 },
  barTrack: {
    height: 124,
    width: '100%',
    justifyContent: 'flex-end',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  bar: { width: '80%', maxWidth: 22, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  barDimmed: { opacity: 0.45 },
  barLabel: { fontSize: 10, marginTop: 4 },
  tiles: { flexDirection: 'row', gap: 10, marginTop: 14 },
  providerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  packRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  rank: { fontWeight: '800', width: 18 },
  insight: { flexDirection: 'row', gap: 10, marginBottom: 10, alignItems: 'flex-start' },
});
