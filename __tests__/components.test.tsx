import '@testing-library/react-native/extend-expect';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { PaperProvider } from 'react-native-paper';
import { calculateDailyBudget } from '../src/domain/usecases/CalculateDailyBudget';
import { DEFAULT_BUDGET_CONFIG } from '../src/domain/models/Budget';
import { BalanceCard } from '../src/presentation/components/BalanceCard';
import { DailyBudgetCard } from '../src/presentation/components/DailyBudgetCard';
import { TransactionItem, transactionSign } from '../src/presentation/components/TransactionItem';
import { DashboardScreen, filterTransactions } from '../src/presentation/screens/DashboardScreen';
import { configureFinanceStore, useFinanceStore } from '../src/presentation/store/useFinanceStore';
import { theme } from '../src/presentation/theme/theme';
import { createInMemoryRepositories, tx } from './helpers/inMemoryRepositories';

// Les animations Paper (Chip, FAB, Surface) tournent sur des timers : on les contrôle.
beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
});

const wrap = (ui: React.ReactElement) => render(<PaperProvider theme={theme}>{ui}</PaperProvider>);
const config = { ...DEFAULT_BUDGET_CONFIG, monthlyBudget: 150000 };

describe('DailyBudgetCard', () => {
  test('affiche l’enveloppe restante, sans alerte', () => {
    wrap(<DailyBudgetCard budget={calculateDailyBudget(config, [], new Date(2026, 9, 13, 10))} />);
    expect(screen.getByText('6 857 FCFA')).toBeTruthy();
    expect(screen.queryByTestId('budget-alert')).toBeNull();
    expect(screen.queryByTestId('weekend-chip')).toBeNull();
  });

  test('alerte visuelle en cas de dépassement, badge week-end et série', () => {
    const b = calculateDailyBudget(
      config,
      [tx({ amount: 50000, occurredAt: '2026-10-17T10:00:00' })],
      new Date(2026, 9, 17, 12),
    );
    wrap(<DailyBudgetCard budget={b} streak={4} />);
    expect(screen.getByTestId('budget-alert')).toBeTruthy();
    expect(screen.getByTestId('weekend-chip')).toBeTruthy();
    expect(screen.getByText('4 j')).toBeTruthy();
  });
});

describe('TransactionItem & BalanceCard', () => {
  test('signe et montant', () => {
    const onPress = jest.fn();
    const t = tx({ id: 'x', amount: 2500, counterpartyName: 'Sadja Design' });
    wrap(<TransactionItem transaction={t} onPress={onPress} />);
    expect(screen.getByText('Sadja Design')).toBeTruthy();
    expect(screen.getByText('-2 500 FCFA')).toBeTruthy();
    fireEvent.press(screen.getByTestId('tx-x'));
    expect(onPress).toHaveBeenCalledWith(t);
    expect(transactionSign(tx({ type: 'CASH_DEPOSIT' }))).toBe('+');
    expect(transactionSign(tx({ type: 'CASH_WITHDRAWAL' }))).toBe('⇄');
  });

  test('solde masqué', () => {
    wrap(
      <BalanceCard
        account={{ id: 'a', name: 'Moov Money', provider: 'MOOV', type: 'MOMO', currentBalance: 9891 }}
        hidden
      />,
    );
    expect(screen.getByText('•••••')).toBeTruthy();
  });
});

describe('DashboardScreen', () => {
  test('total combiné, carrousel, filtres rapides', async () => {
    const repos = createInMemoryRepositories();
    await repos.accounts.saveMany([
      { id: 'moov-money', name: 'Moov Money', provider: 'MOOV', type: 'MOMO', currentBalance: 9891 },
      { id: 'cash-wallet', name: 'Poche', provider: 'CASH', type: 'CASH', currentBalance: 1000 },
    ]);
    const now = new Date();
    const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(
      2,
      '0',
    )}T08:00:00`;
    await repos.transactions.insertMany([
      tx({ id: 'e', amount: 6000, counterpartyName: 'INTOUCH BURKINA', occurredAt: iso }),
      tx({ id: 'i', type: 'INCOME', amount: 7070, counterpartyName: 'MME SANGARE', occurredAt: iso }),
      tx({ id: 'a', type: 'AIRTIME_RECHARGE', amount: 200, occurredAt: iso, category: "Crédit d'appel & Data" }),
    ]);
    configureFinanceStore(async () => repos);
    await useFinanceStore.getState().hydrate(now);

    wrap(<DashboardScreen />);
    expect(screen.getByTestId('total-balance')).toHaveTextContent('10 891 FCFA');
    expect(screen.getByTestId('balance-cash-wallet')).toBeTruthy();
    expect(screen.getByText('INTOUCH BURKINA')).toBeTruthy();
    expect(screen.getByTestId('airtime-tile')).toHaveTextContent(/200 FCFA/);

    fireEvent.press(screen.getByTestId('filter-INCOME'));
    await waitFor(() => expect(screen.queryByText('INTOUCH BURKINA')).toBeNull());
    expect(screen.getByText('MME SANGARE')).toBeTruthy();

    fireEvent.press(screen.getByTestId('toggle-hide'));
    expect(screen.getByTestId('total-balance')).toHaveTextContent('••••••');
  });

  test('filterTransactions', () => {
    const all = [
      tx({ type: 'EXPENSE' }),
      tx({ type: 'CASH_DEPOSIT' }),
      tx({ type: 'CASH_WITHDRAWAL' }),
      tx({ type: 'FEE' }),
    ];
    expect(filterTransactions(all, 'CASH')).toHaveLength(2);
    expect(filterTransactions(all, 'FEE')).toHaveLength(1);
    expect(filterTransactions(all, 'ALL')).toHaveLength(4);
  });
});
