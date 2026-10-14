/**
 * Formats RÉELS relevés sur un export SMS (Burkina Faso, 2026) — noms, numéros
 * et références anonymisés, structure et ponctuation conservées à l'identique.
 */
import { parseTransactionSms } from '../src/data/parser/SmsParserEngine';
import { isInformationalSms } from '../src/data/parser/informationalFilters';
import { isSensitiveSecuritySms } from '../src/data/parser/securityFilters';
import { looksLikeFinancialSms } from '../src/domain/usecases/UnrecognizedSms';

describe('Étape 1 — codes de sécurité et SMS informatifs (formats réels)', () => {
  test.each([
    ['Moov code SMS', "091637 est votre code SMS. NE PAS le partager à qui que ce soit, afin d'éviter la fraude."],
    ['Orange OTP', 'OTP genere avec succes par le 70000000. Montant de la transaction: 10,200.00 FCFA. OTP: 326170.'],
    [
      'Wave validation',
      "Code de validation: 2565. Ne partagez ce code qu'avec un agent Wave lors d'une transaction. Ce code expire dans 5 minutes.",
    ],
    [
      'Wave accès',
      "25028XX03A demande l'accès  votre compte Wave. Code de validation: 7633. Ne le partagez avec personne",
    ],
    [
      'Ecobank activation',
      'Confidentiel. Ecobank ne vous appellera jamais pour demander votre Code Secret/PIN. Bienvenue sur la Banque Mobile Ecobank. Votre Code d Activation est 624047',
    ],
    [
      'Orange retrait par code',
      'Trans ID: PP260901.1411.42140919, Vous avez recu  125.00 FCFA de 70000000, JEAN DUPONT.Votre mot de passe est 477701. Rendez-vous dans un point OM dans 4 jours au plus tard.',
    ],
    [
      'Moov code erroné',
      'Le code secret que vous avez saisi est errone. Apres 3 tentatives incorrectes, votre compte sera bloque.',
    ],
    [
      'Max it lien',
      'Merci de cliquer sur ce lien pour confirmer la connexion. https://maxit-mobile.orange.bf/oms-links/auth?token=xxx . Merci de ne pas partager ce message.',
    ],
  ])('%s : rejeté', (_label, sms) => {
    expect(isSensitiveSecuritySms(sms)).toBe(true);
    expect(parseTransactionSms(sms, { sender: 'OrangeMoney' })).toBeNull();
  });

  test.each([
    [
      'solde Orange',
      'Le solde de votre Compte Normal est de 3317.59 FCFA. Le solde de votre Compte Compte Retrait Gratuit est de 0.00 FCFA.',
    ],
    ['solde Moov', "Votre solde Compte Principal Moov Money est de  181,00 FCFA.Compte Bonus d'Accueil:0,00 FCFA."],
    [
      'demande de paiement',
      'Vous avez recu une demande de paiement de 3 570,00 FCFA du marchand SARL HUB. Veuillez composer *555*6# pour valider le paiement.',
    ],
    ['dépôt échoué', 'Your cash deposit of XOF900000 at CELESATECH has failed. Please try again later.'],
    [
      'unités offertes',
      'Vous avez recu du 70000001, 175.00 FCFA d unites. Gagnez 100% de bonus sur toutes vos recharges Orange Money. TRANS ID: RC260421.1551.50398379',
    ],
    [
      'détail facture',
      'Votre paiement de facture a été effectué avec succès. N Abonne 14000000000000 Nom: "CLIENT" Periodes: 04-2026 à 05-2026 Montant paye : 5636.0 Penalite : 2000 FCFA Frais : 150 FCFA \nID Trans: MP260812.0749.25703121',
    ],
    ['carte virtuelle', 'La Carte Virtuelle se terminant par XXXXXXXXXXXX3424 a t recharge avec XOF 4,500.00'],
    ['solde insuffisant', "Désolé, le compte du payeur n'a pas suffisamment d'argent pour terminer cette transaction"],
  ])('%s : ni opération, ni « à vérifier »', (_label, sms) => {
    expect(isInformationalSms(sms)).toBe(true);
    expect(parseTransactionSms(sms)).toBeNull();
    expect(looksLikeFinancialSms(sms)).toBe(false);
  });

  test.each([
    [
      'Ecobank carte VISA',
      'Pour creer votre carte virtuelle VISA qui coute 2400F sur Ecobank mobile, vous devez avoir un solde minumum de 3 000 F sur votre compte. info 25327900',
    ],
    [
      'Orange rentrée',
      'ORANGE MONEY VOUS ACCOMPAGNE POUR LA RENTRÉE ! Jusqu’au 10/10, réglez vos achats de fournitures scolaires chez nos librairies partenaires à partir de 5 000 F et profitez de 10% de remise. Stop SMS : *555#',
    ],
    [
      'Ecobank fidélité',
      'Passez a l action avec Ecobank mobile ! Utilisez l appli pour vos transactions, cumulez des points de fidelite et tentez de remporter 25 000 FCFA tel 25327900',
    ],
  ])('promo %s : pas « à vérifier »', (_label, sms) => {
    expect(looksLikeFinancialSms(sms)).toBe(false);
  });
});

