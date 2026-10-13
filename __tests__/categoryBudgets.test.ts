import { CATEGORIES } from '../src/core/categories';
import { categoryEnvelopes, envelopeThresholdCrossed } from '../src/domain/usecases/CategoryBudgets';
import { tx } from './helpers/inMemoryRepositories';

const config = { categoryLimits: { [CATEGORIES.FOOD]: 10000, [CATEGORIES.FUEL]: 20000, Vide: 0 } };

test('enveloppes triées par tension, statuts', () => {
  const txs = [
    tx({ amount: 9000, category: CATEGORIES.FOOD }),
    tx({ amount: 5000, category: CATEGORIES.FUEL }),
    tx({ type: 'INCOME', amount: 99999, category: CATEGORIES.FUEL }),
  ];
  const env = categoryEnvelopes(config, txs);
  expect(env.map(e => [e.category, e.spent, e.status])).toEqual([
    [CATEGORIES.FOOD, 9000, 'WARNING'],
    [CATEGORIES.FUEL, 5000, 'OK'],
  ]);
  expect(categoryEnvelopes(config, [tx({ amount: 12000, category: CATEGORIES.FOOD })])[0]).toMatchObject({
    status: 'EXCEEDED',
    remaining: -2000,
  });
});

test('franchissement de seuil : une seule alerte par seuil', () => {
  const a = tx({ amount: 5000, category: CATEGORIES.FOOD });
  const b = tx({ amount: 3500, category: CATEGORIES.FOOD });
  const c = tx({ amount: 1000, category: CATEGORIES.FOOD });
  const d = tx({ amount: 2000, category: CATEGORIES.FOOD });
  expect(envelopeThresholdCrossed(config, [a], a)).toBeUndefined();
  expect(envelopeThresholdCrossed(config, [a, b], b)?.threshold).toBe(0.8);
  expect(envelopeThresholdCrossed(config, [a, b, c], c)).toBeUndefined();
  expect(envelopeThresholdCrossed(config, [a, b, c, d], d)?.threshold).toBe(1);
  expect(envelopeThresholdCrossed(config, [tx({ category: 'Autre' })], tx({ category: 'Autre' }))).toBeUndefined();
  expect(envelopeThresholdCrossed(config, [], tx({ type: 'INCOME', category: CATEGORIES.FOOD }))).toBeUndefined();
});
