import { CATEGORIES } from '../src/core/categories';
import { parseTransactionSms } from '../src/data/parser/SmsParserEngine';
import { CASH_ACCOUNT_ID } from '../src/domain/models/Account';
import { autoCategorize } from '../src/domain/usecases/CategorizeTransaction';
import {
  buildLedgerEntries,
  LEARNED_CATEGORIES_KEY,
  ProcessIncomingSmsUseCase,
} from '../src/domain/usecases/ProcessIncomingSms';
import { createInMemoryRepositories } from './helpers/inMemoryRepositories';

const MOOV_WITHDRAWAL = `Retrait reussi auprès de l'Agent IBRAHIM ILBOUDO\nCode d'agent: 1003631\nMontant: 1 000,00 FCFA\nFrais: 10,00 FCFA\nTotal: 1 010,00 FCFA\nDate: 30/09/2026 18:17:58\nTxn ID: DIU3L2SENF\nSolde: 16 316,00 FCFA`;
const ORANGE_PAYMENT = `Votre paiement de 500.00 FCFA, Frais: 4.3478 FCFA, Taxe: 0.6522 FCFA a WENDSONGUEDE DAVID SAWADOGO a ete effectue avec succes. Votre solde est de : 192284.67 FCFA. Trans id: MP261012.1637.71387533.`;
const NOW = new Date(2026, 9, 13, 9, 0);
let n = 0;
const idGen = (p: string) => `${p}${++n}`;

describe('buildLedgerEntries - règle du retrait kiosque', () => {
  test('MoMo débité (solde SMS), Poche créditée du net, frais isolés', () => {
    const parsed = parseTransactionSms(MOOV_WITHDRAWAL)!;
    const { transactions, accounts } = buildLedgerEntries(
      parsed,
      [{ id: CASH_ACCOUNT_ID, name: 'Poche', provider: 'CASH', currentBalance: 2000, type: 'CASH' }],
      NOW,
      { idGen },
    );
    expect(transactions.map(t => t.type)).toEqual(['CASH_WITHDRAWAL', 'FEE', 'CASH_DEPOSIT']);
    const [main, fee, cashIn] = transactions;
    expect(main).toMatchObject({
      accountId: 'moov-money',
      category: CATEGORIES.CASH_WITHDRAWAL,
      occurredAt: '2026-09-30T18:17:58',
    });
    expect(fee).toMatchObject({ amount: 10, category: CATEGORIES.FEES, parentId: main.id });
    expect(cashIn).toMatchObject({ accountId: CASH_ACCOUNT_ID, amount: 1000, parentId: main.id });
    expect(accounts.find(a => a.id === 'moov-money')?.currentBalance).toBe(16316);
    expect(accounts.find(a => a.id === CASH_ACCOUNT_ID)?.currentBalance).toBe(3000);
  });

  test('crée le compte Poche s’il n’existe pas encore', () => {
    const { accounts } = buildLedgerEntries(parseTransactionSms(MOOV_WITHDRAWAL)!, [], NOW, { idGen });
    expect(accounts.find(a => a.id === CASH_ACCOUNT_ID)?.currentBalance).toBe(1000);
  });

  test('frais + taxes Orange regroupés dans une écriture FEE', () => {
    const { transactions } = buildLedgerEntries(parseTransactionSms(ORANGE_PAYMENT)!, [], NOW, { idGen });
    expect(transactions).toHaveLength(2);
    expect(transactions[1]).toMatchObject({ type: 'FEE', amount: 5 });
    expect(transactions[0].category).toBe(CATEGORIES.OTHER);
  });

  test('sans solde dans le SMS, le solde est calculé par delta', () => {
    const debit = parseTransactionSms('Vous avez transfere 2000 FCFA au 76543210. Frais: 25 FCFA', {
      sender: 'Telecel',
    })!;
    const r1 = buildLedgerEntries(
      debit,
      [{ id: 'telecel-account', name: 'T', provider: 'TELECEL', currentBalance: 10000, type: 'MOMO' }],
      NOW,
      { idGen },
    );
    expect(r1.accounts[0]).toMatchObject({ id: 'telecel-account', currentBalance: 7975 });
    const credit = { ...debit, type: 'INCOME' as const, fee: 0, balanceAfter: undefined };
    const r2 = buildLedgerEntries(credit, [], NOW, { idGen });
    expect(r2.accounts[0]).toMatchObject({ currentBalance: 2000, name: 'Telecel Money', type: 'MOMO' });
  });

  test('un SMS plus ancien que le dernier solde connu ne l’écrase pas', () => {
    const parsed = parseTransactionSms(MOOV_WITHDRAWAL)!;
    const r = buildLedgerEntries(
      parsed,
      [
        {
          id: 'moov-money',
          name: 'Moov',
          provider: 'MOOV',
          currentBalance: 50000,
          type: 'MOMO',
          updatedAt: '2026-10-12T00:00:00',
        },
      ],
      NOW,
      { idGen },
    );
    expect(r.accounts[0].currentBalance).toBe(50000);
    const noBalance = { ...parsed, balanceAfter: undefined };
    const r2 = buildLedgerEntries(
      noBalance,
      [
        {
          id: 'moov-money',
          name: 'Moov',
          provider: 'MOOV',
          currentBalance: 50000,
          type: 'MOMO',
          updatedAt: '2026-10-12T00:00:00',
        },
      ],
      NOW,
      { idGen },
    );
    expect(r2.accounts[0]).toMatchObject({ currentBalance: 48990, updatedAt: '2026-10-12T00:00:00' });
  });

  test('banque : compte de type BANK', () => {
    const p = parseTransactionSms('Vous avez envoye 1000 FCFA a 70000000, ALI.', { sender: 'Ecobank' })!;
    expect(buildLedgerEntries(p, [], NOW, { idGen }).accounts[0]).toMatchObject({ type: 'BANK', provider: 'ECOBANK' });
  });
});

