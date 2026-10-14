import '@testing-library/react-native/extend-expect';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { PaperProvider } from 'react-native-paper';
import { StatsScreen } from '../src/presentation/screens/StatsScreen';
import { configureFinanceStore, useFinanceStore } from '../src/presentation/store/useFinanceStore';
import { createInMemoryRepositories, tx } from './helpers/inMemoryRepositories';

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
});

test('Stats : top destinataires, frais, comparaison et navigation entre mois', async () => {
  const repos = createInMemoryRepositories();
  await repos.transactions.insertMany([
    tx({ amount: 8800, counterpartyName: 'ALI', counterpartyPhone: '70000001', occurredAt: '2026-10-05T10:00:00' }),
    tx({ type: 'FEE', amount: 75, occurredAt: '2026-10-05T10:00:00', category: 'Frais & Taxes' }),
    tx({ amount: 10000, counterpartyName: 'AWA', occurredAt: '2026-09-05T10:00:00' }),
    tx({
      amount: 3000,
      counterpartyName: 'Maman',
      category: 'Famille & Solidarité',
      occurredAt: '2026-10-06T10:00:00',
    }),
    tx({ type: 'INCOME', amount: 30000, counterpartyName: 'BOSS', occurredAt: '2026-10-01T10:00:00' }),
  ]);
  configureFinanceStore(async () => repos);
  await useFinanceStore.getState().hydrate(new Date(2026, 9, 13, 10));

  render(
    <PaperProvider>
      <StatsScreen />
    </PaperProvider>,
  );
  await waitFor(() => expect(screen.getByText('1. ALI')).toBeTruthy());
  expect(screen.getByTestId('fees-tile')).toHaveTextContent(/75 FCFA/);
  expect(screen.getByTestId('fee-comparator-card')).toHaveTextContent(/Comparateur de frais/);
  fireEvent.press(screen.getByTestId('open-fee-comparator'));
  expect(await screen.findByTestId('fee-amount')).toBeTruthy();
  expect(screen.getByTestId('family-tile')).toHaveTextContent(/3 000 FCFA.*10 % des entrées/);
  expect(screen.getByTestId('month-comparison')).toHaveTextContent(/19 % de dépenses en plus qu'en septembre/);

  fireEvent.press(screen.getByTestId('prev-month'));
  await waitFor(() => expect(screen.getByTestId('stats-month')).toHaveTextContent('septembre 2026'));
  await waitFor(() => expect(screen.getByText('1. AWA')).toBeTruthy());
  fireEvent.press(screen.getByTestId('next-month'));
  await waitFor(() => expect(screen.getByTestId('stats-month')).toHaveTextContent('octobre 2026'));
});
