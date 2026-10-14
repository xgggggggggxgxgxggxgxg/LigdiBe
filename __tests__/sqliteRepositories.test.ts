import { runMigrations, SCHEMA_VERSION } from '../src/data/database/schema';
import { withTransactions } from '../src/data/database/SqlDatabase';
import { createSqliteRepositories } from '../src/data/repositories/SqliteRepositories';
import { DEFAULT_BUDGET_CONFIG } from '../src/domain/models/Budget';
import { ProcessIncomingSmsUseCase } from '../src/domain/usecases/ProcessIncomingSms';
import { createNodeSqliteDatabase } from './helpers/nodeSqliteDatabase';
import { tx } from './helpers/inMemoryRepositories';

const setup = async () => {
  const db = createNodeSqliteDatabase();
  await runMigrations(db);
  return { db, repos: createSqliteRepositories(db) };
};

describe('SQLite - migrations', () => {
  test('idempotentes et versionnées', async () => {
    const db = createNodeSqliteDatabase();
    expect(await runMigrations(db)).toBe(SCHEMA_VERSION);
    expect(await runMigrations(db)).toBe(SCHEMA_VERSION);
    const [v] = await db.execute('PRAGMA user_version');
    expect(v.user_version).toBe(SCHEMA_VERSION);
  });

  test('v2 → v3 : colonnes data ajoutées sans perte, volume relu', async () => {
    const db = createNodeSqliteDatabase();
    await db.execute('PRAGMA user_version = 0');
    const { MIGRATIONS } = require('../src/data/database/schema');
    for (const sql of [...MIGRATIONS[0], ...MIGRATIONS[1]]) {
      await db.execute(sql);
    }
    await db.execute('PRAGMA user_version = 2');
    await db.execute(
      "INSERT INTO transactions (id, account_id, provider, type, amount, category, source, occurred_at, created_at) VALUES ('old', 'a', 'MOOV', 'EXPENSE', 5, 'Autre', 'SMS', '2026-01-01', '2026-01-01')",
    );
    expect(await runMigrations(db)).toBe(3);
    const repos = createSqliteRepositories(db);
    await repos.transactions.insertMany([
      tx({ id: 'pass', type: 'AIRTIME_RECHARGE', dataVolumeMb: 1536, dataValidityDays: 0.04 }),
    ]);
    const all = await repos.transactions.listAll();
    expect(all.find(t => t.id === 'old')).not.toHaveProperty('dataVolumeMb');
    expect(all.find(t => t.id === 'pass')).toMatchObject({ dataVolumeMb: 1536, dataValidityDays: 0.04 });
  });
});