describe('autoCategorize', () => {
  test('par type, mots-clés, apprentissage et transfert', () => {
    expect(autoCategorize({ type: 'AIRTIME_RECHARGE' })).toBe(CATEGORIES.AIRTIME);
    expect(autoCategorize({ type: 'INCOME' })).toBe(CATEGORIES.INCOME);
    expect(autoCategorize({ type: 'EXPENSE', merchantOrRecipient: 'STATION TOTAL OUAGA 2000' })).toBe(CATEGORIES.FUEL);
    expect(autoCategorize({ type: 'EXPENSE', merchantOrRecipient: 'INTOUCH BURKINA' })).toBe(CATEGORIES.BILLS);
    expect(autoCategorize({ type: 'EXPENSE', counterpartyName: 'ALI', counterpartyPhone: '70112233' })).toBe(
      CATEGORIES.TRANSFER,
    );
    expect(autoCategorize({ type: 'EXPENSE', counterpartyPhone: '70112233' }, { '70112233': CATEGORIES.FAMILY })).toBe(
      CATEGORIES.FAMILY,
    );
    expect(autoCategorize({ type: 'EXPENSE' })).toBe(CATEGORIES.OTHER);
  });
});

describe('ProcessIncomingSmsUseCase', () => {
  test('enregistre, puis détecte les doublons (référence et empreinte)', async () => {
    const repos = createInMemoryRepositories();
    const uc = new ProcessIncomingSmsUseCase(repos);
    const r1 = await uc.execute({ body: MOOV_WITHDRAWAL, sender: 'MoovMoney', receivedAt: NOW });
    expect(r1.status).toBe('RECORDED');
    expect(repos.store.transactions).toHaveLength(3);
    expect((await uc.execute({ body: MOOV_WITHDRAWAL, sender: 'MoovMoney' })).status).toBe('DUPLICATE');

    const noRef = 'Vous avez payé 1.500F à Boutique Awa le 12/10/2026 09:15. Solde Wave: 8.500F';
    expect((await uc.execute({ body: noRef })).status).toBe('RECORDED');
    expect((await uc.execute({ body: noRef })).status).toBe('DUPLICATE');
  });

  test('ignore OTP, spam et expéditeurs non agréés ; accepte les expéditeurs ajoutés', async () => {
    const repos = createInMemoryRepositories();
    const uc = new ProcessIncomingSmsUseCase(repos);
    expect((await uc.execute({ body: 'Votre code OTP est 1234' })).status).toBe('IGNORED');
    expect((await uc.execute({ body: MOOV_WITHDRAWAL, sender: 'Arnaqueur' })).status).toBe('IGNORED');
    await repos.settings.setJson('extraSenders', ['Arnaqueur']);
    expect((await uc.execute({ body: MOOV_WITHDRAWAL, sender: 'Arnaqueur' })).status).toBe('RECORDED');
  });

  test('utilise les catégories apprises', async () => {
    const repos = createInMemoryRepositories();
    await repos.settings.setJson(LEARNED_CATEGORIES_KEY, { 'SADJA DESIGN': 'Habillement' });
    const r = await new ProcessIncomingSmsUseCase(repos).execute({
      body: 'Vous avez retiré 2.500F chez Sadja Design le 20/07/2026 18:19. Solde Wave: 500F Avec UBA ATX',
    });
    expect(r.status === 'RECORDED' && r.entries.transactions[0].category).toBe('Habillement');
  });

  test('fonctionne sans runInTransaction', async () => {
    const { runInTransaction, ...repos } = createInMemoryRepositories();
    expect(runInTransaction).toBeDefined();
    const r = await new ProcessIncomingSmsUseCase(repos).execute({ body: ORANGE_PAYMENT });
    expect(r.status).toBe('RECORDED');
  });
});
