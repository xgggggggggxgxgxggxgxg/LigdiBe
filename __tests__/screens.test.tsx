import '@testing-library/react-native/extend-expect';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Linking } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import { CATEGORIES } from '../src/core/categories';
import { DEFAULT_BUDGET_CONFIG } from '../src/domain/models/Budget';
import { RootNavigator } from '../src/presentation/navigation/RootNavigator';
import { DebtsScreen } from '../src/presentation/screens/DebtsScreen';
import { ForecastScreen } from '../src/presentation/screens/ForecastScreen';
import { OnboardingScreen } from '../src/presentation/screens/OnboardingScreen';
import { SettingsScreen } from '../src/presentation/screens/SettingsScreen';
import { configureFinanceStore, useFinanceStore } from '../src/presentation/store/useFinanceStore';
import { useLockStore } from '../src/presentation/store/useLockStore';
import { createInMemoryRepositories, tx } from './helpers/inMemoryRepositories';

jest.mock('../src/data/repositories', () => ({ getRepositories: jest.fn() }));

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
});

const NOW = new Date();
const iso = (d = NOW) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T08:00:00`;

const setup = async (seed?: (r: ReturnType<typeof createInMemoryRepositories>) => Promise<void>) => {
  const repos = createInMemoryRepositories();
  await seed?.(repos);
  configureFinanceStore(async () => repos);
  require('../src/data/repositories').getRepositories.mockResolvedValue(repos);
  await useFinanceStore.getState().hydrate(NOW);
  return repos;
};

const wrap = (ui: React.ReactElement) => render(<PaperProvider>{ui}</PaperProvider>);

describe('DebtsScreen', () => {
  test('dettes, relance WhatsApp, onglets tontines et épargne', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await setup(async r => {
      await r.debts.save({
        id: 'd1',
        contactName: 'Moussa Traoré',
        phone: '70112233',
        amount: 25000,
        amountRepaid: 5000,
        direction: 'OWED_TO_ME',
        isSettled: false,
        dueDate: '2020-01-01',
        createdAt: 'c',
      });
      await r.tontines.save({
        id: 't',
        name: 'Tontine bureau',
        contributionAmount: 10000,
        frequency: 'MONTHLY',
        membersCount: 5,
        myTurn: 3,
        startDate: '2026-01-05',
        paidContributions: [],
      });
      await r.savingsGoals.save({
        id: 'g',
        name: 'Tabaski',
        emoji: '🐏',
        targetAmount: 100000,
        contributions: [{ date: 'x', amount: 25000 }],
        createdAt: '2026-10-01T00:00:00',
      });
    });
    wrap(<DebtsScreen />);
    expect(screen.getByText('Moussa Traoré')).toBeTruthy();
    expect(screen.getByText('En retard')).toBeTruthy();
    expect(screen.getAllByText('20 000 FCFA').length).toBeGreaterThan(0);
    fireEvent.press(screen.getByText('WhatsApp'));
    await waitFor(() =>
      expect(openURL).toHaveBeenCalledWith(
        expect.stringMatching(/^https:\/\/wa\.me\/22670112233\?text=Bonjour%20Moussa/),
      ),
    );

    fireEvent.press(screen.getByText('Tout soldé'));
    await waitFor(() => expect(useFinanceStore.getState().debts[0].isSettled).toBe(true));

    fireEvent.press(screen.getByText('Tontines'));
    expect(screen.getByText('Tontine bureau')).toBeTruthy();
    fireEvent.press(screen.getByText("J'ai cotisé (Poche)"));
    await waitFor(() => expect(useFinanceStore.getState().tontines[0].paidContributions).toHaveLength(1));

    fireEvent.press(screen.getByText('Épargne'));
    expect(screen.getByText('🐏 Tabaski')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Mettre de côté'), '5000');
    fireEvent.press(screen.getByTestId('fab-debt'));
    openURL.mockRestore();
  });

  test('ajout d’une dette via le formulaire', async () => {
    await setup();
    wrap(<DebtsScreen />);
    fireEvent.press(screen.getByTestId('fab-debt'));
    fireEvent.changeText(screen.getByLabelText('Nom'), 'Awa');
    fireEvent.changeText(screen.getByLabelText('Montant'), '15 000');
    fireEvent.press(screen.getByText('Enregistrer'));
    await waitFor(() => expect(useFinanceStore.getState().debts).toHaveLength(1));
    expect(useFinanceStore.getState().debts[0]).toMatchObject({
      contactName: 'Awa',
      amount: 15000,
      direction: 'OWED_TO_ME',
    });
  });
});

describe('ForecastScreen', () => {
  test('synthèse, enveloppes, coche manuelle et liaison à une opération', async () => {
    await setup(async r => {
      await r.settings.saveBudgetConfig({
        ...DEFAULT_BUDGET_CONFIG,
        categoryLimits: { [CATEGORIES.FOOD]: 1000 },
        fixedExpenses: [{ id: 'f', label: 'Loyer', amount: 50000, dayOfMonth: 28 }],
      });
      await r.transactions.insertMany([
        tx({ id: 'r', amount: 1500, category: CATEGORIES.FOOD, counterpartyName: 'MAQUIS', occurredAt: iso() }),
      ]);
      const month = iso().slice(0, 7);
      await r.plannedItems.saveMany([
        {
          id: 'p1',
          month,
          label: 'Salaire',
          amount: 200000,
          kind: 'INCOME',
          category: 'Revenu',
          keywords: [],
          isDone: false,
          recurring: true,
        },
        {
          id: 'p2',
          month,
          label: 'Resto',
          amount: 1500,
          kind: 'EXPENSE',
          category: CATEGORIES.FOOD,
          keywords: [],
          isDone: false,
          recurring: false,
        },
      ]);
    });
    wrap(<ForecastScreen />);
    expect(screen.getByTestId('envelopes-card')).toHaveTextContent(/1 500 \/ 1 000 FCFA/);
    expect(screen.getByText('Loyer')).toBeTruthy();
    fireEvent.press(screen.getByText('Resto'));
    fireEvent.changeText(screen.getByLabelText('Chercher un nom'), 'maquis');
    fireEvent.press(screen.getByText('MAQUIS'));
    await waitFor(() =>
      expect(useFinanceStore.getState().plannedItems.find(i => i.id === 'p2')).toMatchObject({
        isDone: true,
        matchedTransactionId: 'r',
      }),
    );
  });
});

describe('SettingsScreen', () => {
  test('enregistre budget et prénom, ajoute une charge fixe et teste un SMS', async () => {
    await setup();
    wrap(<SettingsScreen />);
    fireEvent.changeText(screen.getByTestId('monthly-budget'), '200000');
    fireEvent.changeText(screen.getByLabelText('Mon prénom'), 'Fatou');
    fireEvent.press(screen.getAllByText('Enregistrer')[0]);
    await waitFor(() => expect(useFinanceStore.getState().budgetConfig.monthlyBudget).toBe(200000));
    expect(useFinanceStore.getState().userName).toBe('Fatou');

    fireEvent.changeText(screen.getByLabelText('Libellé'), 'Scolarité');
    fireEvent.changeText(screen.getAllByLabelText('Montant')[0], '30000');
    fireEvent.changeText(screen.getByLabelText('Jour'), '5');
    fireEvent.press(screen.getByText('Ajouter la charge'));
    await waitFor(() => expect(useFinanceStore.getState().budgetConfig.fixedExpenses).toHaveLength(1));

    const smsInput = screen.getByTestId('test-sms-input');
    fireEvent.changeText(smsInput, 'Vous avez payé 1.500F à Boutique Awa le 12/10/2026 09:15. Solde Wave: 8.500F');
    fireEvent.press(screen.getByText('Analyser'));
    expect(screen.getByTestId('test-sms-result')).toHaveTextContent(/UBA_WAVE · EXPENSE · 1 500 FCFA/);
  });
});

describe('Onboarding & navigation', () => {
  test('onboarding puis onglets', async () => {
    await setup();
    useLockStore.setState({ locked: false });
    wrap(<OnboardingScreen />);
    fireEvent.changeText(screen.getByLabelText('Ton prénom'), 'Ibrahim');
    fireEvent.changeText(screen.getByTestId('onboarding-budget'), '120000');
    fireEvent.press(screen.getByTestId('onboarding-start'));
    await waitFor(() => expect(useFinanceStore.getState().onboarded).toBe(true));
    expect(useFinanceStore.getState().budgetConfig.monthlyBudget).toBe(120000);
  });

  test('RootNavigator : verrou, erreur, onglets', async () => {
    await setup(async r => r.settings.setJson('onboarded', true));
    useLockStore.setState({ locked: true });
    const { unmount } = wrap(<RootNavigator />);
    expect(screen.getByText('LigdiBe 🔒')).toBeTruthy();
    unmount();
    useLockStore.setState({ locked: false });
    wrap(<RootNavigator />);
    await waitFor(() => expect(screen.getByTestId('total-balance')).toBeTruthy());
    expect(screen.getAllByText('Prévisionnel').length).toBeGreaterThan(0);
  });
});

test('rendu en thème sombre sans erreur', async () => {
  const { darkTheme } = require('../src/presentation/theme/theme');
  const { DashboardScreen } = require('../src/presentation/screens/DashboardScreen');
  await setup(async r => r.transactions.insertMany([tx({ id: 'x', counterpartyName: 'NUIT', occurredAt: iso() })]));
  render(
    <PaperProvider theme={darkTheme}>
      <DashboardScreen />
    </PaperProvider>,
  );
  expect(screen.getByText('NUIT')).toBeTruthy();
});
