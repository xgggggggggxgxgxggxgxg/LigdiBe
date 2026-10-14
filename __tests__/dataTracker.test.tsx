import '@testing-library/react-native/extend-expect';
import notifee from '@notifee/react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { PaperProvider } from 'react-native-paper';
import { CATEGORIES } from '../src/core/categories';
import { parseTransactionSms } from '../src/data/parser/SmsParserEngine';
import { parseDataVolumeMb, parseValidityDays } from '../src/data/parser/textUtils';
import { isSpending } from '../src/domain/models/Transaction';
import {
  dataInsights,
  formatVolume,
  MONTHLY_DATA_LIMIT_KEY,
  periodRange,
  summarizeData,
} from '../src/domain/usecases/DataTracker';
import { buildLedgerEntries, ProcessIncomingSmsUseCase } from '../src/domain/usecases/ProcessIncomingSms';
import { DataTrackerScreen } from '../src/presentation/screens/DataTrackerScreen';
import { StatsScreen } from '../src/presentation/screens/StatsScreen';
import { configureFinanceStore, useFinanceStore } from '../src/presentation/store/useFinanceStore';
import { darkTheme, theme } from '../src/presentation/theme/theme';
import { notifyAfterRecording } from '../src/services/notifications/NotificationService';
import { createInMemoryRepositories, tx } from './helpers/inMemoryRepositories';

const ORANGE_PASS = `Vous avez achete le Pass Internet 1,5Go a 1000 FCFA via Orange Money. Valable 30 jours. Votre solde est de : 45000 FCFA. Trans id: PI261013.0915.11112222.`;
const MOOV_PASS = `Vous avez souscrit au forfait Internet 500Mo pour 300,00 FCFA via Moov Money. Validite 24h. Votre solde MOOV Money est de 9 700,00 FCFA.`;
const CREDIT_PASS = `Vous avez souscrit au Pass Jour 200Mo a 200F. Montant debite de votre credit principal. Nouveau solde credit : 350F.`;
const CREDIT_VOICE = `Vous avez souscrit au pass appel illimite a 100F avec votre credit principal.`;
const MOOV_VOICE = `Ref : DIP4KSD2J2, Vous avez rechargé le 22670524434 via Moov Money avec 200,00 FCFA de crédit. GAGNEZ 200% de bonus sur toutes vos recharges.Votre solde MOOV Money est de 11 256,00 FCFA.`;

