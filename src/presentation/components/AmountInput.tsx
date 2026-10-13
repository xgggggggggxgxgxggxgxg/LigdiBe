import React from 'react';
import { StyleSheet } from 'react-native';
import { TextInput } from 'react-native-paper';

interface Props {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  testID?: string;
}

/** Saisie de montant en FCFA (chiffres uniquement). */
export const AmountInput = ({ label, value, onChangeText, testID }: Props) => (
  <TextInput
    testID={testID}
    mode="outlined"
    label={label}
    value={value}
    keyboardType="number-pad"
    right={<TextInput.Affix text="FCFA" />}
    onChangeText={v => onChangeText(v.replace(/[^\d]/g, ''))}
    style={styles.input}
  />
);

export const parseInputAmount = (v: string): number => Number(v.replace(/[^\d]/g, '')) || 0;

const styles = StyleSheet.create({ input: { marginBottom: 8 } });
