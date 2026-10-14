import { CATEGORIES } from '../src/core/categories';
import { previousMonthKey } from '../src/core/dates';
import type { Debt } from '../src/domain/models/Debt';
import type { PlannedItem } from '../src/domain/models/PlannedItem';
import type { Tontine } from '../src/domain/models/Tontine';
import { summarizeAirtime } from '../src/domain/usecases/AirtimeTracker';
import {
  autoMatchPlannedItems,
  carryOverToNextMonth,
  suggestMatches,
  summarizeForecast,
} from '../src/domain/usecases/BudgetForecast';
import {
  applyRepayment,
  buildReminderMessage,
  buildSmsUrl,
  buildWhatsAppUrl,
  debtRemaining,
  findDebtForTransaction,
  summarizeDebts,
  toInternationalPhone,
} from '../src/domain/usecases/ManageDebts';
import {
  buildInsights,
  familySupport,
  compareMonths,
  spendingByCategory,
  topRecipients,
  totalAirtime,
  totalCashWithdrawn,
  totalFees,
} from '../src/domain/usecases/Statistics';
import { tontineStatus } from '../src/domain/usecases/TontineTracker';
import { tx } from './helpers/inMemoryRepositories';

const NOW = new Date(2026, 9, 13, 10);

describe('Agrégateur crédit d’appel & data', () => {
  test('cumuls journalier / mensuel / annuel et alerte plafond', () => {
    const txs = [
      tx({ type: 'AIRTIME_RECHARGE', amount: 200, occurredAt: '2026-10-13T08:00:00' }),
      tx({ type: 'AIRTIME_RECHARGE', amount: 100, occurredAt: '2026-10-13T12:00:00' }),
      tx({ type: 'AIRTIME_RECHARGE', amount: 500, occurredAt: '2026-10-02T12:00:00' }),
      tx({ type: 'AIRTIME_RECHARGE', amount: 1000, occurredAt: '2026-03-02T12:00:00' }),
      tx({ type: 'EXPENSE', amount: 9999, occurredAt: '2026-10-13T12:00:00' }),
    ];
    const s = summarizeAirtime(txs, NOW, 700);
    expect(s).toMatchObject({
      daily_airtime_spent: 300,
      monthly_airtime_spent: 800,
      yearly_airtime_spent: 1800,
      monthlyRechargeCount: 3,
      averageRecharge: 267,
      isOverMonthlyLimit: true,
    });
    expect(s.projectedYearly).toBe(Math.round((800 / 13) * 31 * 12));
    expect(summarizeAirtime([], NOW)).toMatchObject({ averageRecharge: 0, isOverMonthlyLimit: false });
  });
});

const plan = (over: Partial<PlannedItem>): PlannedItem => ({
  id: over.label ?? 'p',
  month: '2026-10',
  label: 'Ligne',
  amount: 10000,
  kind: 'EXPENSE',
  category: CATEGORIES.OTHER,
  keywords: [],
  isDone: false,
  recurring: false,
  ...over,
});

