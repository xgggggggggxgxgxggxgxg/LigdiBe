import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import {
  Banner,
  Button,
  Card,
  Checkbox,
  Chip,
  Divider,
  IconButton,
  List,
  Modal,
  Portal,
  ProgressBar,
  SegmentedButtons,
  Switch,
  Text,
  TextInput,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CATEGORIES } from '../../core/categories';
import { formatFCFA } from '../../core/currency';
import { formatMonthLabel, monthKey } from '../../core/dates';
import type { PlannedItem, PlannedKind } from '../../domain/models/PlannedItem';
import { suggestMatches, summarizeForecast } from '../../domain/usecases/BudgetForecast';
import { categoryEnvelopes } from '../../domain/usecases/CategoryBudgets';
import { AmountInput, parseInputAmount } from '../components/AmountInput';
import { CategoryPicker } from '../components/CategoryPicker';
import { StatTile } from '../components/StatTile';
import { useFinanceStore } from '../store/useFinanceStore';
import { palette } from '../theme/theme';

const AddPlannedModal = ({ visible, onDismiss }: { visible: boolean; onDismiss: () => void }) => {
  const savePlannedItem = useFinanceStore(s => s.savePlannedItem);
  const [kind, setKind] = useState<PlannedKind>('EXPENSE');
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [keywords, setKeywords] = useState('');
  const [category, setCategory] = useState<string>(CATEGORIES.BILLS);
  const [recurring, setRecurring] = useState(true);
  return (
    <Portal>
      <Modal visible={visible} onDismiss={onDismiss} contentContainerStyle={styles.modal}>
        <ScrollView keyboardShouldPersistTaps="handled">
          <Text variant="titleLarge" style={styles.bold}>
            Ligne prévisionnelle
          </Text>
          <SegmentedButtons
            value={kind}
            onValueChange={v => setKind(v as PlannedKind)}
            buttons={[
              { value: 'EXPENSE', label: 'Dépense prévue' },
              { value: 'INCOME', label: 'Gain prévu' },
            ]}
            style={styles.input}
          />
          <TextInput
            mode="outlined"
            label="Libellé (ex: Loyer, Salaire, Canal+)"
            value={label}
            onChangeText={setLabel}
            style={styles.input}
          />
          <AmountInput label="Montant" value={amount} onChangeText={setAmount} />
          <TextInput
            mode="outlined"
            label="Mots-clés de détection (nom dans le SMS)"
            placeholder="ex: KABORE, CANAL, SONABEL"
            value={keywords}
            onChangeText={setKeywords}
            style={styles.input}
          />
          {kind === 'EXPENSE' && <CategoryPicker value={category} onChange={setCategory} />}
          <View style={styles.rowBetween}>
            <Text>Reconduire chaque mois</Text>
            <Switch value={recurring} onValueChange={setRecurring} />
          </View>
          <Button
            mode="contained"
            disabled={!label.trim() || parseInputAmount(amount) <= 0}
            onPress={async () => {
              await savePlannedItem({
                label: label.trim(),
                amount: parseInputAmount(amount),
                kind,
                category: kind === 'INCOME' ? CATEGORIES.INCOME : category,
                keywords: keywords
                  .split(/[,;]/)
                  .map(k => k.trim())
                  .filter(Boolean),
                recurring,
              });
              setLabel('');
              setAmount('');
              setKeywords('');
              onDismiss();
            }}
            style={styles.input}>
            Ajouter
          </Button>
        </ScrollView>
      </Modal>
    </Portal>
  );
};

