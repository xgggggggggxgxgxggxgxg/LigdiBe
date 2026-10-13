import { parseTransactionSms } from '../src/data/parser/SmsParserEngine';
import {
  isSensitiveSecuritySms,
  isWhitelistedSender,
  normalizeSender,
  providerFromSender,
} from '../src/data/parser/securityFilters';
import {
  cleanName,
  normalizeSms,
  parseAmount,
  parseAmountOrZero,
  parseFrenchDate,
  parseOrangeTransIdDate,
} from '../src/data/parser/textUtils';

const MOOV_PAYMENT = `Paiement reussi auprés du marchand INTOUCH BURKINA\nMontant: 6 000,00 FCFA\nFrais: 0,00 FCFA\nTotal: 6 000,00 FCFA\nDate: 09/10/2026 20:03\nTID: DJ91LNF5HF\nSolde: 9 891,00 FCFA`;

describe('textUtils', () => {
  test.each([
    ['6 000,00', 6000],
    ['6 000,00', 6000],
    ['6 000,00', 6000],
    ['200,000.00', 200000],
    ['1.234.567,50', 1234567.5],
    ['3.000', 3000],
    ['1.250.000', 1250000],
    ['500.00', 500],
    ['4.3478', 4.3478],
    ['192284.67', 192284.67],
    ['6000,00', 6000],
    ['200,000', 200000],
    ['500', 500],
    ['500.', 500],
    ['3.000F', 3000],
  ])('parseAmount(%p) = %p', (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });

  test('parseAmount retourne undefined sur vide / sans chiffres', () => {
    expect(parseAmount(undefined)).toBeUndefined();
    expect(parseAmount('')).toBeUndefined();
    expect(parseAmount(' ')).toBeUndefined();
    expect(parseAmount('FCFA')).toBeUndefined();
    expect(parseAmount('1.2.3,4.5')).toBeUndefined();
  });

  test('parseAmountOrZero', () => {
    expect(parseAmountOrZero(undefined)).toBe(0);
    expect(parseAmountOrZero('10,00')).toBe(10);
  });

  test('normalizeSms nettoie espaces insécables, apostrophes, CRLF et zéro-width', () => {
    expect(normalizeSms('  A  B\r\nC ’D​\t E  \n  F ')).toBe("A B\nC 'D E\nF");
  });

  test('cleanName', () => {
    expect(cleanName('  MME  SANGARE   CHANTAL. ')).toBe('MME SANGARE CHANTAL');
    expect(cleanName(', ROMARIC,')).toBe('ROMARIC');
  });

  test('parseFrenchDate', () => {
    expect(parseFrenchDate('30/09/2026 18:17:58')).toBe('2026-09-30T18:17:58');
    expect(parseFrenchDate('24/06/2026 à 10:38')).toBe('2026-06-24T10:38:00');
    expect(parseFrenchDate('01/02/2026')).toBe('2026-02-01T00:00:00');
    expect(parseFrenchDate(undefined)).toBeUndefined();
    expect(parseFrenchDate('hier soir')).toBeUndefined();
    expect(parseFrenchDate('45/13/2026 10:00')).toBeUndefined();
    expect(parseFrenchDate('10/10/2026 25:00')).toBeUndefined();
  });

  test('parseOrangeTransIdDate', () => {
    expect(parseOrangeTransIdDate('MP261012.1637.71387533')).toBe('2026-10-12T16:37:00');
    expect(parseOrangeTransIdDate(undefined)).toBeUndefined();
    expect(parseOrangeTransIdDate('DJ91LNF5HF')).toBeUndefined();
    expect(parseOrangeTransIdDate('MP261399.1637.1')).toBeUndefined();
  });
});

