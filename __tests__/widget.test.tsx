import '@testing-library/react-native/extend-expect';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { NativeModules } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import { DEFAULT_BUDGET_CONFIG } from '../src/domain/models/Budget';
import type { DailyBudgetResult } from '../src/domain/usecases/CalculateDailyBudget';
import { useWidgetSync } from '../src/presentation/hooks/useWidgetSync';
import { SettingsScreen } from '../src/presentation/screens/SettingsScreen';
import { configureFinanceStore, useFinanceStore } from '../src/presentation/store/useFinanceStore';
import {
  buildWidgetPayload,
  pushWidget,
  refreshWidgetFromRepos,
  WIDGET_SHOW_BALANCE_KEY,
} from '../src/services/widget/WidgetService';
import { createInMemoryRepositories, tx } from './helpers/inMemoryRepositories';

jest.mock('../src/data/repositories', () => ({ getRepositories: jest.fn() }));

const NOW = new Date(2026, 9, 14, 14, 5);
const budget = (over: Partial<DailyBudgetResult>): DailyBudgetResult =>
  ({
    todayBudget: 16000,
    todaySpent: 3500,
    todayRemaining: 12500,
    progress: 3500 / 16000,
    status: 'OK',
    todayMultiplier: 1,
    isWeekendBoostActive: false,
    ...over,
  } as DailyBudgetResult);

const update = jest.fn(async () => undefined);
beforeEach(() => {
  update.mockClear();
  NativeModules.LigdiBeWidget = { update };
});
afterAll(() => {
  delete NativeModules.LigdiBeWidget;
});

describe('buildWidgetPayload', () => {
  test('reste du jour, jauge, série, patrimoine masqué par défaut', () => {
    expect(buildWidgetPayload({ budget: budget({}), streak: 5, now: NOW })).toEqual({
      day: '2026-10-14',
      remaining: '12 500 FCFA',
      caption: "Reste pour aujourd'hui",
      detail: '3 500 / 16 000 FCFA dépensés',
      progress: 22,
      status: 'OK',
      badge: '🔥 5 j',
      balance: '',
      updated: 'MAJ 14:05',
    });
  });

  test('dépassement, week-end et patrimoine affiché', () => {
    const p = buildWidgetPayload({
      budget: budget({
        todaySpent: 20000,
        todayRemaining: 0,
        progress: 1.25,
        status: 'EXCEEDED',
        isWeekendBoostActive: true,
        todayMultiplier: 1.5,
      }),
      streak: 0,
      now: NOW,
      totalBalance: 250000,
    });
    expect(p).toMatchObject({
      remaining: '4 000 FCFA',
      caption: 'Dépassement du jour',
      progress: 100,
      badge: '🎉 Week-end ×1,5',
      balance: 'Patrimoine 250 000 FCFA',
    });
  });
});

describe('pushWidget / refreshWidgetFromRepos', () => {
  test('sans module natif ou en erreur : sans effet', async () => {
    const payload = buildWidgetPayload({ budget: budget({}), streak: 0, now: NOW });
    expect(await pushWidget(payload)).toBe(true);
    update.mockRejectedValueOnce(new Error('pas de widget'));
    expect(await pushWidget(payload)).toBe(false);
    delete NativeModules.LigdiBeWidget;
    expect(await pushWidget(payload)).toBe(false);
  });

  test('recalcule depuis la base, patrimoine selon le réglage', async () => {
    const repos = createInMemoryRepositories();
    await repos.settings.saveBudgetConfig({ ...DEFAULT_BUDGET_CONFIG, monthlyBudget: 150000 });
    await repos.accounts.saveMany([
      { id: 'moov-money', name: 'Moov', provider: 'MOOV', type: 'MOMO', currentBalance: 9000 },
      { id: 'cash-wallet', name: 'Poche', provider: 'CASH', type: 'CASH', currentBalance: 1000 },
    ]);
    await repos.transactions.insertMany([tx({ amount: 2000, occurredAt: '2026-10-14T09:00:00' })]);
    await refreshWidgetFromRepos(repos, NOW);
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ day: '2026-10-14', balance: '' }));
    expect(update.mock.calls[0]).toEqual([expect.objectContaining({ detail: expect.stringMatching(/^2 000 \//) })]);

    await repos.settings.setJson(WIDGET_SHOW_BALANCE_KEY, true);
    await refreshWidgetFromRepos(repos, NOW);
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ balance: 'Patrimoine 10 000 FCFA' }));
  });
});

describe('useWidgetSync + réglage', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    act(() => jest.runOnlyPendingTimers());
    jest.useRealTimers();
  });

  test('pousse le widget une fois l’app prête, et après changement du réglage', async () => {
    const repos = createInMemoryRepositories();
    configureFinanceStore(async () => repos);
    require('../src/data/repositories').getRepositories.mockResolvedValue(repos);
    await useFinanceStore.getState().hydrate(new Date());
    renderHook(() => useWidgetSync());
    expect(update).not.toHaveBeenCalled();

    await act(async () => {
      await useFinanceStore.getState().completeOnboarding('Awa', DEFAULT_BUDGET_CONFIG);
    });
    await waitFor(() => expect(update).toHaveBeenCalledWith(expect.objectContaining({ balance: '' })));

    render(
      <PaperProvider>
        <SettingsScreen />
      </PaperProvider>,
    );
    fireEvent(screen.getByTestId('widget-balance-switch'), 'valueChange', true);
    await waitFor(() => expect(useFinanceStore.getState().widgetShowBalance).toBe(true));
    await waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ balance: 'Patrimoine 0 FCFA' })),
    );
    expect(await repos.settings.getJson(WIDGET_SHOW_BALANCE_KEY, false)).toBe(true);
  });
});