/** Sélection manuelle de la transaction qui réalise une ligne (coche via le nom de la transaction). */
const MatchModal = ({ item, onDismiss }: { item?: PlannedItem; onDismiss: () => void }) => {
  const transactions = useFinanceStore(s => s.transactions);
  const plannedItems = useFinanceStore(s => s.plannedItems);
  const togglePlannedItem = useFinanceStore(s => s.togglePlannedItem);
  const now = useFinanceStore(s => s.now);
  const [query, setQuery] = useState('');
  const candidates = useMemo(() => {
    if (!item) {
      return [];
    }
    const month = transactions.filter(t => t.occurredAt.startsWith(monthKey(now)));
    const used = new Set(plannedItems.map(p => p.matchedTransactionId).filter((x): x is string => !!x));
    const q = query.trim().toUpperCase();
    const ranked = suggestMatches({ ...item, keywords: [...item.keywords, ...(q ? [q] : [])] }, month, used).map(
      c => c.transaction,
    );
    const rest = month.filter(
      t =>
        !ranked.includes(t) &&
        !used.has(t.id) &&
        (q === '' || `${t.counterpartyName ?? ''} ${t.note ?? ''}`.toUpperCase().includes(q)),
    );
    return [...ranked, ...rest]
      .filter(t => (item.kind === 'INCOME' ? t.type === 'INCOME' : t.type !== 'INCOME' && t.type !== 'CASH_DEPOSIT'))
      .slice(0, 30);
  }, [item, transactions, plannedItems, query, now]);
  if (!item) {
    return null;
  }
  return (
    <Portal>
      <Modal visible onDismiss={onDismiss} contentContainerStyle={styles.modal}>
        <Text variant="titleMedium" style={styles.bold}>
          Quelle opération correspond à « {item.label} » ?
        </Text>
        <TextInput
          mode="outlined"
          dense
          label="Chercher un nom"
          value={query}
          onChangeText={setQuery}
          style={styles.input}
        />
        <ScrollView>
          {candidates.map(t => (
            <List.Item
              key={t.id}
              title={t.counterpartyName ?? t.note ?? t.category}
              description={`${t.occurredAt.slice(0, 10)} · ${formatFCFA(t.amount)}`}
              left={p => <List.Icon {...p} icon="link-variant" />}
              onPress={async () => {
                await togglePlannedItem(item.id, t.id);
                onDismiss();
              }}
            />
          ))}
          {candidates.length === 0 && <Text style={styles.empty}>Aucune opération trouvée ce mois-ci.</Text>}
        </ScrollView>
      </Modal>
    </Portal>
  );
};

