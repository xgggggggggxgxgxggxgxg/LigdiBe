import { CATEGORIES } from '../src/core/categories';
import type { PlannedItem } from '../src/domain/models/PlannedItem';
import { detectRecurring } from '../src/domain/usecases/RecurringDetection';
import { tx } from './helpers/inMemoryRepositories';

const canal = (month: string, amount = 10000) =>
  tx({
    amount,
    counterpartyName: 'CANAL+ BURKINA',
    category: CATEGORIES.BILLS,
    occurredAt: `2026-${month}-05T10:00:00`,
  });

test('détecte abonnements et salaire récurrents, ignore le ponctuel et les écarts', () => {
  const txs = [
    canal('08'),
    canal('09'),
    canal('10', 10500),
    tx({ type: 'INCOME', amount: 250000, counterpartyName: 'SOGEA', occurredAt: '2026-09-28T10:00:00' }),
    tx({ type: 'INCOME', amount: 250000, counterpartyName: 'SOGEA', occurredAt: '2026-10-28T10:00:00' }),
    tx({ amount: 30000, counterpartyName: 'MARIAGE ALI', occurredAt: '2026-09-10T10:00:00' }),
    tx({ amount: 5000, counterpartyPhone: '70000001', occurredAt: '2026-09-10T10:00:00' }),
    tx({ amount: 90000, counterpartyPhone: '70000001', occurredAt: '2026-10-10T10:00:00' }),
    tx({ type: 'FEE', amount: 50, counterpartyName: 'CANAL+ BURKINA', occurredAt: '2026-10-05T10:00:00' }),
    tx({ amount: 100 }),
  ];
  const s = detectRecurring(txs);
  expect(s.map(x => [x.label, x.kind, x.amount, x.monthsSeen])).toEqual([
    ['CANAL+ BURKINA', 'EXPENSE', 10000, 3],
    ['SOGEA', 'INCOME', 250000, 2],
  ]);
  expect(s[0]).toMatchObject({ category: CATEGORIES.BILLS, keywords: ['CANAL+ BURKINA'] });
});

test('ne re-suggère pas ce qui est déjà au prévisionnel ; seuil de mois paramétrable', () => {
  const existing: PlannedItem[] = [
    {
      id: 'p',
      month: '2026-10',
      label: 'Abonnement TV',
      amount: 10000,
      kind: 'EXPENSE',
      category: CATEGORIES.BILLS,
      keywords: ['canal+ burkina'],
      isDone: false,
      recurring: true,
    },
  ];
  expect(detectRecurring([canal('09'), canal('10')], existing)).toEqual([]);
  expect(detectRecurring([canal('10')], [], 1)).toHaveLength(1);
  expect(
    detectRecurring([canal('09', 10000), canal('10', 10000), canal('10', 12000), canal('08', 11000)])[0].amount,
  ).toBe(10500);
});
