import notifee, { EventType } from '@notifee/react-native';
import { NativeModules } from 'react-native';
import RNFS from 'react-native-fs';
import { CATEGORIES } from '../src/core/categories';
import { DEFAULT_BUDGET_CONFIG } from '../src/domain/models/Budget';
import { exportJsonBackup, exportTransactionsCsv } from '../src/services/export/ExportService';
import {
  handleNotificationEvent,
  notifyAfterRecording,
  scheduleDailyReminders,
} from '../src/services/notifications/NotificationService';
import { createInMemoryRepositories, tx } from './helpers/inMemoryRepositories';

const MOOV_PAYMENT = `Paiement reussi auprés du marchand INTOUCH BURKINA\nMontant: 6 000,00 FCFA\nFrais: 0,00 FCFA\nTotal: 6 000,00 FCFA\nDate: 09/10/2026 20:03\nTID: DJ91LNF5HF\nSolde: 9 891,00 FCFA`;
const NOW = new Date(2026, 9, 13, 10);

beforeEach(() => jest.clearAllMocks());

describe('Notifications', () => {
  test('dépense détectée : notification avec 3 catégories rapides', async () => {
    const repos = createInMemoryRepositories();
    await notifyAfterRecording(repos, [tx({ id: 'x', amount: 6000, counterpartyName: 'INTOUCH' })], NOW);
    const n = (notifee.displayNotification as jest.Mock).mock.calls[0][0];
    expect(n.title).toBe('💸 Dépense de 6 000 FCFA détectée');
    expect(n.android.actions.map((a: { title: string }) => a.title)).toEqual([
      CATEGORIES.FUEL,
      CATEGORIES.GROCERIES,
      CATEGORIES.FOOD,
    ]);
    expect(notifee.createTriggerNotification).toHaveBeenCalledTimes(2);
  });

  test('retrait → notification « ajouté à ta Poche » ; revenu → proposition de remboursement de dette', async () => {
    const repos = createInMemoryRepositories();
    await notifyAfterRecording(repos, [tx({ type: 'CASH_WITHDRAWAL', amount: 1000 })], NOW);
    expect((notifee.displayNotification as jest.Mock).mock.calls[0][0].title).toContain('Poche');

    await repos.debts.save({
      id: 'd',
      contactName: 'ROMARIC',
      phone: '76900142',
      amount: 5000,
      amountRepaid: 0,
      direction: 'OWED_TO_ME',
      isSettled: false,
      createdAt: 'c',
    });
    await notifyAfterRecording(
      repos,
      [tx({ type: 'INCOME', amount: 5000, counterpartyPhone: '76900142', counterpartyName: 'ROMARIC' })],
      NOW,
    );
    const income = (notifee.displayNotification as jest.Mock).mock.calls[1][0];
    expect(income.body).toContain('remboursement de ROMARIC');
    expect(income.android.actions[0].pressAction.id).toBe('debt-repay:d');
    await notifyAfterRecording(repos, [], NOW);
  });

  test('alertes : plafond crédit (une fois par mois) et enveloppe dépassée', async () => {
    const repos = createInMemoryRepositories();
    await repos.settings.saveBudgetConfig({ ...DEFAULT_BUDGET_CONFIG, monthlyAirtimeLimit: 100, monthlyBudget: 1000 });
    const recharge = tx({ type: 'AIRTIME_RECHARGE', amount: 500, occurredAt: '2026-10-13T09:00:00' });
    await repos.transactions.insertMany([recharge]);
    await notifyAfterRecording(repos, [recharge], NOW);
    const ids = (notifee.displayNotification as jest.Mock).mock.calls.map(c => c[0].id);
    expect(ids).toEqual(['airtime-limit', 'budget-exceeded']);
    await notifyAfterRecording(repos, [recharge], NOW);
    expect((notifee.displayNotification as jest.Mock).mock.calls.filter(c => c[0].id === 'airtime-limit')).toHaveLength(
      1,
    );
  });

  test('rappels 07h30 et 21h30 programmés au bon moment', async () => {
    await scheduleDailyReminders(
      DEFAULT_BUDGET_CONFIG,
      [tx({ amount: 999999, occurredAt: '2026-10-13T09:00:00' })],
      NOW,
    );
    const [[morning, mTrigger], [evening, eTrigger]] = (notifee.createTriggerNotification as jest.Mock).mock.calls;
    expect(new Date(mTrigger.timestamp)).toEqual(new Date(2026, 9, 14, 7, 30));
    expect(new Date(eTrigger.timestamp)).toEqual(new Date(2026, 9, 13, 21, 30));
    expect(morning.title).toMatch(/^☀️ Ton budget du jour/);
    expect(evening.body).toMatch(/dépassée/);
    jest.clearAllMocks();
    await scheduleDailyReminders(
      { ...DEFAULT_BUDGET_CONFIG, specialDays: [{ date: '2026-10-14', multiplier: 2 }] },
      [],
      NOW,
    );
    const [[m2], [e2]] = (notifee.createTriggerNotification as jest.Mock).mock.calls;
    expect(m2.body).toContain('bonus week-end');
    expect(e2.body).toContain('Bravo');
  });

  test('action « Carburant » : catégorie mise à jour et apprise ; action dette : remboursement', async () => {
    const repos = createInMemoryRepositories();
    await repos.transactions.insertMany([tx({ id: 't', counterpartyName: 'STATION X' })]);
    const onChange = jest.fn(async () => undefined);
    await handleNotificationEvent(
      {
        type: EventType.ACTION_PRESS,
        detail: {
          pressAction: { id: `category:${CATEGORIES.FUEL}` },
          notification: { id: 'tx-t', data: { transactionId: 't' } },
        },
      },
      repos,
      onChange,
    );
    expect(repos.store.transactions[0].category).toBe(CATEGORIES.FUEL);
    expect(repos.store.kv.learnedCategories).toEqual({ 'STATION X': CATEGORIES.FUEL });
    expect(notifee.cancelNotification).toHaveBeenCalledWith('tx-t');
    expect(onChange).toHaveBeenCalled();

    await repos.debts.save({
      id: 'd',
      contactName: 'A',
      amount: 5000,
      amountRepaid: 0,
      direction: 'OWED_TO_ME',
      isSettled: false,
      createdAt: 'c',
    });
    await handleNotificationEvent(
      {
        type: EventType.ACTION_PRESS,
        detail: { pressAction: { id: 'debt-repay:d' }, notification: { data: { amount: '5000' } } },
      },
      repos,
    );
    expect(repos.store.debts[0].isSettled).toBe(true);

    await handleNotificationEvent({ type: EventType.PRESS, detail: {} }, repos, onChange);
    await handleNotificationEvent(
      { type: EventType.ACTION_PRESS, detail: { pressAction: { id: 'autre' } } },
      repos,
      onChange,
    );
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('Ingestion SMS (Headless) et import historique', () => {
  test('processRealtimeSms enregistre et notifie ; importSmsBacklog dédoublonne', async () => {
    NativeModules.LigdiBeSms = {
      readInbox: jest.fn(async () => [
        { sender: 'MoovMoney', body: MOOV_PAYMENT, timestamp: NOW.getTime() },
        { sender: 'MoovMoney', body: MOOV_PAYMENT, timestamp: NOW.getTime() },
        { sender: 'Maman', body: 'Rappelle-moi stp', timestamp: NOW.getTime() },
      ]),
      drainPending: jest.fn(async () => []),
    };
    let ingestion: typeof import('../src/services/sms/smsIngestion');
    jest.isolateModules(() => {
      ingestion = require('../src/services/sms/smsIngestion');
    });
    const repos = createInMemoryRepositories();
    const report = await ingestion!.importSmsBacklog(repos, 0);
    expect(report).toEqual({ recorded: 1, duplicates: 1, ignored: 1 });

    const live = await ingestion!.processRealtimeSms(repos, {
      sender: 'OrangeMoney',
      body: 'Votre paiement de 500.00 FCFA, Frais: 4.3478 FCFA, Taxe: 0.6522 FCFA a WENDSONGUEDE DAVID SAWADOGO a ete effectue avec succes. Votre solde est de : 192284.67 FCFA. Trans id: MP261012.1637.71387533.',
      timestamp: NOW.getTime(),
    });
    expect(live.status).toBe('RECORDED');
    expect(notifee.displayNotification).toHaveBeenCalled();
  });
});

describe('Export', () => {
  test('CSV horodaté dans Téléchargements, repli si échec', async () => {
    const repos = createInMemoryRepositories();
    await repos.transactions.insertMany([tx({})]);
    const res = await exportTransactionsCsv(repos, NOW);
    expect(res).toEqual({ path: '/storage/emulated/0/Download/LigdiBe_transactions_20261013-100000.csv', count: 1 });

    (RNFS.writeFile as jest.Mock).mockRejectedValueOnce(new Error('EACCES'));
    const json = await exportJsonBackup(repos, '2026-10', NOW);
    expect(json.path).toBe(
      '/storage/emulated/0/Android/data/com.ligdibe/files/LigdiBe_sauvegarde_20261013-100000.json',
    );

    (RNFS.writeFile as jest.Mock).mockRejectedValue(new Error('disque plein'));
    await expect(exportTransactionsCsv(repos, NOW)).rejects.toThrow('disque plein');
    (RNFS.writeFile as jest.Mock).mockReset();
  });
});

describe('Alerte enveloppe catégorie', () => {
  test('notifie au franchissement de 80 %', async () => {
    const repos = createInMemoryRepositories();
    await repos.settings.saveBudgetConfig({ ...DEFAULT_BUDGET_CONFIG, categoryLimits: { [CATEGORIES.FOOD]: 10000 } });
    const a = tx({ amount: 5000, category: CATEGORIES.FOOD, occurredAt: '2026-10-12T09:00:00' });
    const b = tx({ amount: 3500, category: CATEGORIES.FOOD, occurredAt: '2026-10-13T09:00:00' });
    await repos.transactions.insertMany([a, b]);
    await notifyAfterRecording(repos, [b], NOW);
    const alert = (notifee.displayNotification as jest.Mock).mock.calls.find(
      c => c[0].id === `envelope-${CATEGORIES.FOOD}`,
    );
    expect(alert?.[0].title).toContain('80 %');
  });
});
