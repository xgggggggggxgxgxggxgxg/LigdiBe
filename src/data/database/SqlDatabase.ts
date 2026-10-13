export type SqlValue = string | number | null;
export type SqlRow = Record<string, SqlValue>;

/** Abstraction minimale du moteur SQL (op-sqlite en production, node:sqlite en test). */
export interface SqlDatabase {
  execute(sql: string, params?: ReadonlyArray<SqlValue>): Promise<SqlRow[]>;
  close?(): void;
}

/**
 * Ajoute une transaction atomique (BEGIN / COMMIT / ROLLBACK) sérialisée par un
 * verrou : deux écritures concurrentes (tâche Headless SMS + interface) ne
 * s'entremêlent pas.
 */
export const withTransactions = (db: SqlDatabase) => {
  let queue: Promise<unknown> = Promise.resolve();
  const runInTransaction = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = async (): Promise<T> => {
      await db.execute('BEGIN IMMEDIATE');
      try {
        const result = await fn();
        await db.execute('COMMIT');
        return result;
      } catch (e) {
        await db.execute('ROLLBACK');
        throw e;
      }
    };
    const next = queue.then(run, run);
    queue = next.catch(() => undefined);
    return next;
  };
  return { runInTransaction };
};
