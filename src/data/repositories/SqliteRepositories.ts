import { DEFAULT_BUDGET_CONFIG, type BudgetConfig } from '../../domain/models/Budget';
import type { Account } from '../../domain/models/Account';
import type { Debt } from '../../domain/models/Debt';
import type { PlannedItem } from '../../domain/models/PlannedItem';
import type { Tontine } from '../../domain/models/Tontine';
import type { Transaction } from '../../domain/models/Transaction';
import type {
  AccountRepository,
  DebtRepository,
  PlannedItemRepository,
  Repositories,
  SettingsRepository,
  TontineRepository,
  TransactionRepository,
} from '../../domain/repositories';
import { withTransactions, type SqlDatabase, type SqlRow, type SqlValue } from '../database/SqlDatabase';

const opt = <T>(v: SqlValue | undefined): T | undefined => (v === null || v === undefined ? undefined : (v as T));
const nul = (v: unknown): SqlValue => (v === undefined || v === null ? null : (v as SqlValue));

// ---------------------------------------------------------------- Transactions
const TX_COLUMNS = [
  ['id', 'id'],
  ['accountId', 'account_id'],
  ['provider', 'provider'],
  ['type', 'type'],
  ['amount', 'amount'],
  ['fee', 'fee'],
  ['tax', 'tax'],
  ['counterpartyName', 'counterparty_name'],
  ['counterpartyPhone', 'counterparty_phone'],
  ['category', 'category'],
  ['note', 'note'],
  ['balanceAfter', 'balance_after'],
  ['reference', 'reference'],
  ['rawSms', 'raw_sms'],
  ['smsFingerprint', 'sms_fingerprint'],
  ['parentId', 'parent_id'],
  ['source', 'source'],
  ['occurredAt', 'occurred_at'],
  ['createdAt', 'created_at'],
] as const satisfies ReadonlyArray<readonly [keyof Transaction, string]>;

const rowToTransaction = (r: SqlRow): Transaction => {
  const out: Record<string, unknown> = {};
  for (const [prop, col] of TX_COLUMNS) {
    const v = opt(r[col]);
    if (v !== undefined) {
      out[prop] = v;
    }
  }
  return out as unknown as Transaction;
};

export class SqliteTransactionRepository implements TransactionRepository {
  constructor(private readonly db: SqlDatabase) {}

  async insertMany(transactions: Transaction[]): Promise<void> {
    const cols = TX_COLUMNS.map(c => c[1]).join(', ');
    const marks = TX_COLUMNS.map(() => '?').join(', ');
    for (const t of transactions) {
      await this.db.execute(
        `INSERT OR REPLACE INTO transactions (${cols}) VALUES (${marks})`,
        TX_COLUMNS.map(([prop]) => nul(t[prop])),
      );
    }
  }

  async existsByReference(provider: string, reference: string): Promise<boolean> {
    const rows = await this.db.execute(
      'SELECT 1 AS found FROM transactions WHERE provider = ? AND reference = ? LIMIT 1',
      [provider, reference],
    );
    return rows.length > 0;
  }

  async existsBySmsFingerprint(fingerprint: string): Promise<boolean> {
    const rows = await this.db.execute('SELECT 1 AS found FROM transactions WHERE sms_fingerprint = ? LIMIT 1', [
      fingerprint,
    ]);
    return rows.length > 0;
  }

  async listBetween(fromIso: string, toIso: string): Promise<Transaction[]> {
    const rows = await this.db.execute(
      'SELECT * FROM transactions WHERE occurred_at >= ? AND occurred_at < ? ORDER BY occurred_at DESC',
      [fromIso, toIso],
    );
    return rows.map(rowToTransaction);
  }

  async listRecent(limit: number): Promise<Transaction[]> {
    const rows = await this.db.execute(
      'SELECT * FROM transactions ORDER BY occurred_at DESC, created_at DESC LIMIT ?',
      [limit],
    );
    return rows.map(rowToTransaction);
  }

  async listAll(): Promise<Transaction[]> {
    return (await this.db.execute('SELECT * FROM transactions ORDER BY occurred_at DESC')).map(rowToTransaction);
  }

  async update(id: string, patch: Partial<Omit<Transaction, 'id'>>): Promise<void> {
    const entries = TX_COLUMNS.filter(([prop]) => prop !== 'id' && prop in patch);
    if (entries.length === 0) {
      return;
    }
    await this.db.execute(`UPDATE transactions SET ${entries.map(([, col]) => `${col} = ?`).join(', ')} WHERE id = ?`, [
      ...entries.map(([prop]) => nul((patch as Record<string, unknown>)[prop])),
      id,
    ]);
  }

  async delete(id: string): Promise<void> {
    await this.db.execute('DELETE FROM transactions WHERE id = ? OR parent_id = ?', [id, id]);
  }
}

// ---------------------------------------------------------------- Comptes
export class SqliteAccountRepository implements AccountRepository {
  constructor(private readonly db: SqlDatabase) {}

  async getAll(): Promise<Account[]> {
    const rows = await this.db.execute('SELECT * FROM accounts ORDER BY rowid');
    return rows.map(r => ({
      id: r.id as string,
      name: r.name as string,
      provider: r.provider as Account['provider'],
      type: r.type as Account['type'],
      currentBalance: Number(r.current_balance),
      updatedAt: opt<string>(r.updated_at),
    }));
  }

  async saveMany(accounts: Account[]): Promise<void> {
    for (const a of accounts) {
      await this.db.execute(
        `INSERT INTO accounts (id, name, provider, type, current_balance, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, provider = excluded.provider, type = excluded.type,
           current_balance = excluded.current_balance, updated_at = excluded.updated_at`,
        [a.id, a.name, a.provider, a.type, a.currentBalance, nul(a.updatedAt)],
      );
    }
  }
}