describe('Budget prévisionnel', () => {
  const salary = tx({ id: 'sal', type: 'INCOME', amount: 300000, counterpartyName: 'SOCIETE SOGEA' });
  const canal = tx({ id: 'canal', amount: 10000, counterpartyName: 'CANAL+ BURKINA', category: CATEGORIES.BILLS });
  const loyer = tx({ id: 'loyer', amount: 75000, counterpartyName: 'M. KABORE', note: 'loyer octobre' });
  const resto = tx({ id: 'resto', amount: 4000, counterpartyName: 'MAQUIS LE VERDOYANT' });
  const items = [
    plan({ label: 'Salaire', kind: 'INCOME', amount: 300000, keywords: ['SOGEA'], recurring: true }),
    plan({ label: 'Abonnement Canal+', amount: 10000, keywords: ['canal'], recurring: true }),
    plan({ label: 'Loyer', amount: 75000, keywords: ['kabore'] }),
    plan({ label: 'Cadeau mariage', amount: 20000, keywords: ['mariage'] }),
  ];

  test('synthèse prévu vs réel et pertinence', () => {
    const s = summarizeForecast(items, [salary, canal, loyer, resto]);
    expect(s).toMatchObject({
      plannedIncome: 300000,
      plannedExpense: 105000,
      plannedBalance: 195000,
      actualIncome: 300000,
      actualExpense: 89000,
      isViable: true,
      totalCount: 4,
      doneCount: 0,
      unplannedExpense: 89000,
    });
    expect(s.plannedSavingsRate).toBeCloseTo(0.65);
    expect(summarizeForecast([plan({ amount: 5 })], []).plannedSavingsRate).toBe(0);
  });

  test('coche automatiquement via le nom de la transaction et le montant', () => {
    const matched = autoMatchPlannedItems(items, [salary, canal, loyer, resto]);
    expect(matched.map(m => [m.label, m.matchedTransactionId])).toEqual([
      ['Salaire', 'sal'],
      ['Abonnement Canal+', 'canal'],
      ['Loyer', 'loyer'],
    ]);
    expect(matched.every(m => m.isDone)).toBe(true);
    const after = items.map(i => matched.find(m => m.id === i.id) ?? i);
    expect(summarizeForecast(after, [salary, canal, loyer, resto]).unplannedExpense).toBe(4000);
    expect(autoMatchPlannedItems(after, [salary, canal, loyer, resto])).toEqual([]);
  });

  test('montant trop éloigné : suggestion manuelle mais pas de coche auto', () => {
    const item = plan({ label: 'Canal', amount: 30000, keywords: ['canal'] });
    expect(autoMatchPlannedItems([item], [canal])).toEqual([]);
    const s = suggestMatches(item, [canal, resto]);
    expect(s).toHaveLength(1);
    expect(s[0].transaction.id).toBe('canal');
    expect(suggestMatches(plan({ label: '', amount: 0 }), [canal])).toEqual([]);
  });

  test('report sur le mois suivant', () => {
    const done = items.map((i, k) => (k < 3 ? { ...i, isDone: true } : i));
    let k = 0;
    const next = carryOverToNextMonth(
      done,
      [plan({ label: 'Abonnement CANAL+', month: '2026-11' })],
      p => `${p}${++k}`,
    );
    expect(next.map(i => i.label)).toEqual(['Salaire', 'Cadeau mariage']);
    expect(next.every(i => i.month === '2026-11' && !i.isDone && i.id.startsWith('plan'))).toBe(true);
    expect(carryOverToNextMonth([plan({ month: '2026-12', recurring: true })])[0].month).toBe('2027-01');
  });
});

