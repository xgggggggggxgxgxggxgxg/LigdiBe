import { CATEGORIES } from '../src/core/categories';
import { DEFAULT_BUDGET_CONFIG } from '../src/domain/models/Budget';
import { configureFinanceStore, useFinanceStore } from '../src/presentation/store/useFinanceStore';
import { createInMemoryRepositories, tx } from './helpers/inMemoryRepositories';

const MOOV_WITHDRAWAL = `Retrait reussi auprès de l'Agent IBRAHIM ILBOUDO\nCode d'agent: 1003631\nMontant: 1 000,00 FCFA\nFrais: 10,00 FCFA\nTotal: 1 010,00 FCFA\nDate: 13/10/2026 08:17:58\nTxn ID: DIU3L2SENF\nSolde: 16 316,00 FCFA`;
const NOW = new Date(2026, 9, 13, 10);

const setup = async () => {
  const repos = createInMemoryRepositories();
  configureFinanceStore(async () => repos);
  await useFinanceStore.getState().hydrate(NOW);
  return { repos, store: useFinanceStore.getState };
};

describe('useFinanceStore', () => {
  test('hydratation : comptes par défaut dont la Poche', async () => {
    const { store } = await setup();
    expect(store().ready).toBe(true);
    expect(store().accounts.map(a => a.id)).toContain('cash-wallet');
    expect(store().budgetConfig).toEqual(DEFAULT_BUDGET_CONFIG);
  });

  test('erreur de base exposée sans crash', async () => {
    configureFinanceStore(async () => {
      throw new Error('clé introuvable');
    });
    await useFinanceStore.getState().hydrate(NOW);
    expect(useFinanceStore.getState().error).toBe('clé introuvable');
  });

  test('SMS de retrait : MoMo ↓, Poche ↑, rien en dépense sauf les frais', async () => {
    const { store } = await setup();
    const res = await store().ingestSms({ body: MOOV_WITHDRAWAL, sender: 'MoovMoney', receivedAt: NOW });
    expect(res.status).toBe('RECORDED');
    const acc = (id: string) => store().accounts.find(a => a.id === id)?.currentBalance;
    expect(acc('moov-money')).toBe(16316);
    expect(acc('cash-wallet')).toBe(1000);
    expect(store().transactions).toHaveLength(3);
    expect((await store().ingestSms({ body: MOOV_WITHDRAWAL })).status).toBe('DUPLICATE');
  });

  test('dépense manuelle en espèces, recatégorisation apprise, suppression', async () => {
    const { store, repos } = await setup();
    await store().setAccountBalance('cash-wallet', 5000);
    await store().setAccountBalance('inconnu', 1);
    const t = await store().addManualTransaction({
      accountId: 'cash-wallet',
      type: 'EXPENSE',
      amount: 1500,
      category: CATEGORIES.FOOD,
      counterpartyName: 'Maquis Chez Tanti',
    });
    expect(store().accounts.find(a => a.id === 'cash-wallet')?.currentBalance).toBe(3500);
    await store().addManualTransaction({
      accountId: 'cash-wallet',
      type: 'INCOME',
      amount: 500,
      category: CATEGORIES.INCOME,
    });
    expect(store().accounts.find(a => a.id === 'cash-wallet')?.currentBalance).toBe(4000);
    await expect(
      store().addManualTransaction({ accountId: 'x', type: 'EXPENSE', amount: 1, category: 'x' }),
    ).rejects.toThrow();

    await store().recategorize(t.id, CATEGORIES.FAMILY);
    expect(store().learnedCategories['MAQUIS CHEZ TANTI']).toBe(CATEGORIES.FAMILY);
    expect(repos.store.transactions.find(x => x.id === t.id)?.category).toBe(CATEGORIES.FAMILY);
    await store().deleteTransaction(t.id);
    expect(store().transactions.find(x => x.id === t.id)).toBeUndefined();
  });

  test('dettes : création, remboursement, suppression', async () => {
    const { store } = await setup();
    await store().saveDebt({ contactName: 'Awa', amount: 10000, direction: 'OWED_TO_ME' });
    const id = store().debts[0].id;
    await store().repayDebt(id, 10000);
    expect(store().debts[0].isSettled).toBe(true);
    await store().repayDebt('nope', 1);
    await store().deleteDebt(id);
    expect(store().debts).toEqual([]);
  });

  test('prévisionnel : coche auto à la saisie, bascule manuelle, report', async () => {
    const { store, repos } = await setup();
    await store().savePlannedItem({
      label: 'Loyer',
      amount: 50000,
      kind: 'EXPENSE',
      category: CATEGORIES.RENT,
      keywords: ['kabore'],
      recurring: true,
    });
    await store().savePlannedItem({
      label: 'Mariage Ali',
      amount: 20000,
      kind: 'EXPENSE',
      category: CATEGORIES.FAMILY,
      keywords: [],
      recurring: false,
    });
    await store().addManualTransaction({
      accountId: 'cash-wallet',
      type: 'EXPENSE',
      amount: 50000,
      category: CATEGORIES.RENT,
      counterpartyName: 'M. KABORE',
    });
    const loyer = store().plannedItems.find(i => i.label === 'Loyer')!;
    expect(loyer.isDone).toBe(true);
    const mariage = store().plannedItems.find(i => i.label === 'Mariage Ali')!;
    await store().togglePlannedItem(mariage.id);
    expect(store().plannedItems.find(i => i.id === mariage.id)?.isDone).toBe(true);
    await store().togglePlannedItem(mariage.id);
    expect(store().plannedItems.find(i => i.id === mariage.id)?.isDone).toBe(false);
    await store().togglePlannedItem('nope');
    expect(await store().carryOverToNextMonth()).toBe(2);
    expect(repos.store.planned.filter(p => p.month === '2026-11')).toHaveLength(2);
    await store().deletePlannedItem(mariage.id);
    expect(store().plannedItems).toHaveLength(1);
  });

  test('budget, charges fixes payées, tontine, onboarding', async () => {
    const { store, repos } = await setup();
    await store().saveBudgetConfig({ ...DEFAULT_BUDGET_CONFIG, monthlyBudget: 99 });
    expect((await repos.settings.getBudgetConfig()).monthlyBudget).toBe(99);
    await store().toggleFixedExpensePaid('loyer');
    expect(store().paidFixedExpenseIds).toEqual(['loyer']);
    await store().toggleFixedExpensePaid('loyer');
    expect(store().paidFixedExpenseIds).toEqual([]);

    await store().saveTontine({
      name: 'Bureau',
      contributionAmount: 5000,
      frequency: 'MONTHLY',
      membersCount: 4,
      myTurn: 2,
      startDate: '2026-10-01',
    });
    const tid = store().tontines[0].id;
    await store().payTontine(tid);
    await store().payTontine('nope');
    expect(store().tontines[0].paidContributions).toHaveLength(1);
    expect(store().transactions[0]).toMatchObject({ category: CATEGORIES.TONTINE, amount: 5000 });
    await store().deleteTontine(tid);
    expect(store().tontines).toEqual([]);

    await store().completeOnboarding('Fatou', DEFAULT_BUDGET_CONFIG);
    expect(store().onboarded).toBe(true);
    expect(repos.store.accounts.length).toBeGreaterThan(0);
    await store().setUserName('Awa');
    await store().setExtraSenders([' CorisMoney ', '']);
    expect(store().extraSenders).toEqual(['CorisMoney']);
    await store().hydrate(NOW);
    expect(store()).toMatchObject({ userName: 'Awa', extraSenders: ['CorisMoney'], onboarded: true });
  });
});

