import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Surface, Text } from 'react-native-paper';
import { formatFCFA } from '../../core/currency';
import type { Account } from '../../domain/models/Account';
import { providerColor, providerIcon } from '../theme/theme';

interface Props {
  account: Account;
  hidden?: boolean;
  onPress?: () => void;
}

export const BalanceCard = ({ account, hidden }: Props) => (
  <Surface
    style={[styles.card, { borderTopColor: providerColor(account.provider) }]}
    elevation={1}
    testID={`balance-${account.id}`}>
    <View style={styles.row}>
      <Icon source={providerIcon(account.provider)} size={18} color={providerColor(account.provider)} />
      <Text variant="labelMedium" numberOfLines={1} style={styles.name}>
        {account.name}
      </Text>
    </View>
    <Text variant="titleMedium" style={styles.amount}>
      {hidden ? '•••••' : formatFCFA(account.currentBalance)}
    </Text>
  </Surface>
);

const styles = StyleSheet.create({
  card: { width: 160, padding: 12, marginRight: 10, borderRadius: 14, borderTopWidth: 4, backgroundColor: '#fff' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { flex: 1, opacity: 0.75 },
  amount: { marginTop: 8, fontWeight: '700' },
});
