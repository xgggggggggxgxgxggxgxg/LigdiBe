import { PermissionsAndroid, Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { fileTimestamp, nextMonthKey, toLocalIso } from '../../core/dates';
import type { Transaction } from '../../domain/models/Transaction';
import type { Repositories } from '../../domain/repositories';
import { buildBackupZip, bytesToBase64 } from '../archive/BackupArchive';
import { buildJsonBackup, transactionsToCsv } from '../exportBuilders';
import type { FamilyMember } from '../../domain/models/FamilyMember';
import type { FamilyRequest } from '../../domain/models/FamilyRequest';
import { FAMILY_MEMBERS_KEY } from '../../domain/usecases/FamilyMembers';
import { FAMILY_REQUESTS_KEY, SOLIDARITY_BUDGET_KEY } from '../../domain/usecases/FamilySolidarity';

export interface ExportResult {
  path: string;
  count: number;
}

const ensureLegacyWritePermission = async (): Promise<void> => {
  // Android ≤ 9 : permission d'écriture requise pour le dossier Téléchargements.
  if (Platform.OS === 'android' && Number(Platform.Version) < 29) {
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE);
  }
};

const writeWithFallback = async (
  fileName: string,
  content: string,
  encoding: 'utf8' | 'base64' = 'utf8',
): Promise<string> => {
  await ensureLegacyWritePermission();
  const candidates = [RNFS.DownloadDirectoryPath, RNFS.ExternalDirectoryPath, RNFS.DocumentDirectoryPath].filter(
    Boolean,
  );
  let lastError: unknown;
  for (const dir of candidates) {
    const path = `${dir}/${fileName}`;
    try {
      await RNFS.writeFile(path, content, encoding);
      return path;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Écriture impossible');
};

/** Exporte toutes les transactions en CSV horodaté (ex: LigdiBe_transactions_20261013-213000.csv). */
export const exportTransactionsCsv = async (repos: Repositories, now = new Date()): Promise<ExportResult> => {
  const transactions = await repos.transactions.listAll();
  const path = await writeWithFallback(
    `LigdiBe_transactions_${fileTimestamp(now)}.csv`,
    transactionsToCsv(transactions),
  );
  return { path, count: transactions.length };
};

/** Instantané complet (comptes, transactions, dettes, prévisionnel, tontines, objectifs, budget, famille). */
export const collectBackupJson = async (
  repos: Repositories,
  month: string,
  now = new Date(),
): Promise<{ json: string; transactions: Transaction[] }> => {
  const [
    accounts,
    transactions,
    debts,
    current,
    next,
    tontines,
    savingsGoals,
    budgetConfig,
    familyRequests,
    solidarityBudget,
    familyMembers,
  ] = await Promise.all([
    repos.accounts.getAll(),
    repos.transactions.listAll(),
    repos.debts.getAll(),
    repos.plannedItems.listByMonth(month),
    repos.plannedItems.listByMonth(nextMonthKey(month)),
    repos.tontines.getAll(),
    repos.savingsGoals.getAll(),
    repos.settings.getBudgetConfig(),
    repos.settings.getJson<FamilyRequest[]>(FAMILY_REQUESTS_KEY, []),
    repos.settings.getJson<number>(SOLIDARITY_BUDGET_KEY, 0),
    repos.settings.getJson<FamilyMember[]>(FAMILY_MEMBERS_KEY, []),
  ]);
  const json = buildJsonBackup({
    exportedAt: toLocalIso(now),
    accounts,
    transactions,
    debts,
    plannedItems: [...current, ...next],
    tontines,
    savingsGoals,
    budgetConfig,
    familyRequests,
    solidarityBudget,
    familyMembers,
  });
  return { json, transactions };
};

/** Sauvegarde complète JSON. */
export const exportJsonBackup = async (repos: Repositories, month: string, now = new Date()): Promise<ExportResult> => {
  const { json, transactions } = await collectBackupJson(repos, month, now);
  const path = await writeWithFallback(`LigdiBe_sauvegarde_${fileTimestamp(now)}.json`, json);
  return { path, count: transactions.length };
};

/** Archive ZIP (sauvegarde JSON + CSV + notice) : le format recommandé pour changer de téléphone. */
export const exportZipBackup = async (repos: Repositories, month: string, now = new Date()): Promise<ExportResult> => {
  const { json, transactions } = await collectBackupJson(repos, month, now);
  const zip = buildBackupZip(json, transactionsToCsv(transactions));
  const path = await writeWithFallback(`LigdiBe_sauvegarde_${fileTimestamp(now)}.zip`, bytesToBase64(zip), 'base64');
  return { path, count: transactions.length };
};
