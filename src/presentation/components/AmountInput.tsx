import React from 'react';
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
    style={{ marginBottom: 8 }}
  />
);

export const parseInputAmount = (v: string): number => Number(v.replace(/[^\d]/g, '')) || 0;
