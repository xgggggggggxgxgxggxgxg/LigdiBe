import { fingerprint } from '../../core/id';
import { isInformationalSms } from '../../data/parser/informationalFilters';
import { normalizeSms, parseAmount } from '../../data/parser/textUtils';

/**
 * SMS d'un expéditeur agréé que le moteur n'a pas su analyser (nouveau format
 * opérateur, banque…). Conservé localement pour une saisie manuelle en un tap,
 * plutôt que perdu en silence.
 */
export interface UnrecognizedSms {
  id: string;
  sender: string;
  body: string;
  /** Montant pressenti (premier montant suivi d'une devise), pour pré-remplir la saisie. */
  suggestedAmount?: number;
  /** Sens pressenti de l'opération. */
  suggestedType?: 'EXPENSE' | 'INCOME';
  receivedAt: string;
}

export const UNRECOGNIZED_SMS_KEY = 'unrecognizedSms';
export const MAX_UNRECOGNIZED_SMS = 30;

const AMOUNT_WITH_CURRENCY = /(\d[\d .,]*)\s*(?:FCFA|F\s?CFA|XOF|XAF|F)\b/i;
const MONEY_KEYWORDS =
  /\b(?:re[çc]u|envoy[ée]|transf[ée]r|paiement|pay[ée]|retir[ée]|retrait|d[ée]p[ôo]t|d[ée]bit[ée]?|cr[ée]dit[ée]?|solde|montant|achat|facture)/i;
/** Messages promotionnels : un montant y figure souvent sans opération réelle. */
const PROMO_KEYWORDS =
  /\b(?:gagnez|gagner|promo|offre|bonus de|tentez|remporter|jeu concours|profitez|composez le|tapez \*|cliquez|stop sms|qui co[uû]te)/i;

/** Un SMS ressemble à une opération financière : un montant en devise + un verbe d'opération, sans promo. */
export const looksLikeFinancialSms = (body: string): boolean => {
  const sms = normalizeSms(body);
  return (
    AMOUNT_WITH_CURRENCY.test(sms) && MONEY_KEYWORDS.test(sms) && !PROMO_KEYWORDS.test(sms) && !isInformationalSms(sms)
  );
};

const INCOME_HINT = /\b(?:re[çc]u|cr[ée]dit[ée]|d[ée]p[ôo]t (?:re[çc]u|sur votre compte))/i;

export const toUnrecognizedSms = (body: string, sender: string, receivedAt: string): UnrecognizedSms => {
  const sms = normalizeSms(body);
  const amount = parseAmount(sms.match(AMOUNT_WITH_CURRENCY)?.[1]);
  return {
    id: `sms_${fingerprint(body)}`,
    sender,
    body,
    suggestedAmount: amount && amount > 0 ? amount : undefined,
    suggestedType: INCOME_HINT.test(sms) ? 'INCOME' : 'EXPENSE',
    receivedAt,
  };
};

/** Ajoute en tête de file (sans doublon), en gardant les `max` plus récents. */
export const enqueueUnrecognized = (
  queue: ReadonlyArray<UnrecognizedSms>,
  item: UnrecognizedSms,
  max = MAX_UNRECOGNIZED_SMS,
): UnrecognizedSms[] => {
  if (queue.some(q => q.id === item.id)) {
    return [...queue];
  }
  return [item, ...queue].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).slice(0, max);
};
