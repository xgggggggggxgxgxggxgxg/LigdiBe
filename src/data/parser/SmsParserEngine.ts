import type { ParsedTransactionType, Provider } from '../../domain/models/Transaction';
import {
  cleanName,
  normalizeSms,
  parseAmount,
  parseAmountOrZero,
  parseFrenchDate,
  parseOrangeTransIdDate,
} from './textUtils';
import { isSensitiveSecuritySms, isWhitelistedSender, providerFromSender } from './securityFilters';

export interface ParsedSms {
  provider: Provider;
  type: ParsedTransactionType;
  amount: number;
  fee: number;
  tax: number;
  /** Montant total débité/crédité côté opérateur (montant + frais + taxes pour un débit). */
  total: number;
  balanceAfter?: number;
  reference?: string;
  counterpartyName?: string;
  counterpartyPhone?: string;
  merchantOrRecipient?: string;
  agentCode?: string;
  /** Date de l'opération telle qu'annoncée par l'opérateur (ISO local). */
  occurredAt?: string;
  currency: 'XOF';
  /** Identifiant de la règle ayant matché (débogage / télémétrie locale). */
  ruleId: string;
  rawSms: string;
}

export interface ParseOptions {
  /** Expéditeur du SMS. S'il est fourni, il doit figurer dans la whitelist. */
  sender?: string;
  /** Expéditeurs additionnels autorisés par l'utilisateur. */
  extraSenders?: ReadonlyArray<string>;
}

type Draft = Omit<ParsedSms, 'provider' | 'fee' | 'tax' | 'total' | 'currency' | 'ruleId' | 'rawSms'> &
  Partial<Pick<ParsedSms, 'fee' | 'tax' | 'total'>>;

interface ParserRule {
  id: string;
  /** Fournisseur fixe ; absent = règle générique, fournisseur déduit du contenu/expéditeur. */
  provider?: Provider;
  pattern: RegExp;
  build: (m: RegExpMatchArray, sms: string) => Draft;
}

/** Montant : chiffres avec séparateurs (espace, point, virgule). */
const AMT = '(\\d[\\d .,]*)';
/** Montant éventuellement vide (ex: "Frais:  FCFA"). */
const OPT_AMT = '([\\d .,]*)';
const CUR = '\\s*(?:FCFA|F\\s?CFA|XOF|F)\\b';

const field = (sms: string, re: RegExp): string | undefined => sms.match(re)?.[1];

// ---------- Champs communs Moov ("Clé: valeur" sur lignes séparées) ----------
const moovFee = (s: string) => parseAmountOrZero(field(s, new RegExp(`Frais\\s*:\\s*${OPT_AMT}${CUR}`, 'i')));
const moovTotal = (s: string) => parseAmount(field(s, new RegExp(`Total\\s*:\\s*${AMT}${CUR}`, 'i')));
const moovBalance = (s: string) =>
  parseAmount(field(s, new RegExp(`(?:Solde|Votre solde MOOV Money est de|Nouveau solde)\\s*:?\\s*${AMT}${CUR}`, 'i')));
const moovRef = (s: string) => field(s, /(?:TID|Txn ID|Trans ID|Ref)\s*:\s*([A-Z0-9]+)/i);
const moovDate = (s: string) => parseFrenchDate(field(s, /Date\s*:\s*([\d/]+\s+[\d:]+)/i));

// ---------- Champs communs Orange ----------
const orangeBalance = (s: string) =>
  parseAmount(
    field(
      s,
      new RegExp(`(?:Votre solde est de|Le solde de votre compte est de|Nouveau solde)\\s*:?\\s*${AMT}${CUR}`, 'i'),
    ),
  );
const orangeRef = (s: string) => field(s, /Trans(?:action)?\s*id\s*:\s*([A-Z0-9]+(?:\.[A-Z0-9]+)*)/i);

// ---------- Champs communs Wave / UBA ----------
const waveBalance = (s: string) => parseAmount(field(s, new RegExp(`Solde(?: Wave)?\\s*:\\s*${AMT}${CUR}`, 'i')));
const waveRef = (s: string) => field(s, /Avec UBA\s+([A-Za-z0-9-]+)/i);
const waveDate = (s: string) => parseFrenchDate(field(s, /(\d{2}\/\d{2}\/\d{4}\s*(?:à|a)?\s*\d{1,2}:\d{2})/));

const withOrangeDate = (d: Draft): Draft => ({ ...d, occurredAt: parseOrangeTransIdDate(d.reference) });

