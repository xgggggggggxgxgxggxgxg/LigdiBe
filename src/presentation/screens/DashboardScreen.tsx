import React, { useMemo, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Chip, FAB, IconButton, Text } from 'react-native-paper';
import { Screen } from '../components/Screen';
import { formatFCFA } from '../../core/currency';
import type { Transaction } from '../../domain/models/Transaction';
import { AddTransactionModal } from '../components/AddTransactionModal';
import { BalanceCard } from '../components/BalanceCard';
import { ChallengeCard } from '../components/ChallengeCard';
import { DailyBudgetCard } from '../components/DailyBudgetCard';
import { StatTile } from '../components/StatTile';
import { TransactionDetailModal } from '../components/TransactionDetailModal';
import { TransactionItem } from '../components/TransactionItem';
import { useAccounts } from '../hooks/useAccounts';
import { useAirtime } from '../hooks/useAirtime';
import { useBudget } from '../hooks/useBudget';
import { useFinanceStore } from '../store/useFinanceStore';
import { palette } from '../theme/theme';

export type QuickFilter = 'ALL' | 'EXPENSE' | 'INCOME' | 'CASH' | 'AIRTIME' | 'FEE';

const FILTERS: ReadonlyArray<{ id: QuickFilter; label: string; icon: string }> = [
  { id: 'ALL', label: 'Tout', icon: 'format-list-bulleted' },
  { id: 'EXPENSE', label: 'Dépenses', icon: 'cart-outline' },
  { id: 'INCOME', label: 'Entrées', icon: 'arrow-bottom-left' },
  { id: 'CASH', label: 'Retraits/Dépôts', icon: 'cash-fast' },
  { id: 'AIRTIME', label: 'Crédit', icon: 'cellphone-wireless' },
  { id: 'FEE', label: 'Frais', icon: 'percent-outline' },
];

export const filterTransactions = (txs: ReadonlyArray<Transaction>, f: QuickFilter): Transaction[] =>
  txs.filter(t => {
    switch (f) {
      case 'EXPENSE':
        return t.type === 'EXPENSE';
      case 'INCOME':
        return t.type === 'INCOME';
      case 'CASH':
        return ['CASH_WITHDRAWAL', 'CASH_DEPOSIT', 'AGENT_DEPOSIT', 'CASH_OUT'].includes(t.type);
      case 'AIRTIME':
        return t.type === 'AIRTIME_RECHARGE';
      case 'FEE':
        return t.type === 'FEE';
      default:
        return true;
    }
  });

export const DashboardScreen = () => {
  const { accounts, totalBalance } = useAccounts();
  const budget = useBudget();
  const airtime = useAirtime();
  const transactions = useFinanceStore(s => s.transactions);
  const userName = useFinanceStore(s => s.userName);
  const monthlyBudget = useFinanceStore(s => s.budgetConfig.monthlyBudget);
  const hydrate = useFinanceStore(s => s.hydrate);
  const [filter, setFilter] = useState<QuickFilter>('ALL');
  const [hidden, setHidden] = useState(false);
  const [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<Transaction>();

  const list = useMemo(
    () =>
      filterTransactions(transactions, filter)
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
        .slice(0, 100),
    [transactions, filter],
  );

  const header = (
    <View>
      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <Text variant="titleMedium" style={styles.heroText}>
            {userName ? `Bonjour ${userName} 👋🏾` : 'Bonjour 👋🏾'}
          </Text>
          <IconButton
            icon={hidden ? 'eye-off' : 'eye'}
            iconColor="#fff"
            onPress={() => setHidden(h => !h)}
            testID="toggle-hide"
          />
        </View>
        <Text variant="labelLarge" style={styles.heroMuted}>
          Patrimoine total (MoMo + Banque + Poche)
        </Text>
        <Text variant="displaySmall" style={styles.total} testID="total-balance">
          {hidden ? '••••••' : formatFCFA(totalBalance)}
        </Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.carousel}>
        {accounts.map(a => (
          <BalanceCard key={a.id} account={a} hidden={hidden} />
        ))}
      </ScrollView>
      <DailyBudgetCard budget={budget} streak={budget.streak} />
      <ChallengeCard />
      <View style={styles.tiles}>
        <StatTile
          testID="airtime-tile"
          icon="cellphone-wireless"
          label="Crédit & data (mois)"
          value={formatFCFA(airtime.monthly_airtime_spent)}
          hint={`Jour ${formatFCFA(airtime.daily_airtime_spent, { withUnit: false })} · An ${formatFCFA(
            airtime.yearly_airtime_spent,
            { withUnit: false },
          )}`}
          color={airtime.isOverMonthlyLimit ? palette.red : palette.green}
        />
        <StatTile
          icon="trending-up"
          label="Projection fin de mois"
          value={formatFCFA(budget.projectedMonthSpent)}
          hint={`Budget ${formatFCFA(monthlyBudget, { withUnit: false })}`}
          color={budget.projectedMonthSpent > monthlyBudget ? palette.red : palette.green}
        />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        {FILTERS.map(f => (
          <Chip
            key={f.id}
            icon={f.icon}
            selected={filter === f.id}
            onPress={() => setFilter(f.id)}
            style={styles.filter}
            testID={`filter-${f.id}`}>
            {f.label}
          </Chip>
        ))}
      </ScrollView>
    </View>
  );

  return (
    <Screen>
      <FlatList
        data={list}
        keyExtractor={t => t.id}
        ListHeaderComponent={header}
        renderItem={({ item }) => <TransactionItem transaction={item} onPress={setSelected} />}
        ListEmptyComponent={
          <Text style={styles.empty}>
            Aucune opération pour l'instant. Les SMS Orange Money, Moov Money, Wave… apparaîtront ici automatiquement.
          </Text>
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await hydrate();
              setRefreshing(false);
            }}
          />
        }
        contentContainerStyle={styles.listContent}
      />
      <FAB icon="plus" label="Dépense cash" style={styles.fab} onPress={() => setAdding(true)} testID="fab-add" />
      <AddTransactionModal visible={adding} onDismiss={() => setAdding(false)} />
      <TransactionDetailModal transaction={selected} onDismiss={() => setSelected(undefined)} />
    </Screen>
  );
};

const styles = StyleSheet.create({
  hero: {
    backgroundColor: palette.green,
    paddingHorizontal: 20,
    paddingBottom: 28,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroText: { color: '#fff' },
  heroMuted: { color: '#fff', opacity: 0.8 },
  total: { color: '#fff', fontWeight: '800' },
  carousel: { paddingHorizontal: 16, marginTop: -18, paddingBottom: 4 },
  tiles: { flexDirection: 'row', gap: 10, marginHorizontal: 16, marginTop: 12 },
  filters: { paddingHorizontal: 16, paddingVertical: 12, gap: 6 },
  filter: { marginRight: 4 },
  listContent: { paddingBottom: 96 },
  empty: { textAlign: 'center', margin: 24, opacity: 0.6 },
  fab: { position: 'absolute', right: 16, bottom: 16, backgroundColor: palette.gold },
});
