import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Chip } from 'react-native-paper';
import { EXPENSE_CATEGORY_LIST } from '../../core/categories';

interface Props {
  value: string;
  onChange: (category: string) => void;
  categories?: ReadonlyArray<string>;
}

export const CategoryPicker = ({ value, onChange, categories = EXPENSE_CATEGORY_LIST }: Props) => (
  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
    {categories.map(c => (
      <Chip key={c} selected={c === value} onPress={() => onChange(c)} style={styles.chip} testID={`cat-${c}`}>
        {c}
      </Chip>
    ))}
  </ScrollView>
);

const styles = StyleSheet.create({
  row: { paddingVertical: 6, gap: 6 },
  chip: { marginRight: 4 },
});