describe('securityFilters', () => {
  test('whitelist des expéditeurs', () => {
    expect(isWhitelistedSender('OrangeMoney')).toBe(true);
    expect(isWhitelistedSender('Moov Money')).toBe(true);
    expect(isWhitelistedSender('WAVE')).toBe(true);
    expect(isWhitelistedSender('UBA')).toBe(true);
    expect(isWhitelistedSender('Ecobank')).toBe(true);
    expect(isWhitelistedSender('Telecel')).toBe(true);
    expect(isWhitelistedSender('+22670000000')).toBe(false);
    expect(isWhitelistedSender('PromoShop')).toBe(false);
    expect(isWhitelistedSender('---')).toBe(false);
    expect(isWhitelistedSender('MaBanque', ['ma-banque'])).toBe(true);
  });

  test('providerFromSender / normalizeSender', () => {
    expect(normalizeSender('Orange-Money ')).toBe('ORANGEMONEY');
    expect(providerFromSender('MoovMoney')).toBe('MOOV');
    expect(providerFromSender('Inconnu')).toBeUndefined();
  });

  test.each([
    'Votre code OTP est 482913. Il expire dans 5 minutes.',
    'Code de vérification Orange Money : 123456',
    'Votre code est: 9988',
    'Ne le communiquez a personne : 4455',
    'Votre code PIN a ete modifie',
    'Your verification code is 1234',
    'Authentification 2FA : 112233',
    'Votre mot de passe temporaire est AB12',
  ])('SMS sensible rejeté : %s', sms => {
    expect(isSensitiveSecuritySms(sms)).toBe(true);
    expect(parseTransactionSms(sms)).toBeNull();
  });

  test("« Code d'agent » n'est pas considéré comme un secret", () => {
    expect(isSensitiveSecuritySms("Code d'agent: 1003631")).toBe(false);
  });
});

describe('parseTransactionSms - garde-fous', () => {
  test('rejette un expéditeur hors whitelist', () => {
    expect(parseTransactionSms(MOOV_PAYMENT, { sender: '+22670112233' })).toBeNull();
  });

  test('accepte un expéditeur whitelisté', () => {
    expect(parseTransactionSms(MOOV_PAYMENT, { sender: 'MoovMoney' })?.provider).toBe('MOOV');
  });

  test('rejette vide, inconnu et montant nul', () => {
    expect(parseTransactionSms('   ')).toBeNull();
    expect(parseTransactionSms('Bonne fête de Tabaski à tous nos clients !')).toBeNull();
    expect(parseTransactionSms('Vous avez reçu 0F De TEST (+22670000000) 24/06/2026 à 10:38 Avec UBA x1')).toBeNull();
  });

  test('Orange : frais de retrait renseignés', () => {
    const r = parseTransactionSms(
      'Vous avez retire 10000.00 FCFA aupres de l agent 1234 KIOSQUE CENTRAL, Frais: 150.00 FCFA. Trans ID : CO261007.1629.1. Votre solde est de : 5000.00 FCFA.',
    );
    expect(r).toMatchObject({ type: 'CASH_WITHDRAWAL', amount: 10000, fee: 150, total: 10150, agentCode: '1234' });
  });

  test('Wave : paiement marchand', () => {
    const r = parseTransactionSms(
      'Vous avez payé 1.500F à Boutique Awa le 12/10/2026 09:15. Solde Wave: 8.500F Avec UBA ABC123',
    );
    expect(r).toMatchObject({
      provider: 'UBA_WAVE',
      type: 'EXPENSE',
      amount: 1500,
      counterpartyName: 'Boutique Awa',
      balanceAfter: 8500,
      reference: 'ABC123',
    });
  });
});

