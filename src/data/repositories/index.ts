import type { Repositories } from '../../domain/repositories';
import { getDatabase } from '../database/opSqliteDatabase';
import { createSqliteRepositories } from './SqliteRepositories';

let repos: Promise<Repositories> | undefined;

/** Point d'accès unique aux dépôts chiffrés (UI et tâche Headless). */
export const getRepositories = (): Promise<Repositories> => {
  repos ??= getDatabase().then(createSqliteRepositories);
  return repos;
};
