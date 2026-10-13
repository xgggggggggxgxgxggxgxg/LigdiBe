import React from 'react';
import { StyleSheet } from 'react-native';
import { Icon, Surface, Text } from 'react-native-paper';

interface Props {
  icon: string;
  label: string;
  value: string;
  hint?: string;
  color?: string;
  testID?: string;
}

export const StatTile = ({ icon, label, value, hint, color = '#0F7B5F', testID }: Props) => (
  <Surface style={styles.tile} elevation={1} testID={testID}>
    <Icon source={icon} size={22} color={color} />
    <Text variant="labelMedium" style={styles.label}>
      {label}
    </Text>
    <Text variant="titleMedium" style={[styles.value, { color }]}>
      {value}
    </Text>
    {hint ? (
      <Text variant="labelSmall" style={styles.label}>
        {hint}
      </Text>
    ) : null}
  </Surface>
);

const styles = StyleSheet.create({
  tile: { flex: 1, padding: 12, borderRadius: 14, backgroundColor: '#fff', minWidth: 100 },
  label: { opacity: 0.7, marginTop: 4 },
  value: { fontWeight: '800', marginTop: 2 },
});
