import '@testing-library/react-native/extend-expect';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { PaperProvider } from 'react-native-paper';
import { ProcessIncomingSmsUseCase } from '../src/domain/usecases/ProcessIncomingSms';
import {
  enqueueUnrecognized,
  looksLikeFinancialSms,
  toUnrecognizedSms,
  UNRECOGNIZED_SMS_KEY,
  type UnrecognizedSms,
} from '../src/domain/usecases/UnrecognizedSms';
import { DashboardScreen } from '../src/presentation/screens/DashboardScreen';
import { configureFinanceStore, useFinanceStore } from '../src/presentation/store/useFinanceStore';
import { theme } from '../src/presentation/theme/theme';
import { createInMemoryRepositories } from './helpers/inMemoryRepositories';

const UNKNOWN_FORMAT = 'Cher client, votre facture SONABEL de 12 450 FCFA a ete reglee. Nouveau solde 8 300 FCFA.';
const UNKNOWN_INCOME = 'Bonne nouvelle ! Un montant de 25.000F a ete credite sur votre portefeuille.';
const NOW = new Date(2026, 9, 13, 9, 0);

describe('UnrecognizedSms (domaine)', () => {
  test('reconnaît un SMS financier, écarte promos et messages sans montant', () => {
    expect(looksLikeFinancialSms(UNKNOWN_FORMAT)).toBe(true);
    expect(looksLikeFinancialSms(UNKNOWN_INCOME)).toBe(true);
    expect(looksLikeFinancialSms('GAGNEZ 200% de bonus sur vos recharges de 500 FCFA')).toBe(false);
    expect(looksLikeFinancialSms('Votre facture est disponible')).toBe(false);
    expect(looksLikeFinancialSms('Bonjour, rappelle-moi')).toBe(false);
  });

  test('pré-remplit montant et sens', () => {
    expect(toUnrecognizedSms(UNKNOWN_FORMAT, 'OrangeMoney', 'd')).toMatchObject({
      suggestedAmount: 12450,
      suggestedType: 'EXPENSE',
      sender: 'OrangeMoney',
    });
    expect(toUnrecognizedSms(UNKNOWN_INCOME, 'Wave', 'd')).toMatchObject({
      suggestedAmount: 25000,
      suggestedType: 'INCOME',
    });
    expect(toUnrecognizedSms('Votre retrait est effectue', 'Wave', 'd').suggestedAmount).toBeUndefined();
  });

  test('file sans doublon, triée et bornée', () => {
    const a = toUnrecognizedSms('a', 'X', '2026-10-01T00:00:00');
    const b = toUnrecognizedSms('b', 'X', '2026-10-02T00:00:00');
    const c = toUnrecognizedSms('c', 'X', '2026-10-03T00:00:00');
    let q: UnrecognizedSms[] = [];
    q = enqueueUnrecognized(q, a);
    q = enqueueUnrecognized(q, a);
    expect(q).toHaveLength(1);
    q = enqueueUnrecognized(enqueueUnrecognized(q, c), b, 2);
    expect(q.map(x => x.body)).toEqual(['c', 'b']);
  });
});

describe('ProcessIncomingSmsUseCase : SMS non reconnus', () => {
  test('mis de côté uniquement pour un expéditeur agréé, jamais un OTP', async () => {
    const repos = createInMemoryRepositories();
    const uc = new ProcessIncomingSmsUseCase(repos);
    const r = await uc.execute({ body: UNKNOWN_FORMAT, sender: 'OrangeMoney', receivedAt: NOW });
    expect(r.status).toBe('UNRECOGNIZED');
    expect((await uc.execute({ body: UNKNOWN_FORMAT, sender: 'OrangeMoney', receivedAt: NOW })).status).toBe(
      'UNRECOGNIZED',
    );
    expect((await uc.execute({ body: UNKNOWN_FORMAT, sender: 'Inconnu' })).status).toBe('IGNORED');
    expect((await uc.execute({ body: UNKNOWN_FORMAT })).status).toBe('IGNORED');
    expect((await uc.execute({ body: 'Retrait de 5000 FCFA : votre code OTP est 1234', sender: 'Wave' })).status).toBe(
      'IGNORED',
    );
    expect((await uc.execute({ body: 'Bienvenue chez Orange', sender: 'Orange' })).status).toBe('IGNORED');
    const queue = await repos.settings.getJson<UnrecognizedSms[]>(UNRECOGNIZED_SMS_KEY, []);
    expect(queue).toHaveLength(1);
    expect(queue[0].receivedAt).toBe('2026-10-13T09:00:00');
  });
});

describe('Store + accueil : vérification des SMS non reconnus', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    act(() => jest.runOnlyPendingTimers());
    jest.useRealTimers();
  });

  test('bannière, saisie pré-remplie puis rejet', async () => {
    const repos = createInMemoryRepositories();
    configureFinanceStore(async () => repos);
    await useFinanceStore.getState().hydrate(new Date());
    await useFinanceStore.getState().ingestSms({ body: UNKNOWN_FORMAT, sender: 'OrangeMoney', receivedAt: NOW });
    await useFinanceStore.getState().ingestSms({ body: UNKNOWN_INCOME, sender: 'Wave', receivedAt: NOW });
    expect(useFinanceStore.getState().unrecognizedSms).toHaveLength(2);

    render(
      <PaperProvider theme={theme}>
        <DashboardScreen />
      </PaperProvider>,
    );
    expect(screen.getByText(/2 SMS opérateur non reconnus/)).toBeTruthy();
    fireEvent.press(screen.getByTestId('review-unrecognized'));
    const facture = useFinanceStore.getState().unrecognizedSms.find(u => u.body === UNKNOWN_FORMAT)!;
    fireEvent.press(await screen.findByTestId(`unrecognized-${facture.id}`));
    expect(screen.getByTestId('unrecognized-amount')).toHaveProp('value', '12450');
    fireEvent.press(screen.getByTestId('unrecognized-save'));

    await waitFor(() => expect(useFinanceStore.getState().unrecognizedSms).toHaveLength(1));
    const saved = useFinanceStore.getState().transactions[0];
    expect(saved).toMatchObject({
      amount: 12450,
      type: 'EXPENSE',
      accountId: 'orange-money',
      rawSms: UNKNOWN_FORMAT,
      occurredAt: '2026-10-13T09:00:00',
    });
    expect(saved.smsFingerprint).toBeDefined();
    expect(useFinanceStore.getState().accounts.find(a => a.id === 'orange-money')?.currentBalance).toBe(-12450);

    const income = useFinanceStore.getState().unrecognizedSms[0];
    fireEvent.press(await screen.findByTestId(`unrecognized-${income.id}`));
    fireEvent.press(screen.getByTestId('unrecognized-dismiss'));
    await waitFor(() => expect(useFinanceStore.getState().unrecognizedSms).toHaveLength(0));
    expect(await repos.settings.getJson(UNRECOGNIZED_SMS_KEY, ['x'])).toEqual([]);
    expect(useFinanceStore.getState().transactions).toHaveLength(1);
  });
});