describe('SQLite - dépôts', () => {
  test('transactions : insertion, recherche, mise à jour, suppression en cascade', async () => {
    const { repos } = await setup();
    await repos.transactions.insertMany([
      tx({
        id: 'a',
        reference: 'R1',
        smsFingerprint: 'fp1',
        occurredAt: '2026-10-01T10:00:00',
        counterpartyName: 'ALI',
      }),
      tx({ id: 'b', parentId: 'a', type: 'FEE', occurredAt: '2026-10-01T10:00:00' }),
      tx({ id: 'c', occurredAt: '2026-09-01T10:00:00' }),
    ]);
    expect(await repos.transactions.existsByReference('MOOV', 'R1')).toBe(true);
    expect(await repos.transactions.existsByReference('ORANGE', 'R1')).toBe(false);
    expect(await repos.transactions.existsBySmsFingerprint('fp1')).toBe(true);
    expect(await repos.transactions.existsBySmsFingerprint('nope')).toBe(false);
    const oct = await repos.transactions.listBetween('2026-10-01', '2026-11-01');
    expect(oct.map(t => t.id).sort()).toEqual(['a', 'b']);
    expect(oct.find(t => t.id === 'a')).toMatchObject({ counterpartyName: 'ALI', amount: 1000 });
    expect(oct.find(t => t.id === 'a')).not.toHaveProperty('note');
    expect((await repos.transactions.listRecent(1))[0].occurredAt).toBe('2026-10-01T10:00:00');
    await repos.transactions.update('a', { category: 'Famille', note: 'Maman' });
    await repos.transactions.update('a', {});
    expect((await repos.transactions.listAll()).find(t => t.id === 'a')).toMatchObject({
      category: 'Famille',
      note: 'Maman',
    });
    await repos.transactions.delete('a');
    expect((await repos.transactions.listAll()).map(t => t.id)).toEqual(['c']);
  });

  test('comptes : upsert', async () => {
    const { repos } = await setup();
    await repos.accounts.saveMany([{ id: 'x', name: 'X', provider: 'MOOV', type: 'MOMO', currentBalance: 10 }]);
    await repos.accounts.saveMany([
      { id: 'x', name: 'X', provider: 'MOOV', type: 'MOMO', currentBalance: 20, updatedAt: 'u' },
    ]);
    expect(await repos.accounts.getAll()).toEqual([
      { id: 'x', name: 'X', provider: 'MOOV', type: 'MOMO', currentBalance: 20, updatedAt: 'u' },
    ]);
  });

  test('dettes, prévisionnel, tontines, paramètres', async () => {
    const { repos } = await setup();
    const debt = {
      id: 'd',
      contactName: 'Awa',
      amount: 5000,
      amountRepaid: 0,
      direction: 'OWED_TO_ME' as const,
      isSettled: false,
      createdAt: 'c',
    };
    await repos.debts.save(debt);
    await repos.debts.save({ ...debt, id: 'd2', phone: '70', dueDate: '2026-10-20', note: 'n', isSettled: true });
    expect(await repos.debts.getAll()).toEqual([
      debt,
      { ...debt, id: 'd2', phone: '70', dueDate: '2026-10-20', note: 'n', isSettled: true },
    ]);
    await repos.debts.delete('d');
    expect(await repos.debts.getAll()).toHaveLength(1);

    const item = {
      id: 'p',
      month: '2026-10',
      label: 'Loyer',
      amount: 75000,
      kind: 'EXPENSE' as const,
      category: 'Loyer',
      keywords: ['kabore'],
      isDone: true,
      matchedTransactionId: 't',
      recurring: true,
    };
    await repos.plannedItems.saveMany([
      item,
      { ...item, id: 'p2', month: '2026-11', isDone: false, matchedTransactionId: undefined, recurring: false },
    ]);
    expect(await repos.plannedItems.listByMonth('2026-10')).toEqual([item]);
    await repos.plannedItems.delete('p');
    expect(await repos.plannedItems.listByMonth('2026-10')).toEqual([]);

    const t = {
      id: 't',
      name: 'Bureau',
      contributionAmount: 10000,
      frequency: 'MONTHLY' as const,
      membersCount: 5,
      myTurn: 2,
      startDate: '2026-10-01',
      paidContributions: ['2026-10-01'],
    };
    await repos.tontines.save(t);
    expect(await repos.tontines.getAll()).toEqual([t]);
    await repos.tontines.delete('t');
    expect(await repos.tontines.getAll()).toEqual([]);

    expect(await repos.settings.getBudgetConfig()).toEqual(DEFAULT_BUDGET_CONFIG);
    await repos.settings.saveBudgetConfig({ ...DEFAULT_BUDGET_CONFIG, monthlyBudget: 1 });
    expect((await repos.settings.getBudgetConfig()).monthlyBudget).toBe(1);
    expect(await repos.settings.getJson('k', 42)).toBe(42);
    await repos.settings.setJson('k', { a: 1 });
    expect(await repos.settings.getJson('k', null)).toEqual({ a: 1 });
  });

  test('transaction atomique : rollback sur erreur, sérialisation', async () => {
    const { db, repos } = await setup();
    await expect(
      repos.runInTransaction(async () => {
        await repos.transactions.insertMany([tx({ id: 'z' })]);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await repos.transactions.listAll()).toEqual([]);
    const { runInTransaction } = withTransactions(db);
    const results = await Promise.all([1, 2, 3].map(i => runInTransaction(async () => i)));
    expect(results).toEqual([1, 2, 3]);
  });

  test('bout en bout : SMS de retrait → base chiffrée (schéma réel)', async () => {
    const { repos } = await setup();
    const uc = new ProcessIncomingSmsUseCase(repos);
    const sms = `Vous avez retire 200,000.00 FCFA aupres de l agent 7714597 ANSV BORO DORO CELESATECH, Trans ID : CO261007.1629.28935486. Votre solde est de : 80207.94 FCFA.`;
    expect((await uc.execute({ body: sms, sender: 'OrangeMoney' })).status).toBe('RECORDED');
    expect((await uc.execute({ body: sms, sender: 'OrangeMoney' })).status).toBe('DUPLICATE');
    const accounts = await repos.accounts.getAll();
    expect(accounts.find(a => a.id === 'orange-money')?.currentBalance).toBe(80207.94);
    expect(accounts.find(a => a.id === 'cash-wallet')?.currentBalance).toBe(200000);
  });
});