// ---------------------------------------------------------------- Dettes
export class SqliteDebtRepository implements DebtRepository {
  constructor(private readonly db: SqlDatabase) {}

  async getAll(): Promise<Debt[]> {
    const rows = await this.db.execute(
      'SELECT * FROM debts ORDER BY is_settled, due_date IS NULL, due_date, created_at DESC',
    );
    return rows.map(r => ({
      id: r.id as string,
      contactName: r.contact_name as string,
      phone: opt<string>(r.phone),
      amount: Number(r.amount),
      amountRepaid: Number(r.amount_repaid),
      direction: r.direction as Debt['direction'],
      isSettled: r.is_settled === 1,
      dueDate: opt<string>(r.due_date),
      note: opt<string>(r.note),
      createdAt: r.created_at as string,
    }));
  }

  async save(d: Debt): Promise<void> {
    await this.db.execute(
      `INSERT OR REPLACE INTO debts (id, contact_name, phone, amount, amount_repaid, direction, is_settled, due_date, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        d.id,
        d.contactName,
        nul(d.phone),
        d.amount,
        d.amountRepaid,
        d.direction,
        d.isSettled ? 1 : 0,
        nul(d.dueDate),
        nul(d.note),
        d.createdAt,
      ],
    );
  }

  async delete(id: string): Promise<void> {
    await this.db.execute('DELETE FROM debts WHERE id = ?', [id]);
  }
}

// ---------------------------------------------------------------- Prévisionnel
export class SqlitePlannedItemRepository implements PlannedItemRepository {
  constructor(private readonly db: SqlDatabase) {}

  async listByMonth(month: string): Promise<PlannedItem[]> {
    const rows = await this.db.execute('SELECT * FROM planned_items WHERE month = ? ORDER BY kind DESC, rowid', [
      month,
    ]);
    return rows.map(r => ({
      id: r.id as string,
      month: r.month as string,
      label: r.label as string,
      amount: Number(r.amount),
      kind: r.kind as PlannedItem['kind'],
      category: r.category as string,
      keywords: JSON.parse(r.keywords as string) as string[],
      isDone: r.is_done === 1,
      matchedTransactionId: opt<string>(r.matched_transaction_id),
      recurring: r.recurring === 1,
    }));
  }

  async saveMany(items: PlannedItem[]): Promise<void> {
    for (const i of items) {
      await this.db.execute(
        `INSERT OR REPLACE INTO planned_items (id, month, label, amount, kind, category, keywords, is_done, matched_transaction_id, recurring)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          i.id,
          i.month,
          i.label,
          i.amount,
          i.kind,
          i.category,
          JSON.stringify(i.keywords),
          i.isDone ? 1 : 0,
          nul(i.matchedTransactionId),
          i.recurring ? 1 : 0,
        ],
      );
    }
  }

  async delete(id: string): Promise<void> {
    await this.db.execute('DELETE FROM planned_items WHERE id = ?', [id]);
  }
}

// ---------------------------------------------------------------- Tontines
export class SqliteTontineRepository implements TontineRepository {
  constructor(private readonly db: SqlDatabase) {}

  async getAll(): Promise<Tontine[]> {
    const rows = await this.db.execute('SELECT * FROM tontines ORDER BY rowid');
    return rows.map(r => ({
      id: r.id as string,
      name: r.name as string,
      contributionAmount: Number(r.contribution_amount),
      frequency: r.frequency as Tontine['frequency'],
      membersCount: Number(r.members_count),
      myTurn: Number(r.my_turn),
      startDate: r.start_date as string,
      paidContributions: JSON.parse(r.paid_contributions as string) as string[],
    }));
  }

  async save(t: Tontine): Promise<void> {
    await this.db.execute(
      `INSERT OR REPLACE INTO tontines (id, name, contribution_amount, frequency, members_count, my_turn, start_date, paid_contributions)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        t.id,
        t.name,
        t.contributionAmount,
        t.frequency,
        t.membersCount,
        t.myTurn,
        t.startDate,
        JSON.stringify(t.paidContributions),
      ],
    );
  }

  async delete(id: string): Promise<void> {
    await this.db.execute('DELETE FROM tontines WHERE id = ?', [id]);
  }
}

// ---------------------------------------------------------------- Paramètres
const BUDGET_KEY = 'budgetConfig';

export class SqliteSettingsRepository implements SettingsRepository {
  constructor(private readonly db: SqlDatabase) {}

  async getJson<T>(key: string, fallback: T): Promise<T> {
    const [row] = await this.db.execute('SELECT value FROM settings WHERE key = ?', [key]);
    return row ? (JSON.parse(row.value as string) as T) : fallback;
  }

  async setJson<T>(key: string, value: T): Promise<void> {
    await this.db.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, JSON.stringify(value)]);
  }

  async getBudgetConfig(): Promise<BudgetConfig> {
    // Fusion avec les valeurs par défaut : robustesse quand de nouveaux champs apparaissent.
    return { ...DEFAULT_BUDGET_CONFIG, ...(await this.getJson<Partial<BudgetConfig>>(BUDGET_KEY, {})) };
  }

  async saveBudgetConfig(config: BudgetConfig): Promise<void> {
    await this.setJson(BUDGET_KEY, config);
  }
}

export const createSqliteRepositories = (db: SqlDatabase): Repositories => ({
  transactions: new SqliteTransactionRepository(db),
  accounts: new SqliteAccountRepository(db),
  debts: new SqliteDebtRepository(db),
  plannedItems: new SqlitePlannedItemRepository(db),
  tontines: new SqliteTontineRepository(db),
  settings: new SqliteSettingsRepository(db),
  ...withTransactions(db),
});
