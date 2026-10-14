import '@testing-library/react-native/extend-expect';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { PaperProvider } from 'react-native-paper';
import { foldText, searchTransactions } from '../src/domain/usecases/SearchTransactions';
import { DashboardScreen } from '../src/presentation/screens/DashboardScreen';
import { configureFinanceStore, useFinanceStore } from '../src/presentation/store/useFinanceStore';
import { theme } from '../src/presentation/theme/theme';
import { createInMemoryRepositories, tx } from './helpers/inMemoryRepositories';

const TXS = [
  tx({ id: 'a', amount: 5000, fee: 50, counterpartyName: 'Moussa Traoré', occurredAt: '2026-10-10T10:00:00' }),
  tx({ id: 'b', amount: 2000, counterpartyName: 'MOUSSA TRAORE', occurredAt: '2026-10-12T10:00:00' }),
  tx({ id: 'c', type: 'INCOME', amount: 7070, counterpartyName: 'Moussa Traoré', occurredAt: '2026-09-01T10:00:00' }),
  tx({ id: 'd', amount: 1500, counterpartyName: 'Maquis Le Verdoyant', note: 'Épargne repas' }),
  tx({ id: 'f', type: 'FEE', amount: 50, counterpartyName: 'Moussa Traoré', source: 'SYSTEM', parentId: 'a' }),
];

describe('searchTransactions', () => {
  test('insensible aux accents et à la casse, tous les mots requis, triés du plus récent', () => {
    const r = searchTransactions(TXS, 'moussa traore');
    expect(r.transactions.map(t => t.id)).toEqual(['b', 'a', 'c']);
    expect(r.totalOut).toBe(7050);
    expect(r.totalIn).toBe(7070);
    expect(searchTransactions(TXS, 'moussa maquis').transactions).toHaveLength(0);
  });

  test('montant exact, note et requête vide', () => {
    expect(searchTransactions(TXS, '1 500').transactions.map(t => t.id)).toEqual(['d']);
    expect(searchTransactions(TXS, 'epargne').transactions.map(t => t.id)).toEqual(['d']);
    expect(searchTransactions(TXS, '   ')).toEqual({ transactions: [], totalOut: 0, totalIn: 0 });
    expect(foldText('  Élève  École ')).toBe('eleve ecole');
  });
});

describe('Recherche depuis l’accueil', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    act(() => jest.runOnlyPendingTimers());
    jest.useRealTimers();
  });

  test('cherche dans tout l’historique, même hors fenêtre chargée', async () => {
    const repos = createInMemoryRepositories();
    await repos.transactions.insertMany([
      ...TXS,
      tx({ id: 'old', amount: 9000, counterpartyName: 'Moussa Traoré', occurredAt: '2019-01-05T10:00:00' }),
    ]);
    configureFinanceStore(async () => repos);
    await useFinanceStore.getState().hydrate(new Date(2026, 9, 13));
    expect(useFinanceStore.getState().transactions.some(t => t.id === 'old')).toBe(false);

    render(
      <PaperProvider theme={theme}>
        <DashboardScreen />
      </PaperProvider>,
    );
    fireEvent.press(screen.getByTestId('open-search'));
    fireEvent.changeText(await screen.findByTestId('search-input'), 'moussa');
    await waitFor(() => expect(screen.getByTestId('search-summary')).toHaveTextContent(/4 opération/));
    expect(screen.getByTestId('search-summary')).toHaveTextContent(/16 050 FCFA/);
    expect(screen.getByTestId('tx-old')).toBeTruthy();
  });
});
