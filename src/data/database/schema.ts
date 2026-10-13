import type { SqlDatabase } from './SqlDatabase';

/**
 * Migrations versionnées via PRAGMA user_version. Ne JAMAIS modifier une
 * migration publiée : ajouter une nouvelle entrée à la fin du tableau.
 */
export const MIGRATIONS: ReadonlyArray<ReadonlyArray<string>> = [
  // v1 — schéma initial
  [
    `CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('MOMO','BANK','CASH')),
      current_balance REAL NOT NULL DEFAULT 0,
      updated_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      fee REAL NOT NULL DEFAULT 0,
      tax REAL NOT NULL DEFAULT 0,
      counterparty_name TEXT,
      counterparty_phone TEXT,
      category TEXT NOT NULL,
      note TEXT,
      balance_after REAL,
      reference TEXT,
      raw_sms TEXT,
      sms_fingerprint TEXT,
      parent_id TEXT,
      source TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_tx_occurred ON transactions (occurred_at)',
    'CREATE INDEX IF NOT EXISTS idx_tx_ref ON transactions (provider, reference)',
    'CREATE INDEX IF NOT EXISTS idx_tx_fp ON transactions (sms_fingerprint)',
    `CREATE TABLE IF NOT EXISTS debts (
      id TEXT PRIMARY KEY NOT NULL,
      contact_name TEXT NOT NULL,
      phone TEXT,
      amount REAL NOT NULL,
      amount_repaid REAL NOT NULL DEFAULT 0,
      direction TEXT NOT NULL CHECK (direction IN ('OWED_BY_ME','OWED_TO_ME')),
      is_settled INTEGER NOT NULL DEFAULT 0,
      due_date TEXT,
      note TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS planned_items (
      id TEXT PRIMARY KEY NOT NULL,
      month TEXT NOT NULL,
      label TEXT NOT NULL,
      amount REAL NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('EXPENSE','INCOME')),
      category TEXT NOT NULL,
      keywords TEXT NOT NULL DEFAULT '[]',
      is_done INTEGER NOT NULL DEFAULT 0,
      matched_transaction_id TEXT,
      recurring INTEGER NOT NULL DEFAULT 0
    )`,
    'CREATE INDEX IF NOT EXISTS idx_planned_month ON planned_items (month)',
    `CREATE TABLE IF NOT EXISTS tontines (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      contribution_amount REAL NOT NULL,
      frequency TEXT NOT NULL,
      members_count INTEGER NOT NULL,
      my_turn INTEGER NOT NULL,
      start_date TEXT NOT NULL,
      paid_contributions TEXT NOT NULL DEFAULT '[]'
    )`,
    `CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    )`,
  ],
  // v2 — objectifs d'épargne
  [
    `CREATE TABLE IF NOT EXISTS savings_goals (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      emoji TEXT NOT NULL,
      target_amount REAL NOT NULL,
      deadline TEXT,
      contributions TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    )`,
  ],
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export const runMigrations = async (db: SqlDatabase): Promise<number> => {
  const [row] = await db.execute('PRAGMA user_version');
  const current = Number(row?.user_version ?? 0);
  for (let v = current; v < MIGRATIONS.length; v++) {
    await db.execute('BEGIN');
    try {
      for (const sql of MIGRATIONS[v]) {
        await db.execute(sql);
      }
      await db.execute(`PRAGMA user_version = ${v + 1}`);
      await db.execute('COMMIT');
    } catch (e) {
      await db.execute('ROLLBACK');
      throw e;
    }
  }
  return MIGRATIONS.length;
};
