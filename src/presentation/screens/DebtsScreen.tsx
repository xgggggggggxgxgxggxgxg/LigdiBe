import React, { useMemo, useState } from 'react';
import { Alert, FlatList, Linking, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Chip, FAB, IconButton, Modal, Portal, SegmentedButtons, Text } from 'react-native-paper';
import { Field } from '../components/Field';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatFCFA } from '../../core/currency';
import { dayKey } from '../../core/dates';
import type { Debt, DebtDirection } from '../../domain/models/Debt';
import type { Tontine } from '../../domain/models/Tontine';
import {
  buildReminderMessage,
  buildSmsUrl,
  buildWhatsAppUrl,
  debtRemaining,
  summarizeDebts,
} from '../../domain/usecases/ManageDebts';
import { tontineStatus } from '../../domain/usecases/TontineTracker';
import { AmountInput, parseInputAmount } from '../components/AmountInput';
import { AddGoalModal, GoalsList } from '../components/GoalsSection';
import { StatTile } from '../components/StatTile';
import { useFinanceStore } from '../store/useFinanceStore';
import { palette } from '../theme/theme';

type Tab = DebtDirection | 'TONTINE' | 'GOALS';

const openUrl = async (url: string, fallback?: string) => {
  try {
    await Linking.openURL(url);
  } catch {
    if (fallback) {
      await Linking.openURL(fallback);
    } else {
      Alert.alert('Impossible d’ouvrir l’application');
    }
  }
};

const DebtCard = ({ debt }: { debt: Debt }) => {
  const userName = useFinanceStore(s => s.userName);
  const repayDebt = useFinanceStore(s => s.repayDebt);
  const deleteDebt = useFinanceStore(s => s.deleteDebt);
  const [repay, setRepay] = useState('');
  const message = buildReminderMessage(debt, userName || undefined);
  const overdue = !debt.isSettled && debt.dueDate !== undefined && debt.dueDate.slice(0, 10) < dayKey(new Date());
  return (
    <Card style={[styles.card, debt.isSettled && styles.settled]} testID={`debt-${debt.id}`}>
      <Card.Title
        title={debt.contactName}
        subtitle={`${debt.isSettled ? 'Soldé ✅' : `Reste ${formatFCFA(debtRemaining(debt))}`}${
          debt.dueDate ? ` · échéance ${debt.dueDate.slice(0, 10)}` : ''
        }`}
        right={() => (
          <View style={styles.row}>
            {overdue && (
              <Chip compact textStyle={{ color: palette.red }}>
                En retard
              </Chip>
            )}
            <IconButton icon="delete-outline" onPress={() => deleteDebt(debt.id)} />
          </View>
        )}
      />
      {!debt.isSettled && (
        <Card.Content>
          {debt.note ? <Text variant="bodySmall">{debt.note}</Text> : null}
          <View style={styles.row}>
            <View style={styles.flex}>
              <AmountInput label="Remboursement reçu/versé" value={repay} onChangeText={setRepay} />
            </View>
            <IconButton
              icon="check-circle"
              iconColor={palette.green}
              disabled={parseInputAmount(repay) <= 0}
              onPress={async () => {
                await repayDebt(debt.id, parseInputAmount(repay));
                setRepay('');
              }}
            />
          </View>
        </Card.Content>
      )}
      {!debt.isSettled && debt.phone && (
        <Card.Actions>
          <Button
            icon="whatsapp"
            onPress={() => openUrl(buildWhatsAppUrl(debt.phone!, message), buildSmsUrl(debt.phone!, message))}>
            WhatsApp
          </Button>
          <Button icon="message-text-outline" onPress={() => openUrl(buildSmsUrl(debt.phone!, message))}>
            SMS
          </Button>
          <Button onPress={() => repayDebt(debt.id, debtRemaining(debt))}>Tout soldé</Button>
        </Card.Actions>
      )}
    </Card>
  );
};

