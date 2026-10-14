import RNFS from 'react-native-fs';
import type { FamilyMember } from '../../domain/models/FamilyMember';
import type { FamilyRequest } from '../../domain/models/FamilyRequest';
import { FAMILY_MEMBERS_KEY, mergeFamilyMembers } from '../../domain/usecases/FamilyMembers';
import type { Repositories } from '../../domain/repositories';
import { FAMILY_REQUESTS_KEY, SOLIDARITY_BUDGET_KEY } from '../../domain/usecases/FamilySolidarity';
import { parseJsonBackup, type BackupSnapshot } from '../exportBuilders';

export interface BackupFile {
  path: string;
  name: string;
  modifiedAt?: Date;
  size: number;
}

/** Sauvegardes LigdiBe présentes dans Téléchargements / dossier de l'app (plus récentes d'abord). */
export const listBackupFiles = async (): Promise<BackupFile[]> => {
  const dirs = [RNFS.DownloadDirectoryPath, RNFS.ExternalDirectoryPath, RNFS.DocumentDirectoryPath].filter(Boolean);
  const files: BackupFile[] = [];
  for (const dir of dirs) {
    try {
      const entries = await RNFS.readDir(dir);
      for (const e of entries) {
        if (e.isFile() && /^LigdiBe_sauvegarde_.*\.json$/.test(e.name)) {
          files.push({ path: e.path, name: e.name, modifiedAt: e.mtime, size: Number(e.size) });
        }
      }
    } catch {
      // Dossier inaccessible : on passe au suivant.
    }
  }
  return files.sort((a, b) => b.name.localeCompare(a.name));
};

export interface RestoreReport {
  transactions: number;
  debts: number;
  plannedItems: number;
}

/**
 * Restaure une sauvegarde par FUSION (les éléments de même identifiant sont
 * remplacés, rien n'est supprimé), le tout dans une transaction atomique.
 */
export const restoreBackup = async (repos: Repositories, snapshot: BackupSnapshot): Promise<RestoreReport> => {
  await repos.runInTransaction(async () => {
    await repos.accounts.saveMany(snapshot.accounts);
    await repos.transactions.insertMany(snapshot.transactions);
    for (const d of snapshot.debts) {
      await repos.debts.save(d);
    }
    await repos.plannedItems.saveMany(snapshot.plannedItems);
    for (const t of snapshot.tontines ?? []) {
      await repos.tontines.save(t);
    }
    for (const g of snapshot.savingsGoals ?? []) {
      await repos.savingsGoals.save(g);
    }
    if (snapshot.budgetConfig) {
      await repos.settings.saveBudgetConfig(snapshot.budgetConfig);
    }
    if (snapshot.familyRequests?.length) {
      const current = await repos.settings.getJson<FamilyRequest[]>(FAMILY_REQUESTS_KEY, []);
      const restored = snapshot.familyRequests;
      await repos.settings.setJson(FAMILY_REQUESTS_KEY, [
        ...restored,
        ...current.filter(c => !restored.some(f => f.id === c.id)),
      ]);
    }
    if (snapshot.familyMembers?.length) {
      const current = await repos.settings.getJson<FamilyMember[]>(FAMILY_MEMBERS_KEY, []);
      await repos.settings.setJson(FAMILY_MEMBERS_KEY, mergeFamilyMembers(current, snapshot.familyMembers));
    }
    if (typeof snapshot.solidarityBudget === 'number') {
      await repos.settings.setJson(SOLIDARITY_BUDGET_KEY, snapshot.solidarityBudget);
    }
  });
  return {
    transactions: snapshot.transactions.length,
    debts: snapshot.debts.length,
    plannedItems: snapshot.plannedItems.length,
  };
};

export const restoreBackupFile = async (repos: Repositories, path: string): Promise<RestoreReport> =>
  restoreBackup(repos, parseJsonBackup(await RNFS.readFile(path, 'utf8')));