describe('Statistiques', () => {
  const txs = [
    tx({ amount: 5000, counterpartyName: 'ALI', counterpartyPhone: '70000001', category: CATEGORIES.TRANSFER }),
    tx({ amount: 7000, counterpartyName: 'ALI', counterpartyPhone: '70000001', category: CATEGORIES.TRANSFER }),
    tx({ amount: 9000, counterpartyName: 'AWA', category: CATEGORIES.FOOD }),
    tx({ amount: 500 }),
    tx({ type: 'FEE', amount: 50, category: CATEGORIES.FEES }),
    tx({ type: 'FEE', amount: 25, category: CATEGORIES.FEES }),
    tx({ type: 'AIRTIME_RECHARGE', amount: 200, category: CATEGORIES.AIRTIME }),
    tx({ type: 'CASH_WITHDRAWAL', amount: 20000 }),
    tx({ type: 'INCOME', amount: 50000, counterpartyName: 'BOSS' }),
  ];

  test('top 5 destinataires, frais, crédit, retraits', () => {
    const top = topRecipients(txs);
    expect(top.map(t => [t.name, t.total, t.count])).toEqual([
      ['ALI', 12000, 2],
      ['AWA', 9000, 1],
    ]);
    expect(topRecipients([tx({ counterpartyPhone: '7' })])[0].name).toBe('7');
    expect(totalFees(txs)).toBe(75);
    expect(totalAirtime(txs)).toBe(200);
    expect(totalCashWithdrawn(txs)).toBe(20000);
  });

  test('répartition par catégorie et insights', () => {
    const cats = spendingByCategory(txs);
    expect(cats[0]).toMatchObject({ category: CATEGORIES.TRANSFER, total: 12000 });
    expect(cats.reduce((s, c) => s + c.share, 0)).toBeCloseTo(1);
    expect(spendingByCategory([])).toEqual([]);
    expect(buildInsights(txs).map(i => i.id)).toEqual(['fees', 'airtime', 'top-category']);
    expect(buildInsights([])).toEqual([]);
  });

  test('solidarité familiale : total, proches distincts, part des entrées', () => {
    const family = [
      tx({ amount: 10000, category: CATEGORIES.FAMILY, counterpartyName: 'Maman', counterpartyPhone: '70111111' }),
      tx({ amount: 5000, category: CATEGORIES.FAMILY, counterpartyName: 'MAMAN', counterpartyPhone: '70111111' }),
      tx({ amount: 2500, category: CATEGORIES.FAMILY, counterpartyName: 'Petit frère' }),
    ];
    expect(familySupport([...txs, ...family])).toEqual({ total: 17500, count: 3, people: 2, shareOfIncome: 0.35 });
    expect(familySupport(family).shareOfIncome).toBe(0);
    const insight = buildInsights([...txs, ...family]).find(i => i.id === 'family');
    expect(insight?.message).toBe('🤝🏾 Tu as soutenu 2 proches : 17500 FCFA (35 % de tes entrées).');
    expect(buildInsights(family.slice(0, 1)).find(i => i.id === 'family')?.message).toBe(
      '🤝🏾 Tu as soutenu 1 proche : 10000 FCFA.',
    );
  });
});

const debt = (over: Partial<Debt>): Debt => ({
  id: 'd1',
  contactName: 'Moussa Traoré',
  phone: '70 11 22 33',
  amount: 25000,
  amountRepaid: 0,
  direction: 'OWED_TO_ME',
  isSettled: false,
  createdAt: '2026-10-01T00:00:00',
  ...over,
});

