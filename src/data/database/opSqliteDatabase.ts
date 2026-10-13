import { open } from '@op-engineering/op-sqlite';
import { getOrCreateDatabaseKey } from './encryptionKey';
import { runMigrations } from './schema';
import type { SqlDatabase, SqlRow, SqlValue } from './SqlDatabase';

const DB_NAME = 'ligdibe.sqlite';

let instance: Promise<SqlDatabase> | undefined;

/**
 * Ouvre (une seule fois par contexte JS) la base SQLCipher chiffrée en AES-256.
 * Le contexte Headless (SMS reçu app fermée) et l'UI partagent le même fichier ;
 * le mode WAL autorise lectures et écritures concurrentes.
 */
export const getDatabase = (): Promise<SqlDatabase> => {
  if (!instance) {
    instance = (async () => {
      const encryptionKey = await getOrCreateDatabaseKey();
      const raw = open({ name: DB_NAME, encryptionKey });
      const db: SqlDatabase = {
        execute: async (sql: string, params?: ReadonlyArray<SqlValue>): Promise<SqlRow[]> => {
          const res = await raw.executeAsync(sql, params ? [...params] : undefined);
          return (res.rows?._array ?? []) as SqlRow[];
        },
        close: () => raw.close(),
      };
      await db.execute('PRAGMA journal_mode = WAL');
      await db.execute('PRAGMA busy_timeout = 5000');
      await runMigrations(db);
      return db;
    })().catch(e => {
      instance = undefined;
      throw e;
    });
  }
  return instance;
};
