import { PermissionsAndroid, Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { fileTimestamp, toLocalIso } from '../../core/dates';
import type { Repositories } from '../../domain/repositories';
import { buildJsonBackup, transactionsToCsv } from '../exportBuilders';

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

const writeWithFallback = async (fileName: string, content: string): Promise<string> => {
  await ensureLegacyWritePermission();
  const candidates = [RNFS.DownloadDirectoryPath, RNFS.ExternalDirectoryPath, RNFS.DocumentDirectoryPath].filter(Boolean);
  let lastError: unknown;
  for (const dir of candidates) {
    const path = `${dir}/${fileName}`;
    try {
      await RNFS.writeFile(path, content, 'utf8');
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
  const path = await writeWithFallback(`LigdiBe_transactions_${fileTimestamp(now)}.csv`, transactionsToCsv(transactions));
  return { path, count: transactions.length };
};

/** Sauvegarde complète JSON (comptes, transactions, dettes, prévisionnel du mois). */
export const exportJsonBackup = async (repos: Repositories, month: string, now = new Date()): Promise<ExportResult> => {
  const [accounts, transactions, debts, plannedItems] = await Promise.all([
    repos.accounts.getAll(),
    repos.transactions.listAll(),
    repos.debts.getAll(),
    repos.plannedItems.listByMonth(month),
  ]);
  const json = buildJsonBackup({ exportedAt: toLocalIso(now), accounts, transactions, debts, plannedItems });
  const path = await writeWithFallback(`LigdiBe_sauvegarde_${fileTimestamp(now)}.json`, json);
  return { path, count: transactions.length };
};