describe('Carnet de dettes', () => {
  test('synthèse, retards et remboursement partiel', () => {
    const debts = [
      debt({ dueDate: '2026-10-10' }),
      debt({ id: 'd2', direction: 'OWED_BY_ME', amount: 10000, amountRepaid: 4000 }),
      debt({ id: 'd3', isSettled: true }),
    ];
    expect(summarizeDebts(debts, NOW)).toEqual({ owedToMe: 25000, owedByMe: 6000, net: 19000, overdueCount: 1 });
    const partial = applyRepayment(debts[0], 10000);
    expect(partial).toMatchObject({ amountRepaid: 10000, isSettled: false });
    expect(debtRemaining(partial)).toBe(15000);
    expect(applyRepayment(partial, 99999)).toMatchObject({ amountRepaid: 25000, isSettled: true });
    expect(applyRepayment(partial, -5).amountRepaid).toBe(10000);
  });

  test('messages de relance courtois', () => {
    const m1 = buildReminderMessage(debt({ dueDate: '2026-10-10' }), 'Fatou');
    expect(m1).toContain('Bonjour Moussa');
    expect(m1).toContain('25 000 FCFA');
    expect(m1).toContain('10/10/2026');
    expect(m1.endsWith('Fatou')).toBe(true);
    const m2 = buildReminderMessage(debt({ direction: 'OWED_BY_ME' }));
    expect(m2).toContain('que je te dois');
  });

  test('liens WhatsApp / SMS et normalisation des numéros', () => {
    expect(toInternationalPhone('70 11 22 33')).toBe('22670112233');
    expect(toInternationalPhone('+225 07 47 07 07 97')).toBe('2250747070797');
    expect(toInternationalPhone('00221771234567')).toBe('221771234567');
    expect(toInternationalPhone('0747070797', '225')).toBe('2250747070797');
    expect(toInternationalPhone('070112233')).toBe('22670112233');
    expect(toInternationalPhone('22670112233')).toBe('22670112233');
    expect(buildWhatsAppUrl('70112233', 'Salut !')).toBe('https://wa.me/22670112233?text=Salut%20!');
    expect(buildSmsUrl('70 11 22 33', 'a b')).toBe('sms:70112233?body=a%20b');
  });

  test('détection automatique d’un remboursement', () => {
    const debts = [debt({}), debt({ id: 'd2', contactName: 'Awa', phone: undefined, direction: 'OWED_BY_ME' })];
    expect(findDebtForTransaction(debts, tx({ type: 'INCOME', counterpartyPhone: '22670112233' }))?.id).toBe('d1');
    expect(findDebtForTransaction(debts, tx({ type: 'EXPENSE', counterpartyName: 'MME AWA OUEDRAOGO' }))?.id).toBe(
      'd2',
    );
    expect(findDebtForTransaction(debts, tx({ type: 'FEE' }))).toBeUndefined();
    expect(findDebtForTransaction(debts, tx({ type: 'INCOME' }))).toBeUndefined();
  });
});

describe('Tontine', () => {
  const t: Tontine = {
    id: 't1',
    name: 'Tontine du bureau',
    contributionAmount: 10000,
    frequency: 'MONTHLY',
    membersCount: 6,
    myTurn: 4,
    startDate: '2026-07-05',
    paidContributions: ['2026-07-05', '2026-08-05'],
  };

  test('statut mensuel : retards, prochaine échéance, mon tour', () => {
    const s = tontineStatus(t, NOW);
    expect(s).toMatchObject({
      potAmount: 60000,
      dueCount: 4,
      paidCount: 2,
      lateCount: 2,
      hasReceivedPot: true,
      roundsUntilMyTurn: 0,
    });
    expect(s.nextContributionDate).toEqual(new Date(2026, 10, 5));
    expect(s.myPickupDate).toEqual(new Date(2026, 9, 5));
  });

  test('hebdomadaire et tontine terminée', () => {
    const w = tontineStatus({ ...t, frequency: 'WEEKLY', startDate: '2026-10-01T08:00:00', myTurn: 6 }, NOW);
    expect(w).toMatchObject({ dueCount: 2, roundsUntilMyTurn: 4, hasReceivedPot: false });
    expect(tontineStatus({ ...t, startDate: '2025-01-01' }, NOW).nextContributionDate).toBeUndefined();
  });
});

describe('Comparaison mensuelle', () => {
  test('baisse, hausse, stable, sans historique', () => {
    expect(previousMonthKey('2026-01')).toBe('2025-12');
    expect(previousMonthKey('2026-10')).toBe('2026-09');
    expect(
      compareMonths(
        [tx({ amount: 880 })],
        [tx({ amount: 1000 }), tx({ type: 'CASH_WITHDRAWAL', amount: 5000 })],
        'septembre',
      ),
    ).toMatchObject({
      change: -0.12,
      message: "🎉 12 % de dépenses en moins qu'en septembre.",
    });
    expect(compareMonths([tx({ amount: 1500 })], [tx({ amount: 1000 })], 'août').message).toMatch(
      /50 % de dépenses en plus/,
    );
    expect(compareMonths([tx({ amount: 1001 })], [tx({ amount: 1000 })], 'août').message).toMatch(/stables/);
    const none = compareMonths([tx({})], [], 'juillet');
    expect(none.previous).toBe(0);
    expect(none.change).toBeUndefined();
  });
});
