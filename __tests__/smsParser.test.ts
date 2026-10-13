import { parseTransactionSms } from '../src/data/parser/SmsParserEngine';

describe('SmsParserEngine - Real West African Transaction SMS', () => {

  test('1. Moov Money - Paiement Marchand InTouch Burkina', () => {
    const sms = `Paiement reussi auprés du marchand INTOUCH BURKINA\nMontant: 6 000,00 FCFA\nFrais: 0,00 FCFA\nTotal: 6 000,00 FCFA\nDate: 09/10/2026 20:03\nTID: DJ91LNF5HF\nSolde: 9 891,00 FCFA`;
    const result = parseTransactionSms(sms);
    expect(result).toMatchObject({
      provider: 'MOOV',
      type: 'EXPENSE',
      amount: 6000,
      fee: 0,
      merchantOrRecipient: 'INTOUCH BURKINA',
      balanceAfter: 9891,
      reference: 'DJ91LNF5HF'
    });
  });

  test('2. Moov Money - Retrait Agent (Conversion Cash)', () => {
    const sms = `Retrait reussi auprès de l'Agent IBRAHIM ILBOUDO\nCode d'agent: 1003631\nMontant: 1 000,00 FCFA\nFrais: 10,00 FCFA\nTotal: 1 010,00 FCFA\nDate: 30/09/2026 18:17:58\nTxn ID: DIU3L2SENF\nSolde: 16 316,00 FCFA`;
    const result = parseTransactionSms(sms);
    expect(result).toMatchObject({
      provider: 'MOOV',
      type: 'CASH_WITHDRAWAL',
      amount: 1000,
      fee: 10,
      counterpartyName: 'IBRAHIM ILBOUDO',
      balanceAfter: 16316
    });
  });

  test('3. Moov Money - Réception Transfert Tiers', () => {
    const sms = `Vous avez reçu 7 070,00 FCFA de MME SANGARE  CHANTAL MADINA.\nNuméro: 22670201448\nDate: 28/09/2026 19:10:11\nTID: DIS6KYMLXQ\nSolde: 17 426,00 FCFA`;
    const result = parseTransactionSms(sms);
    expect(result).toMatchObject({
      provider: 'MOOV',
      type: 'INCOME',
      amount: 7070,
      counterpartyName: 'MME SANGARE CHANTAL MADINA',
      counterpartyPhone: '22670201448',
      balanceAfter: 17426
    });
  });

  test('4. Moov Money - Recharge Crédit d\'appel', () => {
    const sms = `Ref : DIP4KSD2J2, Vous avez rechargé le 22670524434 via Moov Money avec 200,00 FCFA de crédit. GAGNEZ 200% de bonus sur toutes vos recharges.Votre solde MOOV Money est de 11 256,00 FCFA.`;
    const result = parseTransactionSms(sms);
    expect(result).toMatchObject({
      provider: 'MOOV',
      type: 'AIRTIME_RECHARGE',
      amount: 200,
      counterpartyPhone: '22670524434',
      balanceAfter: 11256
    });
  });

  test('5. Orange Money - Paiement Tiers avec Frais et Taxes', () => {
    const sms = `Votre paiement de 500.00 FCFA, Frais: 4.3478 FCFA, Taxe: 0.6522 FCFA a WENDSONGUEDE DAVID SAWADOGO a ete effectue avec succes. Votre solde est de : 192284.67 FCFA. Trans id: MP261012.1637.71387533.`;
    const result = parseTransactionSms(sms);
    expect(result).toMatchObject({
      provider: 'ORANGE',
      type: 'EXPENSE',
      amount: 500,
      fee: 4.3478,
      tax: 0.6522,
      counterpartyName: 'WENDSONGUEDE DAVID SAWADOGO',
      balanceAfter: 192284.67
    });
  });

  test('6. Orange Money - Réception Fonds', () => {
    const sms = `Vous avez recu 110560.48 FCFA, Frais:  FCFA, Taxe:  FCFA du 76900142,ROMARIC. Le solde de votre compte est de 189986.92 FCFA Trans ID: PP261010.0944.25789150.`;
    const result = parseTransactionSms(sms);
    expect(result).toMatchObject({
      provider: 'ORANGE',
      type: 'INCOME',
      amount: 110560.48,
      counterpartyName: 'ROMARIC',
      counterpartyPhone: '76900142',
      balanceAfter: 189986.92
    });
  });

  test('7. Orange Money - Retrait Agent Important', () => {
    const sms = `Vous avez retire 200,000.00 FCFA aupres de l agent 7714597 ANSV BORO DORO CELESATECH, Trans ID : CO261007.1629.28935486. Votre solde est de : 80207.94 FCFA.`;
    const result = parseTransactionSms(sms);
    expect(result).toMatchObject({
      provider: 'ORANGE',
      type: 'CASH_WITHDRAWAL',
      amount: 200000,
      counterpartyName: '7714597 ANSV BORO DORO CELESATECH',
      balanceAfter: 80207.94
    });
  });

  test('8. Wave / UBA - Réception et Retrait abrégé', () => {
    const smsRecu = `Vous avez reçu 3.000F De OKPEOLOU Eric (+2250747070797) 24/06/2026 à 10:38 +infos: 80001257 Avec UBA xot-25m7hbegg2y40`;
    const resultRecu = parseTransactionSms(smsRecu);
    expect(resultRecu).toMatchObject({
      provider: 'UBA_WAVE',
      type: 'INCOME',
      amount: 3000,
      counterpartyName: 'OKPEOLOU Eric'
    });

    const smsRetrait = `Vous avez retiré 2.500F chez Sadja Design le 20/07/2026  18:19. Solde Wave: 500F Avec UBA ATXVXMWMMIVVXJH64FX`;
    const resultRetrait = parseTransactionSms(smsRetrait);
    expect(resultRetrait).toMatchObject({
      provider: 'UBA_WAVE',
      type: 'EXPENSE',
      amount: 2500,
      counterpartyName: 'Sadja Design',
      balanceAfter: 500
    });
  });
});
