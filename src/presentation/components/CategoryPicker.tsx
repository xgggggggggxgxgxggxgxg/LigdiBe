import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Chip, IconButton } from 'react-native-paper';
import { EXPENSE_CATEGORY_LIST } from '../../core/categories';
import { useFinanceStore } from '../store/useFinanceStore';
import { Field } from './Field';

interface Props {
  value: string;
  onChange: (category: string) => void;
  /** Liste imposée (ex. comptes) ; par défaut : catégories standard + catégories créées. */
  categories?: ReadonlyArray<string>;
  /** Affiche « + Nouvelle » pour créer une catégorie qui n'existe pas encore. */
  allowCreate?: boolean;
}

export const CategoryPicker = ({ value, onChange, categories, allowCreate }: Props) => {
  const custom = useFinanceStore(s => s.customCategories);
  const addCustomCategory = useFinanceStore(s => s.addCustomCategory);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');
  const list = categories ?? [...EXPENSE_CATEGORY_LIST, ...custom.filter(c => !EXPENSE_CATEGORY_LIST.includes(c))];
  const shown = value && !list.includes(value) && !categories ? [value, ...list] : list;

  const create = async () => {
    if (!draft.trim()) {
      return;
    }
    const name = await addCustomCategory(draft);
    onChange(name);
    setDraft('');
    setCreating(false);
  };

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        keyboardShouldPersistTaps="handled">
        {shown.map(c => (
          <Chip
            key={c}
            selected={c === value}
            onPress={() => onChange(c)}
            style={styles.chip}
            testID={`cat-${c}`}
            accessibilityLabel={`Catégorie ${c}${c === value ? ', sélectionnée' : ''}`}>
            {c}
          </Chip>
        ))}
        {allowCreate && !creating && (
          <Chip
            icon="plus"
            mode="outlined"
            onPress={() => setCreating(true)}
            style={styles.chip}
            testID="cat-create"
            accessibilityLabel="Créer une nouvelle catégorie">
            Nouvelle
          </Chip>
        )}
      </ScrollView>
      {creating && (
        <View style={styles.createRow}>
          <View style={styles.flex}>
            <Field
              mode="outlined"
              dense
              autoFocus
              label="Nom de la nouvelle catégorie"
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={create}
              returnKeyType="done"
              testID="cat-create-input"
            />
          </View>
          <IconButton
            icon="check"
            mode="contained"
            disabled={!draft.trim()}
            onPress={create}
            accessibilityLabel="Créer la catégorie"
            testID="cat-create-save"
          />
          <IconButton icon="close" onPress={() => setCreating(false)} accessibilityLabel="Annuler la création" />
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  row: { paddingVertical: 6, gap: 6 },
  chip: { marginRight: 4 },
  createRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  flex: { flex: 1 },
});
