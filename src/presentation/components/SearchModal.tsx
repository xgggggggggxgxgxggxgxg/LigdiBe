import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { Button, Chip, Searchbar, Text } from 'react-native-paper';
import { formatFCFA } from '../../core/currency';
import type { Transaction } from '../../domain/models/Transaction';
import { searchTransactions } from '../../domain/usecases/SearchTransactions';
import { useFinanceStore } from '../store/useFinanceStore';
import { palette } from '../theme/theme';
import { AppModal } from './Screen';
import { TransactionItem } from './TransactionItem';

interface Props {
  visible: boolean;
  onDismiss: () => void;
  onSelect: (t: Transaction) => void;
}

/** Recherche dans tout l'historique : « Combien j'ai envoyé à Moussa cette année ? ». */
export const SearchModal = ({ visible, onDismiss, onSelect }: Props) => {
  const loadAll = useFinanceStore(s => s.loadAllTransactions);
  const recent = useFinanceStore(s => s.transactions);
  const [all, setAll] = useState<Transaction[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (visible) {
      loadAll().then(setAll, () => setAll(recent));
    }
  }, [visible, loadAll, recent]);

  const result = useMemo(() => searchTransactions(all, query), [all, query]);
  const suggestions = useMemo(() => topNames(all), [all]);

  return (
    <AppModal visible={visible} onDismiss={onDismiss}>
      <Searchbar
        placeholder="Nom, numéro, montant, catégorie…"
        value={query}
        onChangeText={setQuery}
        autoFocus
        testID="search-input"
      />
      {query.trim().length === 0 ? (
        <View style={styles.chips}>
          {suggestions.map(name => (
            <Chip key={name} onPress={() => setQuery(name)} style={styles.chip} compact>
              {name}
            </Chip>
          ))}
        </View>
      ) : (
        <View style={styles.summary} testID="search-summary">
          <Text variant="labelLarge">{result.transactions.length} opération(s)</Text>
          <Text variant="labelLarge" style={{ color: palette.red }}>
            − {formatFCFA(result.totalOut)}
          </Text>
          <Text variant="labelLarge" style={{ color: palette.green }}>
            + {formatFCFA(result.totalIn)}
          </Text>
        </View>
      )}
      <FlatList
        data={result.transactions.slice(0, 200)}
        keyExtractor={t => t.id}
        renderItem={({ item }) => <TransactionItem transaction={item} onPress={onSelect} />}
        keyboardShouldPersistTaps="handled"
        style={styles.list}
      />
      <Button onPress={onDismiss}>Fermer</Button>
    </AppModal>
  );
};

/** Contacts les plus fréquents, proposés en raccourci. */
const topNames = (txs: ReadonlyArray<Transaction>, n = 6): string[] => {
  const counts = new Map<string, number>();
  for (const t of txs) {
    if (t.source !== 'SYSTEM' && t.counterpartyName) {
      counts.set(t.counterpartyName, (counts.get(t.counterpartyName) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name]) => name);
};

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10, gap: 6 },
  chip: { marginRight: 4 },
  summary: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 10 },
  list: { maxHeight: 420 },
});
