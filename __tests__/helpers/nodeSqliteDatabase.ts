import type { SqlDatabase, SqlRow, SqlValue } from '../../src/data/database/SqlDatabase';

/** Adaptateur node:sqlite (Node ≥ 22) pour tester le vrai SQL des dépôts sans appareil. */
export const createNodeSqliteDatabase = (): SqlDatabase => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  return {
    execute: async (sql: string, params: ReadonlyArray<SqlValue> = []): Promise<SqlRow[]> => {
      const stmt = db.prepare(sql);
      if (/^\s*(SELECT|PRAGMA\s+\w+\s*$)/i.test(sql)) {
        return stmt.all(...params) as SqlRow[];
      }
      stmt.run(...params);
      return [];
    },
    close: () => db.close(),
  };
};
