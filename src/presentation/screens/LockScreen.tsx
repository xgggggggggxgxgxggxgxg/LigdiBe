import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getPinLength, verifyPin } from '../../services/security/AppLock';
import { useLockStore } from '../store/useLockStore';
import { palette } from '../theme/theme';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

export const LockScreen = () => {
  const unlock = useLockStore(s => s.unlock);
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState('Entre ton code LigdiBe');
  const [busy, setBusy] = useState(false);
  const [length, setLength] = useState(4);

  useEffect(() => {
    getPinLength()
      .then(setLength)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (pin.length < length || busy) {
      return;
    }
    // Validation automatique dès que le nombre de chiffres du code est atteint.
    let cancelled = false;
    setBusy(true);
    verifyPin(pin).then(res => {
      if (cancelled) {
        return;
      }
      setBusy(false);
      if (res.ok) {
        unlock();
      } else if ('lockedForMs' in res) {
        setPin('');
        setMessage(`Trop d'essais. Réessaie dans ${Math.ceil(res.lockedForMs / 1000)} s.`);
      } else {
        setPin('');
        setMessage(`Code incorrect (${res.remainingAttempts} essai(s) restant(s))`);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  const press = (k: string) => {
    if (k === '⌫') {
      setPin(p => p.slice(0, -1));
    } else if (k && pin.length < length) {
      setPin(p => p + k);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <Text variant="displaySmall" style={styles.logo}>
        LigdiBe 🔒
      </Text>
      <Text style={styles.message} testID="lock-message">
        {message}
      </Text>
      <View style={styles.dots}>
        {Array.from({ length }, (_, i) => (
          <View key={i} style={[styles.dot, i < pin.length && styles.dotFilled]} />
        ))}
      </View>
      <View style={styles.pad}>
        {KEYS.map((k, i) => (
          <Button
            key={i}
            mode={k && k !== '⌫' ? 'contained-tonal' : 'text'}
            disabled={!k || busy}
            onPress={() => press(k)}
            style={styles.key}
            labelStyle={styles.keyLabel}
            testID={k ? `key-${k}` : undefined}>
            {k}
          </Button>
        ))}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.green, alignItems: 'center', justifyContent: 'center' },
  logo: { color: '#fff', fontWeight: '900' },
  message: { color: '#fff', marginVertical: 16 },
  dots: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: '#fff' },
  dotFilled: { backgroundColor: palette.gold, borderColor: palette.gold },
  pad: { flexDirection: 'row', flexWrap: 'wrap', width: 270, justifyContent: 'center' },
  key: { width: 76, margin: 6, borderRadius: 38 },
  keyLabel: { fontSize: 24, lineHeight: 30 },
});