const RULES: ReadonlyArray<ParserRule> = [
  // ===================== MOOV MONEY =====================
  {
    id: 'MOOV_MERCHANT_PAYMENT',
    provider: 'MOOV',
    pattern: /Paiement r[ée]ussi aupr[èéeê]s du marchand ([^\n]+)\n/i,
    build: (m, s) => {
      const merchant = cleanName(m[1]);
      return {
        type: 'EXPENSE',
        amount: parseAmountOrZero(field(s, new RegExp(`Montant\\s*:\\s*${AMT}${CUR}`, 'i'))),
        fee: moovFee(s),
        total: moovTotal(s),
        merchantOrRecipient: merchant,
        counterpartyName: merchant,
        balanceAfter: moovBalance(s),
        reference: moovRef(s),
        occurredAt: moovDate(s),
      };
    },
  },
  {
    id: 'MOOV_AGENT_WITHDRAWAL',
    provider: 'MOOV',
    pattern: /Retrait r[ée]ussi aupr[èéeê]s de l'Agent ([^\n]+)\n/i,
    build: (m, s) => ({
      type: 'CASH_WITHDRAWAL',
      amount: parseAmountOrZero(field(s, new RegExp(`Montant\\s*:\\s*${AMT}${CUR}`, 'i'))),
      fee: moovFee(s),
      total: moovTotal(s),
      counterpartyName: cleanName(m[1]),
      agentCode: field(s, /Code d'agent\s*:\s*(\d+)/i),
      balanceAfter: moovBalance(s),
      reference: moovRef(s),
      occurredAt: moovDate(s),
    }),
  },
  {
    id: 'MOOV_AGENT_DEPOSIT',
    provider: 'MOOV',
    pattern: /D[ée]p[ôo]t r[ée]ussi aupr[èéeê]s de l'Agent ([^\n]+)\n/i,
    build: (m, s) => ({
      type: 'AGENT_DEPOSIT',
      amount: parseAmountOrZero(field(s, new RegExp(`Montant\\s*:\\s*${AMT}${CUR}`, 'i'))),
      fee: moovFee(s),
      counterpartyName: cleanName(m[1]),
      agentCode: field(s, /Code d'agent\s*:\s*(\d+)/i),
      balanceAfter: moovBalance(s),
      reference: moovRef(s),
      occurredAt: moovDate(s),
    }),
  },
  {
    id: 'MOOV_TRANSFER_RECEIVED',
    provider: 'MOOV',
    pattern: new RegExp(`Vous avez re[çc]u ${AMT}${CUR} de ([^\\n]+)\\n\\s*Num[ée]ro\\s*:\\s*\\+?(\\d+)`, 'i'),
    build: (m, s) => ({
      type: 'INCOME',
      amount: parseAmountOrZero(m[1]),
      counterpartyName: cleanName(m[2]),
      counterpartyPhone: m[3],
      balanceAfter: moovBalance(s),
      reference: moovRef(s),
      occurredAt: moovDate(s),
    }),
  },
  {
    id: 'MOOV_AIRTIME_RECHARGE',
    provider: 'MOOV',
    pattern: new RegExp(`Vous avez recharg[ée] le \\+?(\\d+) via Moov Money avec ${AMT}${CUR}`, 'i'),
    build: (m, s) => ({
      type: 'AIRTIME_RECHARGE',
      amount: parseAmountOrZero(m[2]),
      counterpartyPhone: m[1],
      balanceAfter: moovBalance(s),
      reference: moovRef(s),
    }),
  },

  // ===================== ORANGE MONEY =====================
  {
    id: 'ORANGE_PAYMENT',
    provider: 'ORANGE',
    pattern: new RegExp(
      `Votre paiement de ${AMT}${CUR},\\s*Frais\\s*:\\s*${OPT_AMT}${CUR},\\s*Taxe\\s*:\\s*${OPT_AMT}${CUR}\\s*(?:a|à)\\s+(.+?)\\s+a [ée]t[ée] effectu[ée]`,
      'i',
    ),
    build: (m, s) => {
      const name = cleanName(m[4]);
      return withOrangeDate({
        type: 'EXPENSE',
        amount: parseAmountOrZero(m[1]),
        fee: parseAmountOrZero(m[2]),
        tax: parseAmountOrZero(m[3]),
        counterpartyName: name,
        merchantOrRecipient: name,
        balanceAfter: orangeBalance(s),
        reference: orangeRef(s),
      });
    },
  },
  {
    id: 'ORANGE_TRANSFER_RECEIVED',
    provider: 'ORANGE',
    pattern: new RegExp(
      `Vous avez re[çc]u ${AMT}${CUR},\\s*Frais\\s*:\\s*${OPT_AMT}${CUR},\\s*Taxe\\s*:\\s*${OPT_AMT}${CUR}\\s*du\\s+\\+?(\\d+)\\s*,\\s*([^.\\n]+)`,
      'i',
    ),
    build: (m, s) =>
      withOrangeDate({
        type: 'INCOME',
        amount: parseAmountOrZero(m[1]),
        fee: parseAmountOrZero(m[2]),
        tax: parseAmountOrZero(m[3]),
        counterpartyPhone: m[4],
        counterpartyName: cleanName(m[5]),
        balanceAfter: orangeBalance(s),
        reference: orangeRef(s),
      }),
  },
  {
    id: 'ORANGE_AGENT_WITHDRAWAL',
    provider: 'ORANGE',
    pattern: new RegExp(`Vous avez retir[ée] ${AMT}${CUR} aupr[èe]s de l['\\s]?\\s*agent\\s+([^,\\n]+)`, 'i'),
    build: (m, s) => {
      const agent = cleanName(m[2]);
      return withOrangeDate({
        type: 'CASH_WITHDRAWAL',
        amount: parseAmountOrZero(m[1]),
        fee: parseAmountOrZero(field(s, new RegExp(`Frais\\s*:\\s*${OPT_AMT}${CUR}`, 'i'))),
        counterpartyName: agent,
        agentCode: field(agent, /^(\d+)\s/),
        balanceAfter: orangeBalance(s),
        reference: orangeRef(s),
      });
    },
  },

  {
    id: 'ORANGE_AGENT_DEPOSIT',
    provider: 'ORANGE',
    pattern: new RegExp(
      `(?:re[çc]u un d[ée]p[ôo]t de|D[ée]p[ôo]t de) ${AMT}${CUR}[^\\n]*?(?:de|par) l['\\s]?\\s*agent\\s+([^,.\\n]+)`,
      'i',
    ),
    build: (m, s) => {
      const agent = cleanName(m[2]);
      return withOrangeDate({
        type: 'AGENT_DEPOSIT',
        amount: parseAmountOrZero(m[1]),
        counterpartyName: agent,
        agentCode: field(agent, /^(\d+)\s/),
        balanceAfter: orangeBalance(s),
        reference: orangeRef(s),
      });
    },
  },

  // ===================== WAVE / UBA =====================
  {
    id: 'WAVE_RECEIVED',
    provider: 'UBA_WAVE',
    pattern: new RegExp(`Vous avez re[çc]u ${AMT}${CUR} De (.+?)\\s*\\((\\+?\\d+)\\)`, 'i'),
    build: (m, s) => ({
      type: 'INCOME',
      amount: parseAmountOrZero(m[1]),
      counterpartyName: cleanName(m[2]),
      counterpartyPhone: m[3],
      balanceAfter: waveBalance(s),
      reference: waveRef(s),
      occurredAt: waveDate(s),
    }),
  },
  {
    // « retiré chez <marchand> » : sortie d'argent chez un point marchand Wave.
    id: 'WAVE_WITHDRAWN_AT_MERCHANT',
    provider: 'UBA_WAVE',
    pattern: new RegExp(`Vous avez retir[ée] ${AMT}${CUR} chez (.+?) le \\d{2}/`, 'i'),
    build: (m, s) => {
      const name = cleanName(m[2]);
      return {
        type: 'EXPENSE',
        amount: parseAmountOrZero(m[1]),
        counterpartyName: name,
        merchantOrRecipient: name,
        balanceAfter: waveBalance(s),
        reference: waveRef(s),
        occurredAt: waveDate(s),
      };
    },
  },
  {
    id: 'WAVE_AGENT_DEPOSIT',
    provider: 'UBA_WAVE',
    pattern: new RegExp(`Vous avez d[ée]pos[ée] ${AMT}${CUR} chez (.+?)(?: le \\d{2}/|\\.|$)`, 'im'),
    build: (m, s) => ({
      type: 'AGENT_DEPOSIT',
      amount: parseAmountOrZero(m[1]),
      counterpartyName: cleanName(m[2]),
      balanceAfter: waveBalance(s),
      reference: waveRef(s),
      occurredAt: waveDate(s),
    }),
  },
  {
    id: 'WAVE_PAYMENT',
    provider: 'UBA_WAVE',
    pattern: new RegExp(`Vous avez pay[ée] ${AMT}${CUR} (?:à|a|chez) (.+?)(?: le \\d{2}/|\\.|$)`, 'im'),
    build: (m, s) => {
      const name = cleanName(m[2]);
      return {
        type: 'EXPENSE',
        amount: parseAmountOrZero(m[1]),
        counterpartyName: name,
        merchantOrRecipient: name,
        balanceAfter: waveBalance(s),
        reference: waveRef(s),
        occurredAt: waveDate(s),
      };
    },
  },

  // ===================== RÈGLES GÉNÉRIQUES (tous opérateurs) =====================
  {
    id: 'GENERIC_TRANSFER_SENT',
    pattern: new RegExp(
      `Vous avez (?:envoy[ée]|transf[ée]r[ée]) ${AMT}${CUR} (?:à|a|au|vers)\\s+(?:le\\s+)?(\\+?\\d{8,})?\\s*,?\\s*([^.\\n]*)`,
      'i',
    ),
    build: (m, s) => {
      const name = cleanName(m[3]);
      return {
        type: 'EXPENSE',
        amount: parseAmountOrZero(m[1]),
        fee: parseAmountOrZero(field(s, new RegExp(`Frais\\s*:\\s*${OPT_AMT}${CUR}`, 'i'))),
        counterpartyPhone: m[2],
        counterpartyName: name.length > 0 ? name : undefined,
        merchantOrRecipient: name.length > 0 ? name : m[2],
        balanceAfter: parseAmount(field(s, new RegExp(`solde[^\\d]{0,30}${AMT}${CUR}`, 'i'))),
        reference: field(s, /(?:Trans(?:action)?\s*id|TID|Txn ID|Ref)\s*:\s*([A-Z0-9]+(?:\.[A-Z0-9]+)*)/i),
        occurredAt: parseFrenchDate(s),
      };
    },
  },
  {
    id: 'GENERIC_AIRTIME',
    pattern: new RegExp(
      `(?:recharg[ée]|achat (?:de |d'un )?(?:cr[ée]dit|forfait|pass)|(?:forfait|pass) (?:internet|data|appel))[^\\n]*?${AMT}${CUR}`,
      'i',
    ),
    build: (m, s) => ({
      type: 'AIRTIME_RECHARGE',
      amount: parseAmountOrZero(m[1]),
      balanceAfter: parseAmount(field(s, new RegExp(`solde[^\\d]{0,40}${AMT}${CUR}`, 'i'))),
      reference: field(s, /(?:Trans(?:action)?\s*id|TID|Txn ID|Ref)\s*:\s*([A-Z0-9]+(?:\.[A-Z0-9]+)*)/i),
    }),
  },
];

const CONTENT_PROVIDERS: ReadonlyArray<[RegExp, Provider]> = [
  [/orange/i, 'ORANGE'],
  [/moov/i, 'MOOV'],
  [/\bwave\b|\buba\b/i, 'UBA_WAVE'],
  [/telecel/i, 'TELECEL'],
  [/ecobank/i, 'ECOBANK'],
];

const detectProvider = (sms: string, sender?: string): Provider | undefined => {
  const fromSender = sender ? providerFromSender(sender) : undefined;
  if (fromSender) {
    return fromSender;
  }
  return CONTENT_PROVIDERS.find(([re]) => re.test(sms))?.[1];
};

const round = (n: number): number => Math.round(n * 10000) / 10000;

/**
 * Analyse un SMS transactionnel. Retourne `null` si :
 * - l'expéditeur fourni n'est pas dans la whitelist,
 * - le SMS contient un code de sécurité (OTP / PIN / 2FA),
 * - aucun format connu ne correspond ou le montant est nul.
 */
export const parseTransactionSms = (rawSms: string, options: ParseOptions = {}): ParsedSms | null => {
  if (options.sender !== undefined && !isWhitelistedSender(options.sender, options.extraSenders)) {
    return null;
  }
  const sms = normalizeSms(rawSms);
  if (sms.length === 0 || isSensitiveSecuritySms(sms)) {
    return null;
  }
  for (const rule of RULES) {
    const m = sms.match(rule.pattern);
    if (!m) {
      continue;
    }
    const provider = rule.provider ?? detectProvider(sms, options.sender);
    if (!provider) {
      continue;
    }
    const draft = rule.build(m, sms);
    if (!(draft.amount > 0)) {
      continue;
    }
    const fee = draft.fee ?? 0;
    const tax = draft.tax ?? 0;
    const isDebit = draft.type !== 'INCOME' && draft.type !== 'AGENT_DEPOSIT';
    const total = draft.total ?? round(isDebit ? draft.amount + fee + tax : draft.amount);
    return stripUndefined<ParsedSms>({
      ...draft,
      provider,
      fee,
      tax,
      total,
      currency: 'XOF',
      ruleId: rule.id,
      rawSms,
    });
  }
  return null;
};

const stripUndefined = <T extends object>(obj: T): T =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