describe('parseTransactionSms - règles génériques', () => {
  test('transfert envoyé avec numéro et nom (fournisseur déduit du contenu)', () => {
    const r = parseTransactionSms(
      'Vous avez envoye 5 000 FCFA a 70112233, ADAMA OUEDRAOGO. Frais: 50 FCFA. Nouveau solde Moov: 12 000 FCFA. TID: ABC123XYZ. Date: 11/10/2026 08:30',
    );
    expect(r).toMatchObject({
      provider: 'MOOV',
      type: 'EXPENSE',
      amount: 5000,
      fee: 50,
      total: 5050,
      counterpartyPhone: '70112233',
      counterpartyName: 'ADAMA OUEDRAOGO',
      balanceAfter: 12000,
      reference: 'ABC123XYZ',
      occurredAt: '2026-10-11T08:30:00',
    });
  });

  test('transfert envoyé sans nom, fournisseur déduit de l’expéditeur', () => {
    const r = parseTransactionSms('Vous avez transfere 2000 FCFA au 76543210.', { sender: 'Telecel' });
    expect(r).toMatchObject({
      provider: 'TELECEL',
      type: 'EXPENSE',
      amount: 2000,
      counterpartyPhone: '76543210',
      merchantOrRecipient: '76543210',
    });
    expect(r?.counterpartyName).toBeUndefined();
  });

  test('transfert sans fournisseur identifiable : ignoré', () => {
    expect(parseTransactionSms('Vous avez envoye 2000 FCFA a 76543210.')).toBeNull();
  });

  test('achat forfait internet (agrégateur crédit/data)', () => {
    const r = parseTransactionSms(
      'Achat de forfait internet 1Go reussi pour 500 FCFA. Votre nouveau solde Orange Money est de 3 200 FCFA. Trans ID: AB261012.1010.55',
    );
    expect(r).toMatchObject({
      provider: 'ORANGE',
      type: 'AIRTIME_RECHARGE',
      amount: 500,
      balanceAfter: 3200,
      reference: 'AB261012.1010.55',
    });
  });

  test('montant total explicite conservé', () => {
    expect(parseTransactionSms(MOOV_PAYMENT)?.total).toBe(6000);
  });
});

describe('Dépôt chez un agent (espèces → MoMo)', () => {
  test('Moov : dépôt agent', () => {
    const r = parseTransactionSms(
      "Depot reussi auprès de l'Agent AWA KIOSQUE\nCode d'agent: 2001\nMontant: 5 000,00 FCFA\nFrais: 0,00 FCFA\nDate: 12/10/2026 09:00\nTID: DEP123\nSolde: 21 316,00 FCFA",
    );
    expect(r).toMatchObject({
      provider: 'MOOV',
      type: 'AGENT_DEPOSIT',
      amount: 5000,
      total: 5000,
      counterpartyName: 'AWA KIOSQUE',
      agentCode: '2001',
      balanceAfter: 21316,
    });
  });

  test('Orange : dépôt reçu de l’agent', () => {
    const r = parseTransactionSms(
      "Vous avez recu un depot de 10000.00 FCFA de l'agent 7714597 ANSV BORO. Votre solde est de : 90207.94 FCFA. Trans ID: CI261012.0900.1",
    );
    expect(r).toMatchObject({
      provider: 'ORANGE',
      type: 'AGENT_DEPOSIT',
      amount: 10000,
      agentCode: '7714597',
      balanceAfter: 90207.94,
      occurredAt: '2026-10-12T09:00:00',
    });
  });

  test('Wave : dépôt chez un point', () => {
    const r = parseTransactionSms(
      'Vous avez déposé 5.000F chez Kiosque Fatim le 12/10/2026 10:00. Solde Wave: 5.500F Avec UBA DEP9',
    );
    expect(r).toMatchObject({
      provider: 'UBA_WAVE',
      type: 'AGENT_DEPOSIT',
      amount: 5000,
      counterpartyName: 'Kiosque Fatim',
      balanceAfter: 5500,
    });
    const short = parseTransactionSms('Vous avez déposé 1.000F chez Kiosque Fatim.');
    expect(short).toMatchObject({ type: 'AGENT_DEPOSIT', amount: 1000 });
    expect(short?.balanceAfter).toBeUndefined();
  });
});