const om = (sms: string) => parseTransactionSms(sms, { sender: 'OrangeMoney' });

describe('Étape 2 — Orange Money (formats réels)', () => {
  test('reçu sans frais (nom, numéro, solde, date issue du Trans ID)', () => {
    expect(
      om(
        'Vous avez recu 4,000.00 FCFA du 05000001,JEAN KABORE. Le solde de votre compte est de 4061.59 FCFA Trans ID: PP260311.1606.51755838. Flashez le QR CODE marchand avec Max it pour plus de facilite : https://onelink.to/nn64xw',
      ),
    ).toMatchObject({
      provider: 'ORANGE',
      type: 'INCOME',
      amount: 4000,
      counterpartyPhone: '05000001',
      counterpartyName: 'JEAN KABORE',
      balanceAfter: 4061.59,
      reference: 'PP260311.1606.51755838',
      occurredAt: '2026-03-11T16:06:00',
      ruleId: 'ORANGE_RECEIVED_SIMPLE',
    });
  });

  test('transfert envoyé, avec ou sans frais/taxe affichés', () => {
    expect(
      om(
        'Cher client, vous avez transfere 200.00 FCFA au numero 56000002,francois. Votre solde est de  3861.59 FCFA. ID Trans: PP260311.2005.28917878. Pour toute reclamation contactez par appel le 127 ou whatsapp 07000121. Orange Money BF',
      ),
    ).toMatchObject({
      type: 'EXPENSE',
      amount: 200,
      fee: 0,
      counterpartyPhone: '56000002',
      counterpartyName: 'francois',
      balanceAfter: 3861.59,
      reference: 'PP260311.2005.28917878',
    });
    expect(
      om(
        'Cher client, vous avez transfere 4,000.00 FCFA, Frais: 34.7826 FCFA, Taxe: 5.2174 FCFA au numero 45000003,ACCEPTEUR GD STEPH EXCHANGE BF. Votre solde est de  24102.34 FCFA. ID Trans: PP260916.1250.2968267. Pour toute reclamation contactez par appel le 127',
      ),
    ).toMatchObject({
      amount: 4000,
      fee: 34.7826,
      tax: 5.2174,
      total: 4040,
      counterpartyName: 'ACCEPTEUR GD STEPH EXCHANGE BF',
    });
    expect(
      om(
        'Cher client, vous avez transfere 2,000.00 FCFA, Frais: 0.0 FCFA, Taxe:  FCFA au numero 55000004,RAGNANGNEWENDE JOEL M. Votre solde est de  12586.09 FCFA. ID Trans: PP260502.1059.55712255.',
      ),
    ).toMatchObject({ amount: 2000, fee: 0, counterpartyName: 'RAGNANGNEWENDE JOEL M' });
  });

  test('paiement sans frais : marchand nettoyé, crédit « UNITE AIRTIME », solde sans devise', () => {
    expect(
      om(
        'Votre paiement de 100.00 FCFA a UNITE AIRTIME a ete effectue avec succes. Votre solde est de : 8761.59 Trans id: MP260314.0737.51782296. Pour gagner des depots et des motos inscrivez-vous au challenge',
      ),
    ).toMatchObject({ type: 'AIRTIME_RECHARGE', amount: 100, balanceAfter: 8761.59, airtimeKind: 'VOICE' });
    expect(
      om(
        'Votre paiement de 700.00 FCFA a ACCEPTEUR GD PHARMACIE LENDIMI PHARMACIE LENDIMI a ete effectue avec succes. Votre solde est de : 31481.59 FCFA. Trans id: MP260703.1732.10328348.',
      ),
    ).toMatchObject({ type: 'EXPENSE', amount: 700, counterpartyName: 'PHARMACIE LENDIMI', balanceAfter: 31481.59 });
    expect(
      om(
        'Votre paiement de 10,200.00 FCFA a CONNEKT4 BURKINA FASO a ete effectue avec succes. Votre solde: 2746.59 FCFA.Trans id: OM260317.2327.71325078.',
      ),
    ).toMatchObject({
      amount: 10200,
      counterpartyName: 'CONNEKT4 BURKINA FASO',
      balanceAfter: 2746.59,
      reference: 'OM260317.2327.71325078',
    });
    expect(
      om(
        'Votre paiement de  5,000.00 FCFA a Visa Orange Money a ete effectue avec succes. Votre solde:  21.09 FCFA.Trans id: MP260423.1339.79596324.',
      ),
    ).toMatchObject({ amount: 5000, balanceAfter: 21.09 });
    expect(
      om(
        'Votre paiement de 5,636.00 FCFA a ONEA ONEA ONEA a ete effectue avec succes. Votre solde est de : 233.59 Trans id: MP260812.0749.25703121.',
      )?.counterpartyName,
    ).toBe('ONEA');
    expect(
      om(
        'Votre paiement de 1,000.00 FCFA a ACCEPTEUR GD SKARLUB SKARLUB a ete effectue avec succes. Votre solde est de : 101290.59 FCFA. Trans id: MP260607.1919.95731485.',
      )?.counterpartyName,
    ).toBe('SKARLUB');
    expect(
      om(
        'Votre paiement de 1,200.00 FCFA a ACCEPTEUR GD SOUGR NOOMA SOUGR NOOMA a ete effectue avec succes. Votre solde est de : 6316.59 FCFA. Trans id: MP260325.1457.79375003.',
      )?.counterpartyName,
    ).toBe('SOUGR NOOMA');
  });

  test('recharge d’unités (bonus promo ignoré)', () => {
    expect(
      om(
        'Vous avez recharge 100.00 FCFA d unites. Gagnez 200% de bonus sur toutes premieres recharges Orange Money de moins de 10000F et 100% sur les autres recharges. Bonus valable 7 jours et utilisable vers tous les reseaux nationaux. Votre solde est de 8661.59 FCFA. TRANS ID: RC260314.2022.71382126. Rendez-vous sur Max it : http://urlz.fr/bpmE pour profiter de nos meilleures offres.',
      ),
    ).toMatchObject({
      type: 'AIRTIME_RECHARGE',
      amount: 100,
      balanceAfter: 8661.59,
      reference: 'RC260314.2022.71382126',
      ruleId: 'ORANGE_AIRTIME_UNITS',
    });
  });

  test('dépôt d’espèces chez un agent (Trans ID CI…) : Poche → MoMo', () => {
    expect(
      om(
        "Cher client, vous avez recu 2,500.00 FCFA de 5400001 NOUR SERVEX OUAGA. Votre solde est de 4976.59 FCFA. ID Trans: CI260315.1122.10341490. Merci d'utiliser Orange Money.",
      ),
    ).toMatchObject({
      type: 'AGENT_DEPOSIT',
      amount: 2500,
      agentCode: '5400001',
      counterpartyName: 'NOUR SERVEX OUAGA',
      balanceAfter: 4976.59,
    });
    expect(
      om(
        "Cher client, vous avez recu 15000.0 FCFA, Frais:  FCFA, Taxe:  FCFA de 6000002 TEELECOM ZOUNDI ET FRERE. Votre solde est de 17321.59 FCFA. ID Trans: CI260726.1908.45353472. Merci d'utiliser Orange Money.",
      ),
    ).toMatchObject({ type: 'AGENT_DEPOSIT', amount: 15000, counterpartyName: 'TEELECOM ZOUNDI ET FRERE' });
  });

  test('transferts internationaux envoyé / reçu', () => {
    expect(
      om(
        'Transfert avec succes de 3,100.00 FCFA au client MOOV Togo 22800000005., Frais : 40.4348 FCFA TransID : MP260422.1217.53531345',
      ),
    ).toMatchObject({
      type: 'EXPENSE',
      amount: 3100,
      fee: 40.4348,
      counterpartyName: 'MOOV Togo',
      counterpartyPhone: '22800000005',
      reference: 'MP260422.1217.53531345',
    });
    expect(
      om(
        'Transfert d argent de 8200 FCFA recu du +91000006 (Togo).\nNouveau solde OM : 10528.34 FCFA\nID : db7d6b3e\nOrange Money vous remercie.',
      ),
    ).toMatchObject({
      type: 'INCOME',
      amount: 8200,
      counterpartyPhone: '+91000006',
      counterpartyName: 'Transfert Togo',
      balanceAfter: 10528.34,
      reference: 'db7d6b3e',
    });
    expect(
      om('Transfert d argent de 5000 FCFA recu du +22500000009.\nNouveau solde OM : 6000 FCFA')?.counterpartyName,
    ).toBeUndefined();
  });

  test('envoi à un non-abonné (retrait par code)', () => {
    expect(
      om(
        'Vous avez envoy 125.00 FCFA  71000007. Votre solde est de 5088.34 FCFA. Trans ID PP260901.1411.42140919. Merci de bien vouloir contacter le destinataire pour un retrait dans 4 jours au plus.',
      ),
    ).toMatchObject({
      type: 'EXPENSE',
      amount: 125,
      counterpartyPhone: '71000007',
      balanceAfter: 5088.34,
      reference: 'PP260901.1411.42140919',
    });
  });

  test('retraits et paiements déjà reconnus : inchangés', () => {
    expect(
      om(
        'Vous avez retire 1,000,000.00 FCFA aupres de l agent 7700001 ANSV BORO DORO CELESATECH, Trans ID : CO261007.1628.28935352. Votre solde est de : 281007.94 FCFA. Telechargez la nouvelle application Orange Money : https://onelink.to/trqvq2',
      ),
    ).toMatchObject({
      type: 'CASH_WITHDRAWAL',
      amount: 1000000,
      balanceAfter: 281007.94,
      reference: 'CO261007.1628.28935352',
    });
    expect(
      om(
        'Vous avez recu 780.0 FCFA, Frais:  FCFA, Taxe:  FCFA du 55000008,MOHAMED. Le solde de votre compte est de 811.59 FCFA Trans ID: PP260715.1413.42144938.',
      ),
    ).toMatchObject({ type: 'INCOME', amount: 780, ruleId: 'ORANGE_TRANSFER_RECEIVED' });
  });
});

