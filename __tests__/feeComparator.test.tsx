import '@testing-library/react-native/extend-expect';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { PaperProvider } from 'react-native-paper';
import { CATEGORIES } from '../src/core/categories';
import {
  collectFeeObservations,
  compareOperators,
  estimateFee,
  potentialSavings,
} from '../src/domain/usecases/FeeComparator';
import { FeeComparatorModal } from '../src/presentation/components/FeeComparatorModal';
import { configureFinanceStore, useFinanceStore } from '../src/presentation/store/useFinanceStore';
import { theme } from '../src/presentation/theme/theme';
import { createInMemoryRepositories, tx } from './helpers/inMemoryRepositories';

const sms = (over: Parameters<typeof tx>[0]) => tx({ source: 'SMS', rawSms: 'Frais: x', ...over });

const HISTORY = [
  // Orange : ~1 % sur les envois
  sms({ provider: 'ORANGE', amount: 10000, fee: 100, counterpartyPhone: '70000001' }),
  sms({ provider: 'ORANGE', amount: 50000, fee: 500, counterpartyPhone: '70000002' }),
  // Moov : 0,5 % sur les envois, 1 % sur les retraits
  sms({ provider: 'MOOV', amount: 20000, fee: 100, category: CATEGORIES.TRANSFER }),
  sms({ provider: 'MOOV', amount: 1000, fee: 10, type: 'CASH_WITHDRAWAL' }),
  // Paiement marchand gratuit, explicitement indiqué
  sms({ provider: 'MOOV', amount: 6000, fee: 0, rawSms: 'Frais: 0,00 FCFA', counterpartyName: 'INTOUCH' }),
  // Exclus : frais non mentionnés, manuel, écriture FEE, Poche, revenu
  sms({ provider: 'UBA_WAVE', amount: 3000, fee: 0, rawSms: 'Vous avez payé 3.000F', counterpartyPhone: '7' }),
  tx({ provider: 'ORANGE', amount: 9999, fee: 999, counterpartyPhone: '7', source: 'MANUAL' }),
  sms({ provider: 'ORANGE', amount: 100, type: 'FEE' }),
  sms({ provider: 'CASH', amount: 100, fee: 1, counterpartyPhone: '7' }),
  sms({ provider: 'ORANGE', amount: 100, fee: 1, type: 'INCOME' }),
];

describe('FeeComparator', () => {
  test('ne retient que les frais réellement observés', () => {
    const obs = collectFeeObservations(HISTORY);
    expect(obs.map(o => `${o.provider}:${o.operation}:${o.charges}`)).toEqual([
      'ORANGE:TRANSFER:100',
      'ORANGE:TRANSFER:500',
      'MOOV:TRANSFER:100',
      'MOOV:WITHDRAWAL:10',
      'MOOV:PAYMENT:0',
    ]);
  });

  test('estimation par montants voisins, confiance selon le nombre d’opérations', () => {
    const obs = collectFeeObservations(HISTORY);
    expect(estimateFee(obs, 'ORANGE', 'TRANSFER', 30000)).toMatchObject({ fee: 300, samples: 2, confidence: 'LOW' });
    expect(estimateFee(obs, 'UBA_WAVE', 'TRANSFER', 30000)).toBeUndefined();
    expect(estimateFee(obs, 'ORANGE', 'TRANSFER', 0)).toBeUndefined();
    const many = Array.from({ length: 5 }, () =>
      sms({ provider: 'MOOV', amount: 1000, fee: 10, type: 'CASH_WITHDRAWAL' }),
    );
    expect(estimateFee(collectFeeObservations(many), 'MOOV', 'WITHDRAWAL', 2000)?.confidence).toBe('HIGH');
  });

  test('classement du moins cher au plus cher et économie maximale', () => {
    const c = compareOperators(HISTORY, 'TRANSFER', 40000);
    expect(c.estimates.map(e => [e.provider, e.fee])).toEqual([
      ['MOOV', 200],
      ['ORANGE', 400],
    ]);
    expect(c.maxSaving).toBe(200);
    expect(compareOperators(HISTORY, 'WITHDRAWAL', 5000)).toMatchObject({ maxSaving: 0 });
    expect(compareOperators([], 'PAYMENT', 5000)).toEqual({ estimates: [], cheapest: undefined, maxSaving: 0 });
  });

  test('économie possible sur la période', () => {
    const month = [sms({ provider: 'ORANGE', amount: 10000, fee: 100, counterpartyPhone: '70000001' })];
    expect(potentialSavings(month, HISTORY)).toBe(50);
    expect(potentialSavings([], HISTORY)).toBe(0);
  });
});

describe('FeeComparatorModal', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    act(() => jest.runOnlyPendingTimers());
    jest.useRealTimers();
  });

  test('simulation, changement d’opération et état vide', async () => {
    const repos = createInMemoryRepositories();
    await repos.transactions.insertMany(HISTORY);
    configureFinanceStore(async () => repos);
    await useFinanceStore.getState().hydrate(new Date(2026, 9, 13));
    render(
      <PaperProvider theme={theme}>
        <FeeComparatorModal visible onDismiss={jest.fn()} />
      </PaperProvider>,
    );
    fireEvent.changeText(screen.getByTestId('fee-amount'), '40000');
    await waitFor(() => expect(screen.getByTestId('fee-row-MOOV')).toHaveTextContent(/200 FCFA/));
    expect(screen.getByTestId('fee-row-MOOV')).toHaveTextContent(/Le moins cher/);
    expect(screen.getByTestId('fee-row-ORANGE')).toHaveTextContent(/400 FCFA.*indicative|indicative.*400 FCFA/);
    expect(screen.getByTestId('fee-saving')).toHaveTextContent(/Moov Money.*200 FCFA/);

    fireEvent.press(screen.getByTestId('fee-op-PAYMENT'));
    await waitFor(() => expect(screen.getByTestId('fee-row-MOOV')).toHaveTextContent(/0 FCFA/));
    expect(screen.queryByTestId('fee-saving')).toBeNull();

    fireEvent.changeText(screen.getByTestId('fee-amount'), '');
    await waitFor(() => expect(screen.getByTestId('fee-empty')).toBeTruthy());
  });
});
