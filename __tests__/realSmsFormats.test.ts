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
