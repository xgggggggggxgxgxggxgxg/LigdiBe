import React, { useState } from 'react';
import { FlatList, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Chip, IconButton, Modal, Portal, ProgressBar, Text, TextInput } from 'react-native-paper';
import { formatFCFA } from '../../core/currency';
import type { SavingsGoal } from '../../domain/models/SavingsGoal';
import { goalMotivation, goalStatus } from '../../domain/usecases/SavingsGoals';
import { useFinanceStore } from '../store/useFinanceStore';
import { palette } from '../theme/theme';
import { AmountInput, parseInputAmount } from './AmountInput';

const EMOJIS = ['🐏', '🎒', '🏍️', '💍', '🏠', '📱', '✈️', '🎄', '🏥', '💰'];

const GoalCard = ({ goal }: { goal: SavingsGoal }) => {
  const contributeToGoal = useFinanceStore(s => s.contributeToGoal);
  const deleteGoal = useFinanceStore(s => s.deleteGoal);
  const [amount, setAmount] = useState('');
  const s = goalStatus(goal, new Date());
  const color = s.isReached ? palette.green : s.isOverdue || s.onTrack === false ? palette.orange : palette.green;
  return (
    <Card style={styles.card} testID={`goal-${goal.id}`}>
      <Card.Title
        title={`${goal.emoji} ${goal.name}`}
        subtitle={`${formatFCFA(s.saved)} / ${formatFCFA(goal.targetAmount)}${
          goal.deadline ? ` · avant le ${goal.deadline}` : ''
        }`}
        right={() => <IconButton icon="delete-outline" onPress={() => deleteGoal(goal.id)} />}
      />
      <Card.Content>
        <ProgressBar progress={s.progress} color={color} style={styles.bar} />
        <Text variant="bodySmall">{goalMotivation(goal, s)}</Text>
        {!s.isReached && s.perWeekNeeded !== undefined && (
          <Text variant="labelSmall" style={styles.muted}>
            Soit {formatFCFA(s.perWeekNeeded)} par semaine · {s.daysLeft} jour(s) restant(s)
          </Text>
        )}
        {!s.isReached && (
          <View style={styles.row}>
            <View style={styles.flex}>
              <AmountInput label="Mettre de côté" value={amount} onChangeText={setAmount} />
            </View>
            <IconButton
              icon="piggy-bank"
              iconColor={palette.green}
              disabled={parseInputAmount(amount) <= 0}
              onPress={async () => {
                await contributeToGoal(goal.id, parseInputAmount(amount));
                setAmount('');
              }}
            />
          </View>
        )}
      </Card.Content>
    </Card>
  );
};

export const AddGoalModal = ({ visible, onDismiss }: { visible: boolean; onDismiss: () => void }) => {
  const saveGoal = useFinanceStore(s => s.saveGoal);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(EMOJIS[0]);
  const [target, setTarget] = useState('');
  const [deadline, setDeadline] = useState('');
  const validDeadline = deadline === '' || /^\d{4}-\d{2}-\d{2}$/.test(deadline);
  return (
    <Portal>
      <Modal visible={visible} onDismiss={onDismiss} contentContainerStyle={styles.modal}>
        <ScrollView keyboardShouldPersistTaps="handled">
          <Text variant="titleLarge" style={styles.bold}>
            Nouvel objectif d'épargne
          </Text>
          <View style={styles.emojis}>
            {EMOJIS.map(e => (
              <Chip key={e} selected={e === emoji} onPress={() => setEmoji(e)} compact>
                {e}
              </Chip>
            ))}
          </View>
          <TextInput
            mode="outlined"
            label="Nom (ex: Mouton de Tabaski)"
            value={name}
            onChangeText={setName}
            style={styles.input}
          />
          <AmountInput label="Montant à atteindre" value={target} onChangeText={setTarget} />
          <TextInput
            mode="outlined"
            label="Échéance (AAAA-MM-JJ, optionnelle)"
            value={deadline}
            onChangeText={setDeadline}
            error={!validDeadline}
            style={styles.input}
          />
          <Button
            mode="contained"
            disabled={!name.trim() || parseInputAmount(target) <= 0 || !validDeadline}
            onPress={async () => {
              await saveGoal({
                name: name.trim(),
                emoji,
                targetAmount: parseInputAmount(target),
                deadline: deadline || undefined,
              });
              setName('');
              setTarget('');
              setDeadline('');
              onDismiss();
            }}>
            Créer l'objectif
          </Button>
        </ScrollView>
      </Modal>
    </Portal>
  );
};

export const GoalsList = () => {
  const goals = useFinanceStore(s => s.savingsGoals);
  return (
    <FlatList
      data={goals}
      keyExtractor={g => g.id}
      renderItem={({ item }) => <GoalCard goal={item} />}
      ListEmptyComponent={
        <Text style={styles.empty}>
          Fixe-toi un objectif : Tabaski, rentrée scolaire, moto… LigdiBe te dit combien mettre de côté chaque jour.
        </Text>
      }
      contentContainerStyle={styles.list}
    />
  );
};

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 96 },
  card: { marginBottom: 12, backgroundColor: '#fff' },
  bar: { height: 10, borderRadius: 5, marginBottom: 8 },
  muted: { opacity: 0.65, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  bold: { fontWeight: '800' },
  empty: { textAlign: 'center', margin: 24, opacity: 0.6 },
  modal: { backgroundColor: '#fff', margin: 16, padding: 20, borderRadius: 20, maxHeight: '90%' },
  input: { marginVertical: 6 },
  emojis: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 8 },
});
