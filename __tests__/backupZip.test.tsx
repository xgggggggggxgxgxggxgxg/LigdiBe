import '@testing-library/react-native/extend-expect';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { strToU8, unzipSync, zipSync, strFromU8 } from 'fflate';
import React from 'react';
import { NativeModules, Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { PaperProvider } from 'react-native-paper';
import { DEFAULT_BUDGET_CONFIG } from '../src/domain/models/Budget';
import { backupLabel, BackupScreen } from '../src/presentation/screens/BackupScreen';
import { configureFinanceStore, useFinanceStore } from '../src/presentation/store/useFinanceStore';
import { theme } from '../src/presentation/theme/theme';
import {
  base64ToBytes,
  BACKUP_CSV_NAME,
  BACKUP_JSON_NAME,
  buildBackupZip,
  bytesToBase64,
  isZip,
  MANIFEST_NAME,
  readBackupBytes,
} from '../src/services/archive/BackupArchive';
import { restoreBackupBase64 } from '../src/services/export/BackupService';
import { exportZipBackup } from '../src/services/export/ExportService';
import { buildJsonBackup, transactionsToCsv } from '../src/services/exportBuilders';
import { mimeTypeFor, pickBackupFile, shareFile } from '../src/services/files/FilesBridge';
import { createInMemoryRepositories, tx } from './helpers/inMemoryRepositories';

jest.mock('../src/data/repositories', () => ({ getRepositories: jest.fn() }));

const setOS = (os: 'android' | 'ios') => Object.defineProperty(Platform, 'OS', { get: () => os, configurable: true });
const NOW = new Date(2026, 9, 13, 21, 30);
const TXS = [tx({ id: 'a', amount: 6000, counterpartyName: 'INTOUCH' }), tx({ id: 'b', type: 'INCOME', amount: 7070 })];
const snapshotJson = buildJsonBackup({
  exportedAt: '2026-10-13T21:30:00',
  accounts: [{ id: 'moov-money', name: 'Moov', provider: 'MOOV', type: 'MOMO', currentBalance: 9891 }],
  transactions: TXS,
  debts: [],
  plannedItems: [],
  budgetConfig: { ...DEFAULT_BUDGET_CONFIG, monthlyBudget: 99000 },
  familyMembers: [{ id: 'm', name: 'Maman', phone: '70112233' }],
});

describe('BackupArchive', () => {
  test('base64 aller-retour, toutes longueurs, identique à Buffer', () => {
    for (let n = 0; n < 9; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 97 + 13) % 256);
      const b64 = bytesToBase64(bytes);
      expect(b64).toBe(Buffer.from(bytes).toString('base64'));
      expect(Array.from(base64ToBytes(b64))).toEqual(Array.from(bytes));
    }
    expect(Array.from(base64ToBytes('QUJD\nRA=='))).toEqual([65, 66, 67, 68]);
  });

  test('ZIP : sauvegarde + CSV + notice + manifeste, relu à l’identique', () => {
    const zip = buildBackupZip(snapshotJson, transactionsToCsv(TXS));
    expect(isZip(zip)).toBe(true);
    const files = unzipSync(zip);
    expect(Object.keys(files).sort()).toEqual(
      [BACKUP_CSV_NAME, 'LISEZMOI.txt', MANIFEST_NAME, BACKUP_JSON_NAME].sort(),
    );
    expect(JSON.parse(strFromU8(files[MANIFEST_NAME]))).toMatchObject({ app: 'LigdiBe', transactions: 2, debts: 0 });
    expect(strFromU8(files[BACKUP_CSV_NAME])).toMatch(/INTOUCH/);
    const back = readBackupBytes(zip);
    expect(back.transactions).toHaveLength(2);
    expect(back.familyMembers?.[0].name).toBe('Maman');
  });

  test('JSON brut accepté ; ZIP étranger, corrompu ou trop gros refusé', () => {
    expect(readBackupBytes(strToU8(snapshotJson)).accounts[0].currentBalance).toBe(9891);
    expect(() => readBackupBytes(zipSync({ 'photo.jpg': strToU8('x') }))).toThrow(/ne contient pas de sauvegarde.json/);
    const nested = zipSync({ 'LigdiBe/sauvegarde.json': strToU8(snapshotJson) });
    expect(readBackupBytes(nested).transactions).toHaveLength(2);
    const broken = buildBackupZip(snapshotJson, '').slice(0, 40);
    expect(() => readBackupBytes(broken)).toThrow(/illisible ou endommagée/);
    const bomb = zipSync({ [BACKUP_JSON_NAME]: new Uint8Array(65 * 1024 * 1024) }, { level: 1 });
    expect(() => readBackupBytes(bomb)).toThrow(/trop volumineuse/);
    expect(() => readBackupBytes(strToU8('pas du json'))).toThrow(/illisible/);
  });

  test('export ZIP écrit en base64 et se restaure sur un autre téléphone', async () => {
    const source = createInMemoryRepositories();
    await source.transactions.insertMany(TXS);
    await source.settings.saveBudgetConfig({ ...DEFAULT_BUDGET_CONFIG, monthlyBudget: 77000 });
    const res = await exportZipBackup(source, '2026-10', NOW);
    expect(res).toEqual({ path: '/storage/emulated/0/Download/LigdiBe_sauvegarde_20261013-213000.zip', count: 2 });
    const [, content, encoding] = (RNFS.writeFile as jest.Mock).mock.calls.at(-1);
    expect(encoding).toBe('base64');
    const target = createInMemoryRepositories();
    expect(await restoreBackupBase64(target, content)).toEqual({ transactions: 2, debts: 0, plannedItems: 0 });
    expect((await target.settings.getBudgetConfig()).monthlyBudget).toBe(77000);
  });

  test('pont fichiers : type MIME, indisponible hors Android', async () => {
    expect(mimeTypeFor('/a/b.zip')).toBe('application/zip');
    expect(mimeTypeFor('/a/b.json')).toBe('application/json');
    expect(mimeTypeFor('/a/b.csv')).toBe('text/csv');
    expect(await shareFile('/a/b.zip')).toBe(false);
    expect(await pickBackupFile()).toBeNull();
    expect(backupLabel('LigdiBe_sauvegarde_20261013-213000.zip')).toBe('13/10/2026 à 21:30');
    expect(backupLabel('autre.zip')).toBe('autre.zip');
  });
});

