import type { Account } from '../models/Account';
import type { BudgetConfig } from '../models/Budget';
import type { Debt } from '../models/Debt';
import type { PlannedItem } from '../models/PlannedItem';
import type { SavingsGoal } from '../models/SavingsGoal';
import type { Tontine } from '../models/Tontine';
import type { Transaction } from '../models/Transaction';

/** Ports de persistance (implémentés en SQLite chiffré dans src/data/repositories). */
export interface TransactionRepository {
  insertMany(transactions: Transaction[]): Promise<void>;
  existsByReference(provider: string, reference: string): Promise<boolean>;
  existsBySmsFingerprint(fingerprint: string): Promise<boolean>;
  listBetween(fromIso: string, toIso: string): Promise<Transaction[]>;
  listRecent(limit: number): Promise<Transaction[]>;
  listAll(): Promise<Transaction[]>;
  update(id: string, patch: Partial<Omit<Transaction, 'id'>>): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface AccountRepository {
  getAll(): Promise<Account[]>;
  saveMany(accounts: Account[]): Promise<void>;
}

export interface DebtRepository {
  getAll(): Promise<Debt[]>;
  save(debt: Debt): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface PlannedItemRepository {
  listByMonth(month: string): Promise<PlannedItem[]>;
  saveMany(items: PlannedItem[]): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface TontineRepository {
  getAll(): Promise<Tontine[]>;
  save(tontine: Tontine): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface SavingsGoalRepository {
  getAll(): Promise<SavingsGoal[]>;
  save(goal: SavingsGoal): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface SettingsRepository {
  getBudgetConfig(): Promise<BudgetConfig>;
  saveBudgetConfig(config: BudgetConfig): Promise<void>;
  getJson<T>(key: string, fallback: T): Promise<T>;
  setJson<T>(key: string, value: T): Promise<void>;
}

export interface Repositories {
  transactions: TransactionRepository;
  accounts: AccountRepository;
  debts: DebtRepository;
  plannedItems: PlannedItemRepository;
  tontines: TontineRepository;
  savingsGoals: SavingsGoalRepository;
  settings: SettingsRepository;
  /** Exécute `fn` dans une transaction SQL atomique (BEGIN/COMMIT/ROLLBACK). */
  runInTransaction<T>(fn: () => Promise<T>): Promise<T>;
}
