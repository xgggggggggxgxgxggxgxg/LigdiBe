import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Surface, Text, TouchableRipple } from 'react-native-paper';

interface Props {
  icon: string;
  label: string;
  value: string;
  hint?: string;
  color?: string;
  testID?: string;
  onPress?: () => void;
}

export const StatTile = ({ icon, label, value, hint, color = '#0F7B5F', testID, onPress }: Props) => {
  const content = (
    <>
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
    </>
  );
  return (
    <Surface style={styles.tile} elevation={1} testID={testID}>
      {onPress ? (
        <TouchableRipple onPress={onPress} borderless style={styles.ripple} accessibilityRole="button">
          <View>{content}</View>
        </TouchableRipple>
      ) : (
        <View style={styles.ripple}>{content}</View>
      )}
    </Surface>
  );
};

const styles = StyleSheet.create({
  tile: { flex: 1, borderRadius: 14, minWidth: 100 },
  ripple: { padding: 12, borderRadius: 14 },
  label: { opacity: 0.7, marginTop: 4 },
  value: { fontWeight: '800', marginTop: 2 },
});