export const ForecastScreen = () => {
  const plannedItems = useFinanceStore(s => s.plannedItems);
  const transactions = useFinanceStore(s => s.transactions);
  const now = useFinanceStore(s => s.now);
  const config = useFinanceStore(s => s.budgetConfig);
  const paidFixed = useFinanceStore(s => s.paidFixedExpenseIds);
  const togglePlannedItem = useFinanceStore(s => s.togglePlannedItem);
  const deletePlannedItem = useFinanceStore(s => s.deletePlannedItem);
  const toggleFixedExpensePaid = useFinanceStore(s => s.toggleFixedExpensePaid);
  const carryOver = useFinanceStore(s => s.carryOverToNextMonth);
  const autoCheck = useFinanceStore(s => s.autoCheckPlannedItems);
  const [adding, setAdding] = useState(false);
  const [matching, setMatching] = useState<PlannedItem>();
  const month = monthKey(now);
  const monthTxs = useMemo(() => transactions.filter(t => t.occurredAt.startsWith(month)), [transactions, month]);
  const summary = useMemo(() => summarizeForecast(plannedItems, monthTxs), [plannedItems, monthTxs]);
  const envelopes = useMemo(() => categoryEnvelopes(config, monthTxs), [config, monthTxs]);
  const sections: Array<[string, PlannedItem[]]> = [
    ['Gains prévus', plannedItems.filter(i => i.kind === 'INCOME')],
    ['Dépenses prévues', plannedItems.filter(i => i.kind === 'EXPENSE')],
  ];

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text variant="headlineSmall" style={styles.bold}>
          Prévisionnel — {formatMonthLabel(month)}
        </Text>
        <Banner visible={plannedItems.length > 0 && !summary.isViable} icon="alert" style={styles.banner}>
          Ton prévisionnel est déficitaire de {formatFCFA(-summary.plannedBalance)}. Reporte ou réduis certaines
          dépenses.
        </Banner>
        <View style={styles.tiles}>
          <StatTile
            icon="arrow-bottom-left"
            label="Gains prévus"
            value={formatFCFA(summary.plannedIncome)}
            hint={`Réel ${formatFCFA(summary.actualIncome)}`}
          />
          <StatTile
            icon="cart-outline"
            label="Dépenses prévues"
            value={formatFCFA(summary.plannedExpense)}
            hint={`Réel ${formatFCFA(summary.actualExpense)}`}
            color={palette.red}
          />
        </View>
        <View style={styles.tiles}>
          <StatTile
            icon="piggy-bank-outline"
            label="Épargne prévue"
            value={`${Math.round(summary.plannedSavingsRate * 100)} %`}
            hint={formatFCFA(summary.plannedBalance)}
            color={summary.isViable ? palette.green : palette.red}
          />
          <StatTile
            icon="help-circle-outline"
            label="Imprévus"
            value={formatFCFA(summary.unplannedExpense)}
            hint={`${summary.doneCount}/${summary.totalCount} lignes cochées`}
            color={palette.orange}
          />
        </View>

        {sections.map(([title, items]) => (
          <Card key={title} style={styles.card}>
            <Card.Title title={title} />
            {items.length === 0 && <Text style={styles.empty}>Aucune ligne.</Text>}
            {items.map(item => (
              <List.Item
                key={item.id}
                testID={`plan-${item.id}`}
                title={item.label}
                titleStyle={item.isDone ? styles.done : undefined}
                description={`${formatFCFA(item.amount)}${item.recurring ? ' · mensuel' : ''}${
                  item.matchedTransactionId ? ' · lié à une opération' : ''
                }`}
                onPress={() => setMatching(item)}
                left={() => (
                  <Checkbox status={item.isDone ? 'checked' : 'unchecked'} onPress={() => togglePlannedItem(item.id)} />
                )}
                right={() => <IconButton icon="delete-outline" onPress={() => deletePlannedItem(item.id)} />}
              />
            ))}
          </Card>
        ))}

        {envelopes.length > 0 && (
          <Card style={styles.card} testID="envelopes-card">
            <Card.Title title="Enveloppes par catégorie" subtitle="Plafonds mensuels (Réglages)" />
            <Card.Content>
              {envelopes.map(e => (
                <View key={e.category} style={styles.envelope}>
                  <View style={styles.rowBetween}>
                    <Text>{e.category}</Text>
                    <Text style={e.status === 'EXCEEDED' ? styles.over : undefined}>
                      {formatFCFA(e.spent, { withUnit: false })} / {formatFCFA(e.limit)}
                    </Text>
                  </View>
                  <ProgressBar
                    progress={Math.min(1, e.ratio)}
                    color={
                      e.status === 'EXCEEDED' ? palette.red : e.status === 'WARNING' ? palette.orange : palette.green
                    }
                    style={styles.bar}
                  />
                </View>
              ))}
            </Card.Content>
          </Card>
        )}

        {config.fixedExpenses.length > 0 && (
          <Card style={styles.card}>
            <Card.Title title="Charges fixes du mois" subtitle="Coche quand c'est payé" />
            {config.fixedExpenses.map(f => (
              <List.Item
                key={f.id}
                title={f.label}
                description={`${formatFCFA(f.amount)} · le ${f.dayOfMonth}`}
                left={() => (
                  <Checkbox
                    status={paidFixed.includes(f.id) ? 'checked' : 'unchecked'}
                    onPress={() => toggleFixedExpensePaid(f.id)}
                  />
                )}
              />
            ))}
          </Card>
        )}

        <Divider style={styles.divider} />
        <View style={styles.actions}>
          <Chip icon="plus" onPress={() => setAdding(true)} testID="add-planned">
            Ajouter une ligne
          </Chip>
          <Chip
            icon="auto-fix"
            onPress={async () => {
              const n = await autoCheck();
              Alert.alert(
                'Détection automatique',
                n > 0 ? `${n} ligne(s) cochée(s) grâce à tes SMS.` : 'Aucune nouvelle correspondance.',
              );
            }}>
            Cocher via mes SMS
          </Chip>
          <Chip
            icon="calendar-arrow-right"
            onPress={async () => {
              const n = await carryOver();
              Alert.alert('Mois prochain', `${n} ligne(s) reportée(s) ou reconduite(s).`);
            }}>
            Reporter au mois prochain
          </Chip>
        </View>
        <Button mode="text" onPress={() => setAdding(true)}>
          Astuce : touche une ligne pour la relier à une opération précise.
        </Button>
      </ScrollView>
      <AddPlannedModal visible={adding} onDismiss={() => setAdding(false)} />
      <MatchModal item={matching} onDismiss={() => setMatching(undefined)} />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surface },
  content: { padding: 16, paddingBottom: 48 },
  bold: { fontWeight: '800' },
  banner: { marginVertical: 8 },
  tiles: { flexDirection: 'row', gap: 10, marginTop: 10 },
  card: { marginTop: 14, backgroundColor: '#fff' },
  done: { textDecorationLine: 'line-through', opacity: 0.6 },
  empty: { textAlign: 'center', margin: 16, opacity: 0.6 },
  divider: { marginVertical: 16 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  modal: { backgroundColor: '#fff', margin: 16, padding: 20, borderRadius: 20, maxHeight: '85%' },
  input: { marginVertical: 6 },
  envelope: { marginBottom: 10 },
  over: { color: palette.red, fontWeight: '700' },
  bar: { height: 8, borderRadius: 4, marginTop: 4 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 8 },
});