describe('Parsing des forfaits internet', () => {
  test('volume et validité', () => {
    expect(parseDataVolumeMb('Pass 1,5Go + bonus 500 Mo')).toBe(1536);
    expect(parseDataVolumeMb('750MB')).toBe(750);
    expect(parseDataVolumeMb('1 To illimité')).toBe(1048576);
    expect(parseDataVolumeMb('200 FCFA')).toBeUndefined();
    expect(parseValidityDays('Valable 30 jours')).toBe(30);
    expect(parseValidityDays('Validite 24h')).toBe(1);
    expect(parseValidityDays('valable 2 semaines')).toBe(14);
    expect(parseValidityDays('valable 1 mois')).toBe(30);
    expect(parseValidityDays('Pass Jour 200Mo')).toBe(1);
    expect(parseValidityDays('Pass hebdo')).toBe(7);
    expect(parseValidityDays('forfait mensuel')).toBe(30);
    expect(parseValidityDays('sans durée')).toBeUndefined();
  });

  test('Orange : pass internet payé par Orange Money', () => {
    expect(parseTransactionSms(ORANGE_PASS, { sender: 'OrangeMoney' })).toMatchObject({
      provider: 'ORANGE',
      type: 'AIRTIME_RECHARGE',
      airtimeKind: 'DATA',
      amount: 1000,
      dataVolumeMb: 1536,
      dataValidityDays: 30,
      balanceAfter: 45000,
    });
  });

  test('Moov : forfait payé par Moov Money', () => {
    expect(parseTransactionSms(MOOV_PASS, { sender: 'MoovMoney' })).toMatchObject({
      provider: 'MOOV',
      type: 'AIRTIME_RECHARGE',
      airtimeKind: 'DATA',
      amount: 300,
      dataVolumeMb: 500,
      dataValidityDays: 1,
      balanceAfter: 9700,
    });
  });

  test('forfait payé avec le crédit : suivi sans dépense ni solde MoMo', () => {
    const parsed = parseTransactionSms(CREDIT_PASS, { sender: 'Orange' })!;
    expect(parsed).toMatchObject({
      type: 'DATA_FROM_CREDIT',
      amount: 200,
      total: 200,
      dataVolumeMb: 200,
      dataValidityDays: 1,
    });
    expect(parsed.balanceAfter).toBeUndefined();
    const { transactions, accounts } = buildLedgerEntries(parsed, [], new Date(2026, 9, 13));
    expect(accounts).toEqual([]);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({ category: CATEGORIES.DATA, dataVolumeMb: 200, dataValidityDays: 1 });
    expect(isSpending(transactions[0])).toBe(false);
    // Un pass voix payé avec le crédit n'est ni une dépense ni un forfait data
    expect(parseTransactionSms(CREDIT_VOICE, { sender: 'Orange' })).toBeNull();
  });

  test('recharge de crédit voix : catégorie crédit d’appel, sans volume', () => {
    const parsed = parseTransactionSms(MOOV_VOICE)!;
    expect(parsed.airtimeKind).toBe('VOICE');
    expect(parsed.dataVolumeMb).toBeUndefined();
    const { transactions } = buildLedgerEntries(parsed, [], new Date(2026, 9, 13));
    expect(transactions[0].category).toBe(CATEGORIES.AIRTIME);
    expect(transactions[0]).not.toHaveProperty('dataVolumeMb');
  });

  test('le volume est persisté via le cas d’usage', async () => {
    const repos = createInMemoryRepositories();
    await new ProcessIncomingSmsUseCase(repos).execute({ body: ORANGE_PASS, sender: 'OrangeMoney' });
    const [saved] = await repos.transactions.listAll();
    expect(saved).toMatchObject({ category: CATEGORIES.DATA, dataVolumeMb: 1536, dataValidityDays: 30 });
  });
});

const data = (over: Parameters<typeof tx>[0]) =>
  tx({ type: 'AIRTIME_RECHARGE', category: CATEGORIES.DATA, provider: 'ORANGE', ...over });

const HISTORY = [
  data({ amount: 1000, dataVolumeMb: 1024, dataValidityDays: 30, occurredAt: '2026-10-02T10:00:00' }),
  data({ amount: 200, dataVolumeMb: 200, dataValidityDays: 1, occurredAt: '2026-10-05T10:00:00' }),
  data({ amount: 200, dataVolumeMb: 200, dataValidityDays: 1, occurredAt: '2026-10-06T10:00:00' }),
  data({ amount: 300, provider: 'MOOV', dataVolumeMb: 1024, dataValidityDays: 7, occurredAt: '2026-10-07T10:00:00' }),
  data({ amount: 500, provider: 'MOOV', occurredAt: '2026-10-12T10:00:00' }),
  tx({
    type: 'DATA_FROM_CREDIT',
    category: CATEGORIES.DATA,
    provider: 'ORANGE',
    amount: 100,
    dataVolumeMb: 100,
    dataValidityDays: 1,
    occurredAt: '2026-10-13T08:00:00',
  }),
  tx({ type: 'AIRTIME_RECHARGE', category: CATEGORIES.AIRTIME, amount: 500, occurredAt: '2026-10-08T10:00:00' }),
  data({ amount: 1000, dataVolumeMb: 1024, occurredAt: '2026-09-10T10:00:00' }),
  tx({ amount: 9999, occurredAt: '2026-10-08T10:00:00' }),
];
const NOW = new Date(2026, 9, 14, 12);