describe('Écran Sauvegarde & transfert', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    act(() => jest.runOnlyPendingTimers());
    jest.useRealTimers();
    setOS('ios');
    delete NativeModules.LigdiBeFiles;
  });

  test('export ZIP, partage, import depuis un fichier choisi avec aperçu', async () => {
    setOS('android');
    const zipB64 = bytesToBase64(buildBackupZip(snapshotJson, ''));
    const files = {
      shareFile: jest.fn(async () => true),
      pickFile: jest.fn(async () => ({ name: 'LigdiBe_sauvegarde_20261013-213000.zip', size: 10, base64: zipB64 })),
    };
    NativeModules.LigdiBeFiles = files;
    const repos = createInMemoryRepositories();
    configureFinanceStore(async () => repos);
    require('../src/data/repositories').getRepositories.mockResolvedValue(repos);
    await useFinanceStore.getState().hydrate(new Date());
    const goBack = jest.fn();

    render(
      <PaperProvider theme={theme}>
        <BackupScreen navigation={{ goBack }} />
      </PaperProvider>,
    );
    expect(await screen.findByText(/Aucune sauvegarde trouvée/)).toBeTruthy();

    fireEvent.press(screen.getByTestId('export-zip'));
    expect(await screen.findByTestId('last-export')).toHaveTextContent(/ZIP prêt ✅/);
    fireEvent.press(screen.getByTestId('share-export'));
    await waitFor(() =>
      expect(files.shareFile).toHaveBeenCalledWith(
        expect.stringMatching(/LigdiBe_sauvegarde_.*\.zip$/),
        'application/zip',
        'Envoyer ma sauvegarde LigdiBe',
      ),
    );

    fireEvent.press(screen.getByTestId('pick-backup'));
    expect(await screen.findByTestId('restore-preview')).toHaveTextContent(
      /Exportée le 13\/10\/2026 · 2 opérations · 0 dettes/,
    );
    fireEvent.press(screen.getByTestId('confirm-restore'));
    expect(await screen.findByTestId('backup-message')).toHaveTextContent(/Restauration réussie : 2 opérations/);
    expect(useFinanceStore.getState().familyMembers.map(m => m.name)).toEqual(['Maman']);
    expect((await repos.transactions.listAll()).map(t => t.id).sort()).toEqual(['a', 'b']);
    fireEvent.press(screen.getByTestId('backup-back'));
    expect(goBack).toHaveBeenCalled();
  });

  test('fichiers trouvés dans Téléchargements, fichier invalide signalé', async () => {
    (RNFS.readDir as jest.Mock).mockImplementation(async (dir: string) =>
      dir === RNFS.DownloadDirectoryPath
        ? [
            { name: 'LigdiBe_sauvegarde_20261001-080000.json', path: '/dl/a.json', size: 2048, isFile: () => true },
            { name: 'LigdiBe_sauvegarde_20261002-080000.zip', path: '/dl/b.zip', size: 4096, isFile: () => true },
            { name: 'photo.jpg', path: '/dl/p.jpg', size: 1, isFile: () => true },
          ]
        : [],
    );
    (RNFS.readFile as jest.Mock).mockResolvedValueOnce(bytesToBase64(strToU8('{"app":"Autre"}')));
    const repos = createInMemoryRepositories();
    configureFinanceStore(async () => repos);
    require('../src/data/repositories').getRepositories.mockResolvedValue(repos);
    await useFinanceStore.getState().hydrate(new Date());
    render(
      <PaperProvider theme={theme}>
        <BackupScreen />
      </PaperProvider>,
    );
    expect(await screen.findByTestId('backup-file-LigdiBe_sauvegarde_20261002-080000.zip')).toHaveTextContent(
      /02\/10\/2026 à 08:00.*Archive ZIP · 4 Ko/,
    );
    expect(screen.queryByTestId('backup-file-photo.jpg')).toBeNull();
    expect(screen.getByTestId('pick-backup')).toBeDisabled();
    fireEvent.press(screen.getByTestId('backup-file-LigdiBe_sauvegarde_20261001-080000.json'));
    expect(await screen.findByTestId('backup-message')).toHaveTextContent(/n’est pas une sauvegarde LigdiBe/);
    (RNFS.readDir as jest.Mock).mockImplementation(async () => []);
  });
});

describe('Accès à la sauvegarde', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    act(() => jest.runOnlyPendingTimers());
    jest.useRealTimers();
  });

  test('depuis les Stats et les Réglages', async () => {
    const { StatsScreen } = require('../src/presentation/screens/StatsScreen');
    const { SettingsScreen } = require('../src/presentation/screens/SettingsScreen');
    const repos = createInMemoryRepositories();
    configureFinanceStore(async () => repos);
    require('../src/data/repositories').getRepositories.mockResolvedValue(repos);
    await useFinanceStore.getState().hydrate(new Date());
    const navigate = jest.fn();
    render(
      <PaperProvider theme={theme}>
        <StatsScreen navigation={{ navigate }} />
      </PaperProvider>,
    );
    fireEvent.press(await screen.findByTestId('open-backup'));
    expect(navigate).toHaveBeenLastCalledWith('Backup');
    screen.unmount();
    render(
      <PaperProvider theme={theme}>
        <SettingsScreen navigation={{ navigate }} />
      </PaperProvider>,
    );
    fireEvent.press(await screen.findByTestId('open-backup-settings'));
    expect(navigate).toHaveBeenCalledTimes(2);
  });
});
