import notifee from '@notifee/react-native';
import React, { useEffect } from 'react';
import { AppState, StatusBar } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getRepositories } from './src/data/repositories';
import { RootNavigator } from './src/presentation/navigation/RootNavigator';
import { useFinanceStore } from './src/presentation/store/useFinanceStore';
import { theme } from './src/presentation/theme/theme';
import { handleNotificationEvent, scheduleDailyReminders } from './src/services/notifications/NotificationService';
import { importSmsBacklog } from './src/services/sms/smsIngestion';

const DAY_MS = 24 * 3600 * 1000;

/** Au retour au premier plan : rattrape les SMS manqués, recharge, reprogramme les rappels. */
const syncOnForeground = async () => {
  const store = useFinanceStore.getState();
  try {
    if (store.onboarded) {
      await importSmsBacklog(await getRepositories(), Date.now() - 2 * DAY_MS);
    }
  } catch {
    // Permission SMS absente : l'application reste utilisable en saisie manuelle.
  }
  await store.hydrate();
  const s = useFinanceStore.getState();
  if (s.onboarded) {
    await scheduleDailyReminders(s.budgetConfig, s.transactions, new Date(), s.paidFixedExpenseIds).catch(() => undefined);
  }
};

function App(): React.JSX.Element {
  useEffect(() => {
    syncOnForeground();
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        syncOnForeground();
      }
    });
    const unsubscribe = notifee.onForegroundEvent(async event => {
      await handleNotificationEvent(event, await getRepositories(), () => useFinanceStore.getState().hydrate());
    });
    return () => {
      sub.remove();
      unsubscribe();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <PaperProvider theme={theme}>
        <StatusBar barStyle="light-content" backgroundColor={theme.colors.primary} />
        <RootNavigator />
      </PaperProvider>
    </SafeAreaProvider>
  );
}

export default App;
