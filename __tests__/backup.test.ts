import RNFS from 'react-native-fs';
import { DEFAULT_BUDGET_CONFIG } from '../src/domain/models/Budget';
import { listBackupFiles, restoreBackup, restoreBackupFile } from '../src/services/export/BackupService';
import { exportJsonBackup } from '../src/services/export/ExportService';
import { buildJsonBackup, parseJsonBackup } from '../src/services/exportBuilders';
import { createInMemoryRepositories, tx } from './helpers/inMemoryRepositories';

const NOW = new Date(2026, 9, 13, 10);

describe('parseJsonBackup', () => {
  test.each([
    ['pas du json', /illisible/],
    ['null', /pas une sauvegarde/],
    ['{"app":"Autre","version":1}', /pas une sauvegarde/],
    ['{"app":"LigdiBe","version":3}', /pas une sauvegarde/],
    ['{"app":"LigdiBe","version":2,"accounts":[]}', /incomplète/],
    [
      '{"app":"LigdiBe","version":2,"accounts":[],"transactions":[{"id":1}],"debts":[],"plannedItems":[]}',
      /transactions invalides/,
    ],
  ])('rejette %s', (json, err) => {
    expect(() => parseJsonBackup(json)).toThrow(err);
  });

  test('accepte v1 et v2', () => {
    const v1 = JSON.stringify({
      app: 'LigdiBe',
      version: 1,
      exportedAt: 'x',
      accounts: [],
      transactions: [tx({})],
      debts: [],
      plannedItems: [],
    });
    expect(parseJsonBackup(v1).transactions).toHaveLength(1);
  });
});

describe('Sauvegarde → restauration (aller-retour)', () => {
  test('tout est restauré sur un téléphone vierge, sans doublon si rejoué', async () => {
    const source = createInMemoryRepositories();
    await source.accounts.saveMany([
      { id: 'cash-wallet', name: 'Poche', provider: 'CASH', type: 'CASH', currentBalance: 4200 },
    ]);
    await source.transactions.insertMany([tx({ id: 'a' }), tx({ id: 'b' })]);
    await source.debts.save({
      id: 'd',
      contactName: 'Awa',
      amount: 5000,
      amountRepaid: 0,
      direction: 'OWED_TO_ME',
      isSettled: false,
      createdAt: 'c',
    });
    await source.plannedItems.saveMany([
      {
        id: 'p',
        month: '2026-11',
        label: 'Loyer',
        amount: 1,
        kind: 'EXPENSE',
        category: 'Loyer',
        keywords: [],
        isDone: false,
        recurring: true,
      },
    ]);
    await source.tontines.save({
      id: 't',
      name: 'T',
      contributionAmount: 1,
      frequency: 'MONTHLY',
      membersCount: 2,
      myTurn: 1,
      startDate: '2026-10-01',
      paidContributions: [],
    });
    await source.savingsGoals.save({
      id: 'g',
      name: 'Tabaski',
      emoji: '🐏',
      targetAmount: 1,
      contributions: [],
      createdAt: 'c',
    });
    await source.settings.saveBudgetConfig({ ...DEFAULT_BUDGET_CONFIG, monthlyBudget: 123 });

    await exportJsonBackup(source, '2026-10', NOW);
    const written = (RNFS.writeFile as jest.Mock).mock.calls.at(-1)[1] as string;
    (RNFS.readFile as jest.Mock).mockResolvedValueOnce(written);

    const target = createInMemoryRepositories();
    expect(await restoreBackupFile(target, '/x.json')).toEqual({ transactions: 2, debts: 1, plannedItems: 1 });
    expect(target.store.accounts[0].currentBalance).toBe(4200);
    expect(target.store.tontines).toHaveLength(1);
    expect(target.store.goals).toHaveLength(1);
    expect((await target.settings.getBudgetConfig()).monthlyBudget).toBe(123);

    await restoreBackup(target, parseJsonBackup(written));
    expect(target.store.transactions).toHaveLength(2);
  });

  test('v1 sans tontines ni objectifs', async () => {
    const target = createInMemoryRepositories();
    const v1 = parseJsonBackup(
      buildJsonBackup({ exportedAt: 'x', accounts: [], transactions: [], debts: [], plannedItems: [] }),
    );
    await restoreBackup(target, {
      ...v1,
      version: 1,
      tontines: undefined,
      savingsGoals: undefined,
      budgetConfig: undefined,
    });
    expect(target.store.kv.budget).toBeUndefined();
  });
});

test('listBackupFiles : filtre, trie et ignore les dossiers inaccessibles', async () => {
  const entry = (name: string, file = true) => ({
    name,
    path: `/d/${name}`,
    size: '10',
    mtime: new Date(),
    isFile: () => file,
  });
  (RNFS.readDir as jest.Mock)
    .mockResolvedValueOnce([
      entry('LigdiBe_sauvegarde_20261001-100000.json'),
      entry('LigdiBe_transactions_20261001.csv'),
      entry('LigdiBe_sauvegarde_20261013-100000.json'),
      entry('LigdiBe_sauvegarde_dossier.json', false),
    ])
    .mockRejectedValueOnce(new Error('EACCES'))
    .mockResolvedValueOnce([]);
  const files = await listBackupFiles();
  expect(files.map(f => f.name)).toEqual([
    'LigdiBe_sauvegarde_20261013-100000.json',
    'LigdiBe_sauvegarde_20261001-100000.json',
  ]);
  expect(files[0].size).toBe(10);
});