describe('getMonthTransactions', () => {
  test('mémoire pour les mois récents, base pour les anciens', async () => {
    const repos = createInMemoryRepositories();
    configureFinanceStore(async () => repos);
    await repos.transactions.insertMany([
      tx({ id: 'old', occurredAt: '2025-03-10T10:00:00' }),
      tx({ id: 'recent', occurredAt: '2026-10-02T10:00:00' }),
    ]);
    await useFinanceStore.getState().hydrate(NOW);
    expect((await useFinanceStore.getState().getMonthTransactions('2026-10')).map(t => t.id)).toEqual(['recent']);
    expect((await useFinanceStore.getState().getMonthTransactions('2025-03')).map(t => t.id)).toEqual(['old']);
  });
});

describe('Thème', () => {
  test('mode persistant et résolution clair/sombre', async () => {
    const { resolveTheme, darkTheme, theme } = require('../src/presentation/theme/theme');
    const repos = createInMemoryRepositories();
    configureFinanceStore(async () => repos);
    await useFinanceStore.getState().hydrate(NOW);
    expect(useFinanceStore.getState().themeMode).toBe('system');
    await useFinanceStore.getState().setThemeMode('dark');
    await useFinanceStore.getState().hydrate(NOW);
    expect(useFinanceStore.getState().themeMode).toBe('dark');
    expect(resolveTheme('system', 'dark')).toBe(darkTheme);
    expect(resolveTheme('system', null)).toBe(theme);
    expect(resolveTheme('light', 'dark')).toBe(theme);
    expect(resolveTheme('dark', 'light')).toBe(darkTheme);
  });
});