const TontineCard = ({ tontine }: { tontine: Tontine }) => {
  const payTontine = useFinanceStore(s => s.payTontine);
  const deleteTontine = useFinanceStore(s => s.deleteTontine);
  const s = tontineStatus(tontine, new Date());
  return (
    <Card style={styles.card}>
      <Card.Title
        title={tontine.name}
        subtitle={`${formatFCFA(tontine.contributionAmount)} / ${
          tontine.frequency === 'WEEKLY' ? 'semaine' : 'mois'
        } · ${tontine.membersCount} membres`}
        right={() => <IconButton icon="delete-outline" onPress={() => deleteTontine(tontine.id)} />}
      />
      <Card.Content>
        <Text>
          🎯 Cagnotte : <Text style={styles.bold}>{formatFCFA(s.potAmount)}</Text>
          {s.hasReceivedPot
            ? ' (déjà ramassée)'
            : ` — ton tour le ${dayKey(s.myPickupDate)} (${s.roundsUntilMyTurn} tour(s))`}
        </Text>
        <Text style={s.lateCount > 0 ? { color: palette.red } : undefined}>
          Cotisations : {s.paidCount}/{s.dueCount} {s.lateCount > 0 ? `— ${s.lateCount} en retard` : '✅'}
        </Text>
        {s.nextContributionDate && (
          <Text variant="bodySmall">Prochaine échéance : {dayKey(s.nextContributionDate)}</Text>
        )}
      </Card.Content>
      <Card.Actions>
        <Button icon="cash-check" onPress={() => payTontine(tontine.id)}>
          J'ai cotisé (Poche)
        </Button>
      </Card.Actions>
    </Card>
  );
};

const AddDebtModal = ({
  visible,
  direction,
  onDismiss,
}: {
  visible: boolean;
  direction: DebtDirection;
  onDismiss: () => void;
}) => {
  const saveDebt = useFinanceStore(s => s.saveDebt);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [due, setDue] = useState('');
  const [note, setNote] = useState('');
  const validDue = due === '' || /^\d{4}-\d{2}-\d{2}$/.test(due);
  return (
    <Portal>
      <Modal visible={visible} onDismiss={onDismiss} contentContainerStyle={styles.modal}>
        <ScrollView keyboardShouldPersistTaps="handled">
          <Text variant="titleLarge" style={styles.bold}>
            {direction === 'OWED_TO_ME' ? 'Quelqu’un me doit' : 'Je dois'}
          </Text>
          <Field mode="outlined" label="Nom" value={name} onChangeText={setName} style={styles.input} />
          <Field
            mode="outlined"
            label="Téléphone (WhatsApp)"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            style={styles.input}
          />
          <AmountInput label="Montant" value={amount} onChangeText={setAmount} />
          <Field
            mode="outlined"
            label="Échéance (AAAA-MM-JJ)"
            value={due}
            onChangeText={setDue}
            error={!validDue}
            style={styles.input}
          />
          <Field
            mode="outlined"
            label="Note (ex: prêt pour la scolarité)"
            value={note}
            onChangeText={setNote}
            style={styles.input}
          />
          <Button
            mode="contained"
            disabled={!name.trim() || parseInputAmount(amount) <= 0 || !validDue}
            onPress={async () => {
              await saveDebt({
                contactName: name.trim(),
                phone: phone.trim() || undefined,
                amount: parseInputAmount(amount),
                direction,
                dueDate: due || undefined,
                note: note.trim() || undefined,
              });
              setName('');
              setPhone('');
              setAmount('');
              setDue('');
              setNote('');
              onDismiss();
            }}>
            Enregistrer
          </Button>
        </ScrollView>
      </Modal>
    </Portal>
  );
};

const AddTontineModal = ({ visible, onDismiss }: { visible: boolean; onDismiss: () => void }) => {
  const saveTontine = useFinanceStore(s => s.saveTontine);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [members, setMembers] = useState('');
  const [turn, setTurn] = useState('');
  const [weekly, setWeekly] = useState(false);
  const [start, setStart] = useState(dayKey(new Date()));
  const ok =
    name.trim() &&
    parseInputAmount(amount) > 0 &&
    Number(members) > 1 &&
    Number(turn) >= 1 &&
    Number(turn) <= Number(members) &&
    /^\d{4}-\d{2}-\d{2}$/.test(start);
  return (
    <Portal>
      <Modal visible={visible} onDismiss={onDismiss} contentContainerStyle={styles.modal}>
        <ScrollView keyboardShouldPersistTaps="handled">
          <Text variant="titleLarge" style={styles.bold}>
            Nouvelle tontine
          </Text>
          <Field
            mode="outlined"
            label="Nom (ex: Tontine du marché)"
            value={name}
            onChangeText={setName}
            style={styles.input}
          />
          <AmountInput label="Cotisation" value={amount} onChangeText={setAmount} />
          <SegmentedButtons
            value={weekly ? 'W' : 'M'}
            onValueChange={v => setWeekly(v === 'W')}
            buttons={[
              { value: 'M', label: 'Mensuelle' },
              { value: 'W', label: 'Hebdomadaire' },
            ]}
            style={styles.input}
          />
          <Field
            mode="outlined"
            label="Nombre de membres"
            value={members}
            onChangeText={setMembers}
            keyboardType="number-pad"
            style={styles.input}
          />
          <Field
            mode="outlined"
            label="Mon rang de ramassage"
            value={turn}
            onChangeText={setTurn}
            keyboardType="number-pad"
            style={styles.input}
          />
          <Field
            mode="outlined"
            label="Date de début (AAAA-MM-JJ)"
            value={start}
            onChangeText={setStart}
            style={styles.input}
          />
          <Button
            mode="contained"
            disabled={!ok}
            onPress={async () => {
              await saveTontine({
                name: name.trim(),
                contributionAmount: parseInputAmount(amount),
                frequency: weekly ? 'WEEKLY' : 'MONTHLY',
                membersCount: Number(members),
                myTurn: Number(turn),
                startDate: start,
              });
              onDismiss();
            }}>
            Créer
          </Button>
        </ScrollView>
      </Modal>
    </Portal>
  );
};

