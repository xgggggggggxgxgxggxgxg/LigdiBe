import React from 'react';
import { TextInput, type TextInputProps } from 'react-native-paper';

/**
 * Champ de saisie Paper dont le libellé est aussi exposé aux lecteurs d'écran
 * (TalkBack) : Paper ne le transmet pas au TextInput natif.
 */
export const Field = (props: TextInputProps) => (
  <TextInput
    mode="outlined"
    accessibilityLabel={typeof props.label === 'string' ? props.label : undefined}
    {...props}
  />
);
