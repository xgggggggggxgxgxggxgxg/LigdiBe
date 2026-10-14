import { CATEGORIES } from '../src/core/categories';
import { parseTransactionSms } from '../src/data/parser/SmsParserEngine';
import { autoCategorize } from '../src/domain/usecases/CategorizeTransaction';
import { buildLedgerEntries } from '../src/domain/usecases/ProcessIncomingSms';

describe('Banques : mouvements de compte', () => {
  test('débit carte chez un marchand (Ecobank)', () => {
    const sms = `Ecobank: Votre compte 0123XXXX89 a ete debite de 25 000 XOF le 12/10/2026 14:05. Libelle: PAIEMENT TPE MARINA MARKET. Solde disponible: 150 300 XOF. Ref: FT26285ABC12`;
    expect(parseTransactionSms(sms, { sender: 'Ecobank' })).toMatchObject({
      provider: 'ECOBANK',
      type: 'EXPENSE',
      amount: 25000,
      counterpartyName: 'PAIEMENT TPE MARINA MARKET',
      balanceAfter: 150300,
      reference: 'FT26285ABC12',
      occurredAt: '2026-10-12T14:05:00',
      ruleId: 'BANK_ACCOUNT_MOVEMENT',
    });
  });

  test('retrait au GAB = conversion en espèces, frais isolés', () => {
    const sms = `Votre compte courant a ete debite de 50.000 FCFA le 13/10/2026. Operation: RETRAIT GAB OUAGA 2000. Frais: 300 FCFA. Nouveau solde: 100.000 FCFA`;
    const parsed = parseTransactionSms(sms, { sender: 'CorisBank' })!;
    expect(parsed).toMatchObject({ provider: 'BANK', type: 'CASH_WITHDRAWAL', amount: 50000, fee: 300, total: 50300 });
    const { transactions, accounts } = buildLedgerEntries(parsed, [], new Date(2026, 9, 13, 10));
    expect(transactions.map(t => t.type)).toEqual(['CASH_WITHDRAWAL', 'FEE', 'CASH_DEPOSIT']);
    expect(accounts.find(a => a.id === 'bank')?.currentBalance).toBe(100000);
    expect(accounts.find(a => a.id === 'cash-wallet')?.currentBalance).toBe(50000);
  });

  test('crédit de salaire (forme « Crédit de … sur votre compte »)', () => {
    const sms = `Credit de 350 000 FCFA sur votre compte 2201XXXX. Motif: VIREMENT SALAIRE SEPT 2026. Solde: 512 000 FCFA`;
    const parsed = parseTransactionSms(sms, { sender: 'SGBF' })!;
    expect(parsed).toMatchObject({ provider: 'BANK', type: 'INCOME', amount: 350000, balanceAfter: 512000 });
    expect(autoCategorize(parsed)).toBe(CATEGORIES.SALARY);
    expect(autoCategorize({ type: 'INCOME', counterpartyName: 'ROMARIC' })).toBe(CATEGORIES.INCOME);
  });

  test('crédit sans libellé, fournisseur déduit du contenu', () => {
    const parsed = parseTransactionSms('ECOBANK: votre compte a ete credite de 10 000 XOF.');
    expect(parsed).toMatchObject({ provider: 'ECOBANK', type: 'INCOME', amount: 10000 });
    expect(parsed?.counterpartyName).toBeUndefined();
  });

  test('sans banque identifiable : ignoré', () => {
    expect(parseTransactionSms('Votre compte a ete debite de 10 000 XOF.')).toBeNull();
  });

  test('les SMS opérateur existants ne sont pas captés par la règle bancaire', () => {
    const orange = `Vous avez recu 110560.48 FCFA, Frais:  FCFA, Taxe:  FCFA du 76900142,ROMARIC. Le solde de votre compte est de 189986.92 FCFA Trans ID: PP261010.0944.25789150.`;
    expect(parseTransactionSms(orange)?.ruleId).toBe('ORANGE_TRANSFER_RECEIVED');
  });
});

describe('Moov : transfert envoyé', () => {
  test('gabarit « Transfert reussi vers »', () => {
    const sms = `Transfert reussi vers 22670112233 OUEDRAOGO PAUL\nMontant: 5 000,00 FCFA\nFrais: 50,00 FCFA\nTotal: 5 050,00 FCFA\nDate: 11/10/2026 09:12:30\nTID: DK11AB34CD\nSolde: 12 000,00 FCFA`;
    expect(parseTransactionSms(sms, { sender: 'MoovMoney' })).toMatchObject({
      provider: 'MOOV',
      type: 'EXPENSE',
      amount: 5000,
      fee: 50,
      total: 5050,
      counterpartyPhone: '22670112233',
      counterpartyName: 'OUEDRAOGO PAUL',
      balanceAfter: 12000,
      reference: 'DK11AB34CD',
      occurredAt: '2026-10-11T09:12:30',
    });
  });

  test('sans nom : le numéro sert de destinataire', () => {
    const sms = `Transfert reussi vers 22670112233\nMontant: 1 000,00 FCFA\nFrais: 0,00 FCFA\nSolde: 11 000,00 FCFA`;
    const parsed = parseTransactionSms(sms)!;
    expect(parsed.counterpartyName).toBeUndefined();
    expect(parsed.merchantOrRecipient).toBe('22670112233');
    expect(autoCategorize(parsed)).toBe(CATEGORIES.TRANSFER);
  });
});
