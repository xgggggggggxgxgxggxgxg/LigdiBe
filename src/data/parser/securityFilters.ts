import type { Provider } from '../../domain/models/Transaction';

/**
 * Whitelist des expéditeurs agréés (comparaison sur une forme normalisée :
 * majuscules, sans espaces ni ponctuation). Tout SMS d'un autre expéditeur est ignoré.
 */
const SENDER_PROVIDERS: Record<string, Provider> = {
  ORANGEMONEY: 'ORANGE',
  ORANGE: 'ORANGE',
  OM: 'ORANGE',
  ORANGEBF: 'ORANGE',
  ORANGECI: 'ORANGE',
  ORANGESN: 'ORANGE',
  MOOVMONEY: 'MOOV',
  MOOV: 'MOOV',
  MOOVAFRICA: 'MOOV',
  FLOOZ: 'MOOV',
  WAVE: 'UBA_WAVE',
  UBA: 'UBA_WAVE',
  UBAGROUP: 'UBA_WAVE',
  ECOBANK: 'ECOBANK',
  TELECEL: 'TELECEL',
  TELECELMONEY: 'TELECEL',
  TELMOB: 'TELECEL',
  CORISBANK: 'BANK',
  CORISMONEY: 'BANK',
  SGBF: 'BANK',
  SGCI: 'BANK',
  BOA: 'BANK',
  BICIAB: 'BANK',
  ORABANK: 'BANK',
  SANKMONEY: 'BANK',
};

export const normalizeSender = (sender: string): string =>
  sender.toUpperCase().replace(/[^A-Z0-9]/g, '');

export const providerFromSender = (sender: string): Provider | undefined =>
  SENDER_PROVIDERS[normalizeSender(sender)];

export const isWhitelistedSender = (
  sender: string,
  extraSenders: ReadonlyArray<string> = [],
): boolean => {
  const key = normalizeSender(sender);
  if (key.length === 0) {
    return false;
  }
  return key in SENDER_PROVIDERS || extraSenders.map(normalizeSender).includes(key);
};

/**
 * Détecte les SMS sensibles (OTP, 2FA, code PIN, mot de passe) qui ne doivent
 * JAMAIS être analysés ni stockés. « Code d'agent » n'est pas un secret.
 */
const SENSITIVE_PATTERNS: ReadonlyArray<RegExp> = [
  /\bOTP\b/i,
  /\b2FA\b/i,
  /\bcode\s*PIN\b/i,
  /\bPIN\b/,
  /\bmot\s+de\s+passe\b/i,
  /\bpassword\b/i,
  /\bcode\s+(?:secret|temporaire|unique|d'activation|de\s+(?:v[ée]rification|confirmation|s[ée]curit[ée]|validation|connexion))\b/i,
  /\bvotre\s+code\s*(?:est|:)/i,
  /\bne\s+(?:le\s+)?(?:communiquez|partagez|divulguez)\b/i,
  /\bverification\s+code\b/i,
];

export const isSensitiveSecuritySms = (body: string): boolean =>
  SENSITIVE_PATTERNS.some(p => p.test(body));
