/**
 * SMS d'opérateurs agréés qui ne sont PAS des opérations : soldes consultés,
 * demandes de paiement en attente, échecs, notifications de doublon, crédit
 * d'appel offert par un tiers… Ils ne sont ni enregistrés ni proposés au classement.
 * Formats relevés sur de vrais SMS Orange Money, Moov Money, Wave et Ecobank (Burkina Faso).
 */
const INFORMATIONAL_PATTERNS: ReadonlyArray<RegExp> = [
  // Consultations de solde (Orange « Le solde de votre Compte Normal est de… », Moov « Votre solde Compte Principal… »)
  /^\s*Le solde de votre Compte Normal/i,
  /^\s*Votre solde Compte Principal/i,
  // Demande de paiement à valider (pas encore payé)
  /\bdemande de paiement\b/i,
  /\bVeuillez composer\b/i,
  // Échecs et refus
  /\bhas failed\b|\ba [ée]chou[ée]\b|\b[ée]chec de\b/i,
  /\bne pouvons pas traiter\b/i,
  /\bpas suffisamment d'argent\b|\bsolde insuffisant\b/i,
  // Crédit d'appel / unités reçus d'un tiers : aucun argent ne sort du portefeuille
  /\bVous avez re[çc]u du \+?\d+,\s*[\d.,]+\s*FCFA d\s?['’]?unit[ée]s/i,
  // Détail de facture doublant le SMS de paiement (même ID Trans)
  /^\s*Votre paiement de facture a [ée]t[ée] effectu[ée]/i,
  // Recharge de carte virtuelle doublant le débit du compte
  /\bCarte Virtuelle se terminant par\b/i,
  // Restauration / modification de compte
  /\brestauration est effectu[ée]e\b|\bmodification de votre compte\b/i,
];

export const isInformationalSms = (body: string): boolean => INFORMATIONAL_PATTERNS.some(p => p.test(body));