describe('DataTracker (domaine)', () => {
  test('périodes : semaine (lun→dim), mois, année, décalage', () => {
    expect(periodRange('WEEK', NOW)).toMatchObject({ from: '2026-10-12', to: '2026-10-19', label: 'Cette semaine' });
    expect(periodRange('WEEK', NOW, -1)).toMatchObject({ from: '2026-10-05', label: 'Du 5/10 au 11/10' });
    expect(periodRange('WEEK', new Date(2026, 9, 18))).toMatchObject({ from: '2026-10-12' });
    expect(periodRange('MONTH', NOW)).toMatchObject({ from: '2026-10-01', to: '2026-11-01', label: 'octobre 2026' });
    expect(periodRange('MONTH', new Date(2026, 0, 5), -1)).toMatchObject({
      from: '2025-12-01',
      label: 'décembre 2025',
    });
    expect(periodRange('YEAR', NOW, -1)).toMatchObject({ from: '2025-01-01', to: '2026-01-01', label: '2025' });
  });

  test('synthèse du mois : argent MoMo, volume, prix du Go, opérateurs, forfaits courts', () => {
    const s = summarizeData(HISTORY, periodRange('MONTH', NOW));
    expect(s).toMatchObject({
      spent: 2200,
      fromCreditAmount: 100,
      fromCreditCount: 1,
      purchases: 6,
      volumeMb: 2548,
      unknownVolumeCount: 1,
      voiceSpent: 500,
      shortPacks: 4,
    });
    expect(s.costPerGb).toBe(Math.round((1800 / 2548) * 1024));
    expect(s.byProvider.map(p => [p.provider, p.spent, p.costPerGb])).toEqual([
      ['ORANGE', 1500, Math.round((1500 / 1524) * 1024)],
      ['MOOV', 800, 300],
    ]);
    expect(s.buckets).toHaveLength(31);
    expect(s.buckets.find(b => b.key === '2026-10-05')).toMatchObject({ spent: 200, volumeMb: 200, label: '5' });
    expect(s.topPacks[0]).toEqual({ label: '200 Mo · 1 jour · 200 F', count: 2, total: 400 });
  });

  test('semaine et année : barres par jour / par mois', () => {
    const week = summarizeData(HISTORY, periodRange('WEEK', NOW));
    expect(week.buckets.map(b => b.label)).toEqual(['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di']);
    expect(week.spent).toBe(500);
    const year = summarizeData(HISTORY, periodRange('YEAR', NOW));
    expect(year.buckets).toHaveLength(12);
    expect(year.buckets[8]).toMatchObject({ label: 'sep', spent: 1000 });
    expect(summarizeData([], periodRange('MONTH', NOW))).toMatchObject({ purchases: 0, costPerGb: undefined });
  });

  test('conseils : tendance, forfaits courts, opérateur le moins cher, plafond, crédit', () => {
    const cur = summarizeData(HISTORY, periodRange('MONTH', NOW));
    const prev = summarizeData(HISTORY, periodRange('MONTH', NOW, -1));
    expect(dataInsights(cur, prev, 2000).map(i => i.id)).toEqual([
      'trend',
      'short-packs',
      'best-provider',
      'limit',
      'from-credit',
    ]);
    expect(dataInsights(cur, prev).find(i => i.id === 'trend')?.message).toBe(
      '130 % de plus en forfaits que sur la période précédente.',
    );
    expect(dataInsights(prev, cur).find(i => i.id === 'trend')?.message).toMatch(/^Bravo : 57 % de moins/);
    expect(dataInsights(cur).find(i => i.id === 'best-provider')?.message).toBe(
      'Ton Go le moins cher : Moov Money à 300 F/Go.',
    );
    expect(dataInsights(summarizeData([], periodRange('MONTH', NOW)))).toEqual([]);
    expect(formatVolume(15 * 1024)).toBe('15 Go');
    expect(formatVolume(1536)).toBe('1,5 Go');
  });

  test('alerte plafond data une seule fois par mois', async () => {
    const repos = createInMemoryRepositories();
    await repos.settings.setJson(MONTHLY_DATA_LIMIT_KEY, 1500);
    await repos.transactions.insertMany(HISTORY);
    const main = HISTORY[4];
    await notifyAfterRecording(repos, [main], NOW);
    expect(notifee.displayNotification).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'data-limit', title: '🌐 Forfaits internet : 2 300 FCFA ce mois' }),
    );
    (notifee.displayNotification as jest.Mock).mockClear();
    await notifyAfterRecording(repos, [main], NOW);
    expect(notifee.displayNotification).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'data-limit' }));
  });
});

