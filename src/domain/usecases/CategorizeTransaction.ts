import { CATEGORIES } from '../../core/categories';
import type { ParsedSms } from '../../data/parser/SmsParserEngine';

/** Mots-clés marchands courants en Afrique de l'Ouest → catégorie. */
const KEYWORD_RULES: ReadonlyArray<[RegExp, string]> = [
  [/\b(SONABEL|ONEA|CIE|SODECI|SENELEC|SDE|SEN'?EAU|CANAL|STARTIMES|INTOUCH|FACTURE|EDM)\b/i, CATEGORIES.BILLS],
  [
    /\b(TOTAL(?:ENERGIES)?|SHELL|OIL ?LIBYA|VIVO|STATION|PETRO(?:LE)?|CARBURANT|ESSENCE|SOMAP|SONABHY)\b/i,
    CATEGORIES.FUEL,
  ],
  [
    /\b(SUPER ?MARCH[EÉ]|MARINA|PRIX ?BAS|AUCHAN|CARREFOUR|CASINO|LEADER PRICE|MARCH[EÉ]|ALIMENTATION|BOUTIQUE|KIOSQUE)\b/i,
    CATEGORIES.GROCERIES,
  ],
  [/\b(RESTAU(?:RANT)?|MAQUIS|KFC|PIZZA|FAST ?FOOD|DIBITERIE|CAF[EÉ]|BAR|GRILL|CHICKEN|BURGER)\b/i, CATEGORIES.FOOD],
  [/\b(PHARMA(?:CIE)?|CLINIQUE|H[OÔ]PITAL|CSPS|CHU|LABO(?:RATOIRE)?|M[EÉ]DICAL)\b/i, CATEGORIES.HEALTH],
  [/\b([EÉ]COLE|LYC[EÉ]E|COLL[EÈ]GE|UNIVERSIT[EÉ]|INSTITUT|SCOLARIT[EÉ]|ISGE|2IE)\b/i, CATEGORIES.EDUCATION],
  [
    /\b(TAXI|YANGO|HEETCH|GOZEM|STAF|TCV|RAKIETA|SOTRACO|BUS|TRANSPORT|AIR ?BURKINA|AIR ?C[OÔ]TE)\b/i,
    CATEGORIES.TRANSPORT,
  ],
  [/\b(LOYER|BAILLEUR|IMMOBILIER|AGENCE IMMO)\b/i, CATEGORIES.RENT],
  [/\b(TONTINE)\b/i, CATEGORIES.TONTINE],
];

export const counterpartyKey = (p: {
  counterpartyPhone?: string;
  counterpartyName?: string;
  merchantOrRecipient?: string;
}): string | undefined => {
  const raw = p.counterpartyPhone ?? p.merchantOrRecipient ?? p.counterpartyName;
  return raw ? raw.toUpperCase().replace(/\s+/g, ' ').trim() : undefined;
};

/**
 * Catégorisation automatique. Priorité :
 * 1. type d'opération (crédit, retrait, revenu),
 * 2. catégories apprises des corrections de l'utilisateur,
 * 3. mots-clés marchands,
 * 4. transfert vers une personne (numéro de téléphone), sinon « Autre ».
 */
export const autoCategorize = (
  parsed: Pick<ParsedSms, 'type' | 'counterpartyName' | 'counterpartyPhone' | 'merchantOrRecipient'>,
  learned: Readonly<Record<string, string>> = {},
): string => {
  switch (parsed.type) {
    case 'AIRTIME_RECHARGE':
      return CATEGORIES.AIRTIME;
    case 'CASH_WITHDRAWAL':
      return CATEGORIES.CASH_WITHDRAWAL;
    case 'AGENT_DEPOSIT':
      return CATEGORIES.MOMO_DEPOSIT;
    case 'INCOME':
      return /\bSALAIRE|\bPAIE\b|\bSALARY/i.test(`${parsed.merchantOrRecipient ?? ''} ${parsed.counterpartyName ?? ''}`)
        ? CATEGORIES.SALARY
        : CATEGORIES.INCOME;
  }
  const key = counterpartyKey(parsed);
  if (key && learned[key]) {
    return learned[key];
  }
  const text = `${parsed.merchantOrRecipient ?? ''} ${parsed.counterpartyName ?? ''}`;
  const rule = KEYWORD_RULES.find(([re]) => re.test(text));
  if (rule) {
    return rule[1];
  }
  return parsed.counterpartyPhone ? CATEGORIES.TRANSFER : CATEGORIES.OTHER;
};