export const DebtsScreen = () => {
  const debts = useFinanceStore(s => s.debts);
  const tontines = useFinanceStore(s => s.tontines);
  const [tab, setTab] = useState<Tab>('OWED_TO_ME');
  const [adding, setAdding] = useState(false);
  const summary = useMemo(() => summarizeDebts(debts, new Date()), [debts]);
  const list = debts.filter(d => d.direction === tab);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Text variant="headlineSmall" style={styles.title}>
        Carnet & Épargne
      </Text>
      <View style={styles.tiles}>
        <StatTile icon="hand-coin" label="On me doit" value={formatFCFA(summary.owedToMe)} color={palette.green} />
        <StatTile icon="hand-extended" label="Je dois" value={formatFCFA(summary.owedByMe)} color={palette.red} />
      </View>
      <SegmentedButtons
        value={tab}
        onValueChange={v => setTab(v as Tab)}
        style={styles.segment}
        buttons={[
          { value: 'OWED_TO_ME', label: 'Me doit' },
          { value: 'OWED_BY_ME', label: 'Je dois' },
          { value: 'TONTINE', label: 'Tontines' },
          { value: 'GOALS', label: 'Épargne' },
        ]}
      />
      {tab === 'GOALS' ? (
        <GoalsList />
      ) : tab === 'TONTINE' ? (
        <FlatList
          data={tontines}
          keyExtractor={t => t.id}
          renderItem={({ item }) => <TontineCard tontine={item} />}
          ListEmptyComponent={
            <Text style={styles.empty}>Suis tes tontines : cotisations, retards et date de ramassage.</Text>
          }
          contentContainerStyle={styles.list}
        />
      ) : (
        <FlatList
          data={list}
          keyExtractor={d => d.id}
          renderItem={({ item }) => <DebtCard debt={item} />}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {tab === 'OWED_TO_ME' ? 'Personne ne te doit rien. 🙌🏾' : 'Aucune dette. Bravo ! 🎉'}
            </Text>
          }
          contentContainerStyle={styles.list}
        />
      )}
      <FAB icon="plus" style={styles.fab} onPress={() => setAdding(true)} testID="fab-debt" />
      {tab === 'GOALS' ? (
        <AddGoalModal visible={adding} onDismiss={() => setAdding(false)} />
      ) : tab === 'TONTINE' ? (
        <AddTontineModal visible={adding} onDismiss={() => setAdding(false)} />
      ) : (
        <AddDebtModal visible={adding} direction={tab} onDismiss={() => setAdding(false)} />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surface },
  title: { marginHorizontal: 16, marginTop: 12, fontWeight: '800' },
  tiles: { flexDirection: 'row', gap: 10, margin: 16 },
  segment: { marginHorizontal: 16 },
  list: { padding: 16, paddingBottom: 96 },
  card: { marginBottom: 12, backgroundColor: '#fff' },
  settled: { opacity: 0.6 },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  bold: { fontWeight: '800' },
  empty: { textAlign: 'center', margin: 24, opacity: 0.6 },
  fab: { position: 'absolute', right: 16, bottom: 16, backgroundColor: palette.gold },
  modal: { backgroundColor: '#fff', margin: 16, padding: 20, borderRadius: 20, maxHeight: '90%' },
  input: { marginVertical: 6 },
});
