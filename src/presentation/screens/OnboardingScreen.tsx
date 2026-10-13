import React, { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Button, Text, TextInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getRepositories } from '../../data/repositories';
import { ensureNotificationChannels } from '../../services/notifications/NotificationService';
import { requestSmsPermissions } from '../../services/sms/SmsBridge';
import { importSmsBacklog } from '../../services/sms/smsIngestion';
import { AmountInput, parseInputAmount } from '../components/AmountInput';
import { useFinanceStore } from '../store/useFinanceStore';
import { palette } from '../theme/theme';

const DAY_MS = 24 * 3600 * 1000;

export const OnboardingScreen = () => {
  const config = useFinanceStore(s => s.budgetConfig);
  const completeOnboarding = useFinanceStore(s => s.completeOnboarding);
  const hydrate = useFinanceStore(s => s.hydrate);
  const [name, setName] = useState('');
  const [budget, setBudget] = useState('');
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      await completeOnboarding(name.trim(), { ...config, monthlyBudget: parseInputAmount(budget) || config.monthlyBudget });
      await ensureNotificationChannels().catch(() => undefined);
      if (await requestSmsPermissions().catch(() => false)) {
        await importSmsBacklog(await getRepositories(), Date.now() - 60 * DAY_MS);
      }
      await hydrate();
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text variant="displaySmall" style={styles.logo}>
          LigdiBe 💚
        </Text>
        <Text variant="titleMedium" style={styles.tagline}>
          Tes SMS Mobile Money deviennent un budget. Sans internet, sans compte, sans serveur.
        </Text>
        <Text style={styles.point}>📲 Orange Money, Moov, Wave, UBA… détectés automatiquement</Text>
        <Text style={styles.point}>👛 Les retraits remplissent ta Poche : ce n'est pas une dépense</Text>
        <Text style={styles.point}>📶 Tes petites recharges de crédit enfin visibles</Text>
        <Text style={styles.point}>🤝 Dettes, créances et tontines au même endroit</Text>
        <Text style={styles.point}>🔒 Tout reste chiffré sur ton téléphone</Text>
        <TextInput mode="outlined" label="Ton prénom" value={name} onChangeText={setName} style={styles.input} />
        <AmountInput label="Ton budget du mois" value={budget} onChangeText={setBudget} testID="onboarding-budget" />
        <Button mode="contained" onPress={start} loading={busy} disabled={busy || !name.trim()} style={styles.input} testID="onboarding-start">
          Commencer
        </Button>
        <Text variant="bodySmall" style={styles.muted}>
          À l'étape suivante, Android te demandera l'accès aux SMS : seuls les messages des opérateurs financiers sont lus, jamais les codes secrets.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 24 },
  logo: { color: palette.green, fontWeight: '900', marginTop: 24 },
  tagline: { marginVertical: 16 },
  point: { marginVertical: 4 },
  input: { marginVertical: 8 },
  muted: { opacity: 0.6, marginTop: 8 },
});