describe('cleanMerchantName', () => {
  test('préfixe ACCEPTEUR et répétitions retirés, noms simples conservés', () => {
    const { cleanMerchantName } = require('../src/data/parser/SmsParserEngine');
    expect(cleanMerchantName('ACCEPTEUR HD PHARMACIE AVE MARIA PHARMACIE AVE MARIA')).toBe('PHARMACIE AVE MARIA');
    expect(cleanMerchantName('BOUTIQUE SOUGR NOOMA SOUGR NOOMA')).toBe('BOUTIQUE SOUGR NOOMA');
    expect(cleanMerchantName('ACCEPTEUR GD SINARE ALLAYE ETS ABDOUL SAHA NOOMA')).toBe(
      'SINARE ALLAYE ETS ABDOUL SAHA NOOMA',
    );
    expect(cleanMerchantName('INTOUCH')).toBe('INTOUCH');
  });
});

const moov = (sms: string) => parseTransactionSms(sms, { sender: 'MOOV MONEY' });

describe('Étape 3 — Moov Money (formats réels)', () => {
  test('achat de crédit payé avec Moov Money (avec ou sans solde)', () => {
    expect(moov('Ref : DCP89MMSC0, Vous avez recu 600,00 FCFA de credit du 22670000001 via MOOV Money.')).toMatchObject(
      {
        provider: 'MOOV',
        type: 'AIRTIME_RECHARGE',
        amount: 600,
        counterpartyPhone: '22670000001',
        reference: 'DCP89MMSC0',
        airtimeKind: 'VOICE',
      },
    );
    const withBalance = moov(
      'Ref : DFN8EUTXGG, Vous avez recu 200,00 FCFA de credit du 22670000001 via MOOV Money. GAGNEZ 200% de bonus sur toutes vos recharges.Bonus valable 10 jours avec une periode de grace de 10 jours apres expiration. Votre solde est de 876,00 FCFA.',
    );
    expect(withBalance).toMatchObject({ amount: 200, balanceAfter: 876, ruleId: 'MOOV_CREDIT_PURCHASE' });
    const { proposeFor, EMPTY_LEARNED_STATE } = require('../src/domain/usecases/LearningQueue');
    const at = { sender: 'MOOV MONEY', receivedAt: '2026-06-23T23:42:00' };
    expect(proposeFor({ ...at, body: withBalance!.rawSms }, EMPTY_LEARNED_STATE).confidence).toBe(0.9);
    expect(
      proposeFor(
        { ...at, body: 'Ref : DEE9CI0KR7, Vous avez recu 450,00 FCFA de credit du 22601000005 via MOOV Money.' },
        EMPTY_LEARNED_STATE,
      ),
    ).toMatchObject({ confidence: 0.6, category: "Crédit d'appel & Data" });
  });

  test('dépôt d’argent chez un agent : Poche → MoMo', () => {
    expect(
      moov(
        "Depot d'argent reussi aupres de: FASO PHONE FASO PHONE\nCode agent: 0003485\nMontant: 12 000,00 FCFA\nTID: DCP99MZU2L\nSolde: 24 551,00 FCFA",
      ),
    ).toMatchObject({
      type: 'AGENT_DEPOSIT',
      amount: 12000,
      counterpartyName: 'FASO PHONE',
      agentCode: '0003485',
      balanceAfter: 24551,
      reference: 'DCP99MZU2L',
    });
    expect(
      moov(
        "Depot d'argent reussi aupres de: JUDITH TIENDREBEOGO\nCode agent: 0059948\nMontant: 1 000,00 FCFA\nTID: DI12J413KU\nDate: 01/09/2026 14:25:16\nSolde: 1 001,00 FCFA",
      ),
    ).toMatchObject({ amount: 1000, occurredAt: '2026-09-01T14:25:16', balanceAfter: 1001 });
  });

  test('transfert national', () => {
    expect(
      moov(
        "Transfert National reussi pour Samuel Bado.\nNuméro de mobile: 22661000002\nMontant: 20 200,00 FCFA \nFrais: 0,00 FCFA \nTotal: 20 200,00 FCFA\nDate: 25/03/2026 12:03:43\nTID: DCP09N1EJE\nSolde: 3 851,00 FCFA\nTéléchargez l'app Moov Money : https://moov-money.bf/app",
      ),
    ).toMatchObject({
      type: 'EXPENSE',
      amount: 20200,
      fee: 0,
      total: 20200,
      counterpartyName: 'Samuel Bado',
      counterpartyPhone: '22661000002',
      balanceAfter: 3851,
      reference: 'DCP09N1EJE',
      occurredAt: '2026-03-25T12:03:43',
    });
  });

  test('formats déjà reconnus (paiement marchand avec espace final, reçu, retrait, recharge d’un numéro)', () => {
    expect(
      moov(
        'Paiement reussi auprés du marchand SARL HUB \nMontant: 3 570,00 FCFA\nFrais: 0,00 FCFA\nTotal: 3 570,00 FCFA\nDate: 05/04/2026 23:47\nTID: DD55ABIPZB\nSolde: 281,00 FCFA',
      ),
    ).toMatchObject({ type: 'EXPENSE', amount: 3570, counterpartyName: 'SARL HUB', balanceAfter: 281 });
    expect(
      moov(
        "Vous avez reçu 30 000,00 FCFA de Alex Ouedraogo. \nNuméro: 22672000003\nDate: 15/05/2026 13:53:55\nTID: DEF7CJLV2H\nSolde: 30 056,00 FCFA\nTéléchargez l'app Moov Money : https://moov-money.bf/app",
      ),
    ).toMatchObject({ type: 'INCOME', amount: 30000, counterpartyName: 'Alex Ouedraogo', balanceAfter: 30056 });
    expect(
      moov(
        "Retrait reussi auprès de l'Agent GUIBRIL TIEMTORE\nCode d'agent: 0062623\nMontant: 25 000,00 FCFA \nFrais: 250,00 FCFA\nTotal: 25 250,00 FCFA\nDate: 19/05/2026 15:34:48\nTxn ID: DEJ9CRB7CF\nSolde: 4 206,00 FCFA",
      ),
    ).toMatchObject({ type: 'CASH_WITHDRAWAL', amount: 25000, fee: 250, total: 25250 });
    expect(
      moov(
        'Ref : DIN9KN8I7N, Vous avez rechargé le 22670000004 via Moov Money avec 550,00 FCFA de crédit. GAGNEZ 100% de bonus sur toutes vos recharges.Votre solde MOOV Money est de 11 856,00 FCFA.',
      ),
    ).toMatchObject({ type: 'AIRTIME_RECHARGE', amount: 550, balanceAfter: 11856 });
  });
});