describe('Écran Internet & crédit', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    act(() => jest.runOnlyPendingTimers());
    jest.useRealTimers();
  });

  const setup = async () => {
    const repos = createInMemoryRepositories();
    const now = new Date();
    const iso = (d: number) =>
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}T10:00:00`;
    await repos.transactions.insertMany([
      data({ id: 'p1', amount: 1000, dataVolumeMb: 1024, dataValidityDays: 30, occurredAt: iso(1) }),
      data({ id: 'p2', amount: 300, provider: 'MOOV', dataVolumeMb: 1024, occurredAt: iso(1) }),
    ]);
    configureFinanceStore(async () => repos);
    await useFinanceStore.getState().hydrate(now);
    return { repos, now };
  };

  test('synthèse, plafond, barres interactives, périodes', async () => {
    const { repos, now } = await setup();
    const goBack = jest.fn();
    render(
      <PaperProvider theme={theme}>
        <DataTrackerScreen navigation={{ goBack }} />
      </PaperProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('data-total')).toHaveTextContent('1 300 FCFA'));
    expect(screen.getByTestId('data-hero')).toHaveTextContent(/2 Go.*2.*650 F/);
    expect(screen.getByTestId('data-provider-MOOV')).toHaveTextContent(/300 F\/Go/);

    fireEvent.press(screen.getByTestId('edit-data-limit'));
    fireEvent.changeText(screen.getByTestId('data-limit-input'), '1000');
    fireEvent.press(screen.getByTestId('save-data-limit'));
    await waitFor(() => expect(screen.getByTestId('data-limit-status')).toHaveTextContent('Dépassé de 300 FCFA'));
    expect(await repos.settings.getJson(MONTHLY_DATA_LIMIT_KEY, 0)).toBe(1000);
    expect(screen.getByTestId('data-insights')).toHaveTextContent(/Plafond data dépassé de 300 F/);

    const day1 = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    fireEvent.press(screen.getByTestId(`bar-${day1}`));
    expect(screen.getByTestId('data-chart-tooltip')).toHaveTextContent(/1 300 FCFA · 2 Go/);

    fireEvent.press(screen.getByTestId('data-prev'));
    await waitFor(() => expect(screen.getByTestId('data-empty')).toBeTruthy());
    fireEvent.press(screen.getByTestId('period-YEAR'));
    await waitFor(() => expect(screen.getByTestId('data-period-label')).toHaveTextContent(String(now.getFullYear())));
    expect(screen.queryByTestId('data-limit-card')).toBeNull();
    fireEvent.press(screen.getByTestId('period-WEEK'));
    expect(screen.getByTestId('data-period-label')).toHaveTextContent('Cette semaine');
    fireEvent.press(screen.getByTestId('data-back'));
    expect(goBack).toHaveBeenCalled();
  });

  test('thème sombre et accès depuis les Stats', async () => {
    await setup();
    render(
      <PaperProvider theme={darkTheme}>
        <DataTrackerScreen />
      </PaperProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('data-chart')).toBeTruthy());
    screen.unmount();

    const navigate = jest.fn();
    render(
      <PaperProvider theme={theme}>
        <StatsScreen navigation={{ navigate }} />
      </PaperProvider>,
    );
    fireEvent.press(await screen.findByText('Voir le détail ›'));
    expect(navigate).toHaveBeenCalledWith('DataTracker');
  });
});
