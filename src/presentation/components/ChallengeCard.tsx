import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Card, Chip, ProgressBar, Text } from 'react-native-paper';
import { computeBadges, weeklyChallenge } from '../../domain/usecases/Gamification';
import { useBudget } from '../hooks/useBudget';
import { useFinanceStore } from '../store/useFinanceStore';
import { palette } from '../theme/theme';

/** Défi de la semaine + badges (gamification : revenir chaque jour). */
export const ChallengeCard = () => {
  const transactions = useFinanceStore(s => s.transactions);
  const debts = useFinanceStore(s => s.debts);
  const plannedItems = useFinanceStore(s => s.plannedItems);
  const savingsGoals = useFinanceStore(s => s.savingsGoals);
  const config = useFinanceStore(s => s.budgetConfig);
  const { streak } = useBudget();
  const [showAll, setShowAll] = useState(false);

  const challenge = useMemo(() => weeklyChallenge(transactions, config, new Date()), [transactions, config]);
  const badges = useMemo(
    () => computeBadges({ transactions, debts, plannedItems, savingsGoals, config, streak, now: new Date() }),
    [transactions, debts, plannedItems, savingsGoals, config, streak],
  );
  const earned = badges.filter(b => b.earned);
  const ratio = challenge.target > 0 ? Math.min(1, challenge.current / challenge.target) : 1;
  const color = challenge.achieved
    ? palette.green
    : challenge.mode === 'MAX' && ratio >= 0.8
    ? palette.orange
    : palette.gold;

  return (
    <Card style={styles.card} testID="challenge-card">
      <Card.Content>
        <View style={styles.row}>
          <Text variant="titleSmall">🎯 Défi de la semaine</Text>
          <Text variant="labelSmall" style={styles.muted}>
            {challenge.daysLeft} j restants
          </Text>
        </View>
        <Text variant="bodyMedium" style={styles.title}>
          {challenge.title}
        </Text>
        <ProgressBar progress={ratio} color={color} style={styles.bar} />
        <Text variant="labelSmall" style={styles.muted} testID="challenge-status">
          {challenge.mode === 'MIN'
            ? `${challenge.current} / ${challenge.target}${challenge.achieved ? ' — réussi ✅' : ''}`
            : challenge.achieved
            ? `${challenge.current} / ${challenge.target} — tu tiens bon 💪`
            : `${challenge.current} / ${challenge.target} — défi raté, rendez-vous lundi !`}
        </Text>
        <View style={[styles.row, styles.badgesHeader]}>
          <Text variant="titleSmall">
            🏅 Badges {earned.length}/{badges.length}
          </Text>
          <Text variant="labelSmall" style={styles.link} onPress={() => setShowAll(v => !v)}>
            {showAll ? 'Masquer' : 'Tout voir'}
          </Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.badges}>
          {(showAll ? badges : earned).map(b => (
            <Chip key={b.id} compact style={!b.earned && styles.locked} testID={`badge-${b.id}`}>
              {b.emoji} {b.title}
            </Chip>
          ))}
          {!showAll && earned.length === 0 && (
            <Text variant="bodySmall" style={styles.muted}>
              Ton premier badge t'attend : laisse LigdiBe lire un SMS MoMo !
            </Text>
          )}
        </ScrollView>
      </Card.Content>
    </Card>
  );
};

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, marginTop: 12, borderRadius: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { marginTop: 4, fontWeight: '600' },
  bar: { height: 8, borderRadius: 4, marginVertical: 8 },
  muted: { opacity: 0.65 },
  badgesHeader: { marginTop: 12 },
  link: { color: palette.green, fontWeight: '700' },
  badges: { gap: 6, paddingVertical: 6 },
  locked: { opacity: 0.4 },
});
