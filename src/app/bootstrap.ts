import notifee from '@notifee/react-native';
import { AppRegistry } from 'react-native';
import { getRepositories } from '../data/repositories';
import { handleNotificationEvent } from '../services/notifications/NotificationService';
import type { NativeSms } from '../services/sms/SmsBridge';
import { processRealtimeSms } from '../services/sms/smsIngestion';
import { configureFinanceStore, useFinanceStore } from '../presentation/store/useFinanceStore';

/** Rafraîchit l'UI si elle est vivante (même contexte JS que la tâche Headless). */
const refreshStoreIfMounted = async () => {
  if (useFinanceStore.getState().ready) {
    await useFinanceStore.getState().hydrate();
  }
};

/**
 * Enregistrements exécutés AVANT le rendu de l'application (index.js) :
 * ils doivent exister quand Android réveille le JS en arrière-plan.
 */
export const registerBackgroundHandlers = () => {
  configureFinanceStore(getRepositories);

  AppRegistry.registerHeadlessTask('LigdiBeSmsTask', () => async (data: NativeSms) => {
    const repos = await getRepositories();
    await processRealtimeSms(repos, data);
    await refreshStoreIfMounted();
  });

  notifee.onBackgroundEvent(async event => {
    await handleNotificationEvent(event, await getRepositories());
  });
};
