/* eslint-disable no-void -- raccourcis « async () => void effet » dans un faux dépôt de test */
import { DEFAULT_BUDGET_CONFIG, type BudgetConfig } from '../../src/domain/models/Budget';
import type { Account } from '../../src/domain/models/Account';
import type { Debt } from '../../src/domain/models/Debt';
import type { PlannedItem } from '../../src/domain/models/PlannedItem';
import type { SavingsGoal } from '../../src/domain/models/SavingsGoal';
import type { Tontine } from '../../src/domain/models/Tontine';
import type { Transaction } from '../../src/domain/models/Transaction';
import type { Repositories } from '../../src/domain/repositories';

export const createInMemoryRepositories = (): Repositories & {
  store: {
    transactions: Transaction[];
    accounts: Account[];
    debts: Debt[];
    planned: PlannedItem[];
    tontines: Tontine[];
    goals: SavingsGoal[];
    kv: Record<string, unknown>;
  };
} => {
  const store = {
    transactions: [] as Transaction[],
    accounts: [] as Account[],
    debts: [] as Debt[],
    planned: [] as PlannedItem[],
    tontines: [] as Tontine[],
    goals: [] as SavingsGoal[],
    kv: {} as Record<string, unknown>,
  };
  const upsert = <T extends { id: string }>(arr: T[], item: T) => {
    const i = arr.findIndex(x => x.id === item.id);
    if (i >= 0) {
      arr[i] = item;
    } else {
      arr.push(item);
    }
  };
  return {
    store,
    transactions: {
      insertMany: async txs => txs.forEach(t => upsert(store.transactions, t)),
      existsByReference: async (p, r) => store.transactions.some(t => t.provider === p && t.reference === r),
      existsBySmsFingerprint: async fp => store.transactions.some(t => t.smsFingerprint === fp),
      listBetween: async (a, b) => store.transactions.filter(t => t.occurredAt >= a && t.occurredAt < b),
      listRecent: async n =>
        [...store.transactions].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, n),
      listAll: async () => [...store.transactions],
      update: async (id, patch) => {
        const t = store.transactions.find(x => x.id === id);
        if (t) {
          Object.assign(t, patch);
        }
      },
      delete: async id => void (store.transactions = store.transactions.filter(t => t.id !== id)),
    },
    accounts: {
      getAll: async () => store.accounts.map(a => ({ ...a })),
      saveMany: async accs => accs.forEach(a => upsert(store.accounts, { ...a })),
    },
    debts: {
      getAll: async () => [...store.debts],
      save: async d => upsert(store.debts, d),
      delete: async id => void (store.debts = store.debts.filter(d => d.id !== id)),
    },
    plannedItems: {
      listByMonth: async m => store.planned.filter(p => p.month === m),
      saveMany: async items => items.forEach(i => upsert(store.planned, i)),
      delete: async id => void (store.planned = store.planned.filter(p => p.id !== id)),
    },
    tontines: {
      getAll: async () => [...store.tontines],
      save: async t => upsert(store.tontines, t),
      delete: async id => void (store.tontines = store.tontines.filter(t => t.id !== id)),
    },
    savingsGoals: {
      getAll: async () => [...store.goals],
      save: async g => upsert(store.goals, g),
      delete: async id => void (store.goals = store.goals.filter(g => g.id !== id)),
    },
    settings: {
      getBudgetConfig: async () => (store.kv.budget as BudgetConfig) ?? DEFAULT_BUDGET_CONFIG,
      saveBudgetConfig: async c => void (store.kv.budget = c),
      getJson: async <T>(k: string, f: T) => (k in store.kv ? (store.kv[k] as T) : f),
      setJson: async (k, v) => void (store.kv[k] = v),
    },
    runInTransaction: async fn => fn(),
  };
};

let seq = 0;
export const tx = (over: Partial<Transaction>): Transaction => ({
  id: `t${++seq}`,
  accountId: 'moov-money',
  provider: 'MOOV',
  type: 'EXPENSE',
  amount: 1000,
  fee: 0,
  tax: 0,
  category: 'Autre',
  source: 'MANUAL',
  occurredAt: '2026-10-13T10:00:00',
  createdAt: '2026-10-13T10:00:00',
  ...over,
});
