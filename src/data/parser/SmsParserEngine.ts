import type { ParsedTransactionType, Provider } from '../../domain/models/Transaction';
import {
  cleanName,
  normalizeSms,
  parseAmount,
  parseAmountOrZero,
  parseDataVolumeMb,
  parseFrenchDate,
  parseOrangeTransIdDate,
  parseValidityDays,
} from './textUtils';
import { isInformationalSms } from './informationalFilters';
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
  /** Recharge : crédit d'appel (VOICE) ou forfait internet (DATA). */
  airtimeKind?: 'VOICE' | 'DATA';
  /** Forfait internet : volume en Mo. */
  dataVolumeMb?: number;
  /** Forfait internet : validité en jours. */
  dataValidityDays?: number;
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
const orangeRef = (s: string) =>
  field(
    s,
    /(?:Trans(?:action)?\s*id|ID\s*Trans|TransID)\s*:?\s*([A-Z]{2}\d{6}\.[A-Z0-9]+(?:\.[A-Z0-9]+)*|[A-Z0-9]+(?:\.[A-Z0-9]+)*)/i,
  );
/** Solde Orange même sans devise : « Votre solde est de : 8761.59 Trans id », « Votre solde: 2746.59 FCFA. » */
const orangeLooseBalance = (s: string) =>
  orangeBalance(s) ?? parseAmount(field(s, /(?:Votre solde(?: est de)?|Nouveau solde OM)\s*:?\s*(\d[\d.,]*\d|\d)/i));
/** « ACCEPTEUR GD PHARMACIE LENDIMI PHARMACIE LENDIMI » → « PHARMACIE LENDIMI ». */
export const cleanMerchantName = (value: string): string => {
  const words = cleanName(value)
    .replace(/^ACCEPTEUR\s+[A-Z]{2}\s+/i, '')
    .split(' ');
  for (let k = 1; k <= words.length / 2; k++) {
    if (words.length % k === 0 && words.every((w, i) => w.toUpperCase() === words[i % k].toUpperCase())) {
      return words.slice(0, k).join(' ');
    }
  }
  const half = Math.floor(words.length / 2);
  // « SOUGR NOOMA SOUGR NOOMA » ou « X Y Z Y Z » : on retire la répétition finale
  for (let k = half; k >= 1; k--) {
    const tail = words.slice(-k).join(' ').toUpperCase();
    const before = words
      .slice(-2 * k, -k)
      .join(' ')
      .toUpperCase();
    if (tail === before) {
      return words.slice(0, words.length - k).join(' ');
    }
  }
  return words.join(' ');
};
const FEES_TAX = `(?:,\\s*Frais\\s*:\\s*${OPT_AMT}${CUR},\\s*Taxe\\s*:\\s*${OPT_AMT}${CUR})?`;

// ---------- Champs communs Wave / UBA ----------
const waveBalance = (s: string) => parseAmount(field(s, new RegExp(`Solde(?: Wave)?\\s*:\\s*${AMT}${CUR}`, 'i')));
const waveRef = (s: string) => field(s, /Avec UBA\s+([A-Za-z0-9-]+)/i);
const waveDate = (s: string) => parseFrenchDate(field(s, /(\d{2}\/\d{2}\/\d{4}\s*(?:à|a)?\s*\d{1,2}:\d{2})/));

/** Forfait débité du crédit d'appel / solde principal. */
const PAID_WITH_CREDIT =
  /(?:cr[ée]dit (?:principal|de communication|d'appel)|solde (?:principal|cr[ée]dit|d'appel|de communication|unit[ée]s)|compte principal|d[ée]bit[ée]e? (?:de|sur) (?:votre|ton) cr[ée]dit|avec (?:votre|ton) cr[ée]dit)/i;
/** Paiement par portefeuille électronique : c'est une vraie sortie d'argent. */
const MONEY_WALLET = /\b(?:money|wave|flooz|momo)\b/i;
const DATA_HINT = /\b(?:internet|data|web)\b|\d\s*(?:Go|Mo|GB|MB|To)\b/i;

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

  // ---- Formats Moov Money BF relevés sur de vrais SMS (2026) ----
  {
    // « Ref : DCP89MMSC0, Vous avez recu 600,00 FCFA de credit du 22671956255 via MOOV Money. [… Votre solde est de 876,00 FCFA.] »
    // Achat de crédit d'appel payé avec Moov Money (le solde Money baisse du même montant).
    id: 'MOOV_CREDIT_PURCHASE',
    provider: 'MOOV',
    pattern: new RegExp(`Vous avez re[çc]u ${AMT}${CUR} de cr[ée]dit du\\s+\\+?(\\d{8,}) via MOOV Money`, 'i'),
    build: (m, s) => ({
      type: 'AIRTIME_RECHARGE',
      amount: parseAmountOrZero(m[1]),
      counterpartyPhone: m[2],
      balanceAfter: parseAmount(field(s, new RegExp(`Votre solde est de\\s*:?\\s*${AMT}${CUR}`, 'i'))),
      reference: moovRef(s),
    }),
  },
  {
    // « Depot d'argent reussi aupres de: FASO PHONE FASO PHONE\nCode agent: 0003485\nMontant: 12 000,00 FCFA\nTID: …\nSolde: … »
    id: 'MOOV_CASH_DEPOSIT',
    provider: 'MOOV',
    pattern: /D[ée]p[ôo]t d['\s]?argent r[ée]ussi aupr[èéeê]s de\s*:\s*([^\n]+)\n/i,
    build: (m, s) => ({
      type: 'AGENT_DEPOSIT',
      amount: parseAmountOrZero(field(s, new RegExp(`Montant\\s*:\\s*${AMT}${CUR}`, 'i'))),
      counterpartyName: cleanMerchantName(m[1]),
      agentCode: field(s, /Code (?:d')?agent\s*:\s*(\d+)/i),
      balanceAfter: moovBalance(s),
      reference: moovRef(s),
      occurredAt: moovDate(s),
    }),
  },
  {
    // « Transfert National reussi pour NOM.\nNuméro de mobile: 226…\nMontant: …\nFrais: …\nTotal: …\nDate: …\nTID: …\nSolde: … »
    id: 'MOOV_NATIONAL_TRANSFER',
    provider: 'MOOV',
    pattern: /Transfert National r[ée]ussi pour ([^\n]+?)\.?\s*\n\s*Num[ée]ro de mobile\s*:\s*\+?(\d+)/i,
    build: (m, s) => {
      const name = cleanName(m[1]);
      return {
        type: 'EXPENSE',
        amount: parseAmountOrZero(field(s, new RegExp(`Montant\\s*:\\s*${AMT}${CUR}`, 'i'))),
        fee: moovFee(s),
        total: moovTotal(s),
        counterpartyName: name,
        counterpartyPhone: m[2],
        merchantOrRecipient: name,
        balanceAfter: moovBalance(s),
        reference: moovRef(s),
        occurredAt: moovDate(s),
      };
    },
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

  // ---- Formats Orange Money BF relevés sur de vrais SMS (2026) ----
  {
    // « Cher client, vous avez recu 2,500.00 FCFA de 5446191 NOUR SERVEX OUAGA. … ID Trans: CI… » : dépôt d'espèces chez un agent.
    id: 'ORANGE_CASH_IN',
    provider: 'ORANGE',
    pattern: new RegExp(`vous avez re[çc]u ${AMT}${CUR}${FEES_TAX}\\s+de (\\d{6,7}) ([^\\n]+?)\\.\\s*Votre solde`, 'i'),
    build: (m, s) =>
      withOrangeDate({
        type: 'AGENT_DEPOSIT',
        amount: parseAmountOrZero(m[1]),
        counterpartyName: cleanName(m[5]),
        agentCode: m[4],
        balanceAfter: orangeLooseBalance(s),
        reference: orangeRef(s),
      }),
  },
  {
    // « Vous avez recu 4,000.00 FCFA du 05298812,NOM. Le solde de votre compte est de … » (sans frais)
    id: 'ORANGE_RECEIVED_SIMPLE',
    provider: 'ORANGE',
    pattern: new RegExp(`Vous avez re[çc]u ${AMT}${CUR}\\s+du\\s+\\+?(\\d{8,})\\s*,\\s*([^.\\n]+)`, 'i'),
    build: (m, s) =>
      withOrangeDate({
        type: 'INCOME',
        amount: parseAmountOrZero(m[1]),
        counterpartyPhone: m[2],
        counterpartyName: cleanName(m[3]),
        balanceAfter: orangeLooseBalance(s),
        reference: orangeRef(s),
      }),
  },
  {
    // « Cher client, vous avez transfere 200.00 FCFA[, Frais: 0.0 FCFA, Taxe:  FCFA] au numero 56759245,francois. Votre solde est de … »
    id: 'ORANGE_TRANSFER_SENT',
    provider: 'ORANGE',
    pattern: new RegExp(
      `vous avez transf[ée]r[ée] ${AMT}${CUR}${FEES_TAX}\\s+au num[ée]ro\\s+\\+?(\\d{8,})\\s*,\\s*([^\\n]+?)\\.\\s*Votre solde`,
      'i',
    ),
    build: (m, s) =>
      withOrangeDate({
        type: 'EXPENSE',
        amount: parseAmountOrZero(m[1]),
        fee: parseAmountOrZero(m[2]),
        tax: parseAmountOrZero(m[3]),
        counterpartyPhone: m[4],
        counterpartyName: cleanName(m[5]),
        merchantOrRecipient: cleanName(m[5]),
        balanceAfter: orangeLooseBalance(s),
        reference: orangeRef(s),
      }),
  },
  {
    // « Votre paiement de 100.00 FCFA a UNITE AIRTIME a ete effectue avec succes. Votre solde est de : 8761.59 Trans id: … »
    id: 'ORANGE_PAYMENT_SIMPLE',
    provider: 'ORANGE',
    pattern: new RegExp(`Votre paiement de\\s+${AMT}${CUR}\\s+(?:a|à)\\s+(.+?)\\s+a [ée]t[ée] effectu[ée]`, 'i'),
    build: (m, s) => {
      const name = cleanMerchantName(m[2]);
      const airtime = /^UNITE AIRTIME$/i.test(name);
      return withOrangeDate({
        type: airtime ? 'AIRTIME_RECHARGE' : 'EXPENSE',
        amount: parseAmountOrZero(m[1]),
        counterpartyName: airtime ? undefined : name,
        merchantOrRecipient: airtime ? undefined : name,
        balanceAfter: orangeLooseBalance(s),
        reference: orangeRef(s),
      });
    },
  },
  {
    // « Vous avez recharge 100.00 FCFA d unites. … Votre solde est de 8661.59 FCFA. TRANS ID: RC… »
    id: 'ORANGE_AIRTIME_UNITS',
    provider: 'ORANGE',
    pattern: new RegExp(`Vous avez recharg[ée] ${AMT}${CUR} d\\s?['’]?unit[ée]s`, 'i'),
    build: (m, s) =>
      withOrangeDate({
        type: 'AIRTIME_RECHARGE',
        amount: parseAmountOrZero(m[1]),
        balanceAfter: orangeLooseBalance(s),
        reference: orangeRef(s),
      }),
  },
  {
    // « Transfert avec succes de 3,100.00 FCFA au client MOOV Togo 22870776985., Frais : 40.4348 FCFA TransID : MP… »
    id: 'ORANGE_INTERNATIONAL_SENT',
    provider: 'ORANGE',
    pattern: new RegExp(
      `Transfert avec succ[eè]s de ${AMT}${CUR} au client (.+?)\\s+(\\+?\\d{8,})\\.?,?\\s*Frais\\s*:\\s*${OPT_AMT}${CUR}`,
      'i',
    ),
    build: (m, s) =>
      withOrangeDate({
        type: 'EXPENSE',
        amount: parseAmountOrZero(m[1]),
        fee: parseAmountOrZero(m[4]),
        counterpartyName: cleanName(m[2]),
        counterpartyPhone: m[3],
        merchantOrRecipient: cleanName(m[2]),
        balanceAfter: orangeLooseBalance(s),
        reference: orangeRef(s),
      }),
  },
  {
    // « Transfert d argent de 8200 FCFA recu du +91569290 (Togo). Nouveau solde OM : 10528.34 FCFA ID : db7d6b3e »
    id: 'ORANGE_INTERNATIONAL_RECEIVED',
    provider: 'ORANGE',
    pattern: new RegExp(
      `Transfert d['\\s]?argent de ${AMT}${CUR} re[çc]u du\\s+(\\+?\\d{6,})\\s*(?:\\(([^)]+)\\))?`,
      'i',
    ),
    build: (m, s) => ({
      type: 'INCOME',
      amount: parseAmountOrZero(m[1]),
      counterpartyPhone: m[2],
      counterpartyName: m[3] ? `Transfert ${cleanName(m[3])}` : undefined,
      balanceAfter: orangeLooseBalance(s),
      reference: field(s, /\bID\s*:\s*([A-Za-z0-9]+)/),
    }),
  },
  {
    // « Vous avez envoy 125.00 FCFA  71956255. Votre solde est de 5088.34 FCFA. Trans ID PP… » (retrait par code chez un agent)
    id: 'ORANGE_SENT_TO_NON_SUBSCRIBER',
    provider: 'ORANGE',
    pattern: new RegExp(`Vous avez envoy[ée]? ${AMT}${CUR}\\s+(?:(?:à|a|au)\\s+)?(\\+?\\d{8,})\\.\\s*Votre solde`, 'i'),
    build: (m, s) =>
      withOrangeDate({
        type: 'EXPENSE',
        amount: parseAmountOrZero(m[1]),
        counterpartyPhone: m[2],
        merchantOrRecipient: m[2],
        balanceAfter: orangeLooseBalance(s),
        reference: orangeRef(s),
      }),
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

  {
    // Gabarit Moov « Clé: valeur » pour un transfert vers un autre abonné.
    id: 'MOOV_TRANSFER_SENT',
    provider: 'MOOV',
    pattern: /Transfert r[ée]ussi (?:vers|au|à|a) (?:le )?(\+?\d{8,})? *([^\n]*)\n/i,
    build: (m, s) => {
      const name = cleanName(m[2]);
      return {
        type: 'EXPENSE',
        amount: parseAmountOrZero(field(s, new RegExp(`Montant\\s*:\\s*${AMT}${CUR}`, 'i'))),
        fee: moovFee(s),
        total: moovTotal(s),
        counterpartyPhone: m[1],
        counterpartyName: name.length > 0 ? name : undefined,
        merchantOrRecipient: name.length > 0 ? name : m[1],
        balanceAfter: moovBalance(s),
        reference: moovRef(s),
        occurredAt: moovDate(s),
      };
    },
  },

  // ===================== BANQUES (Ecobank, Coris, SGBF, BOA…) =====================
  {
    // « Votre compte 0123XXXX a été débité de 25 000 XOF … Libellé: RETRAIT GAB » ou « Débit de … sur votre compte ».
    id: 'BANK_ACCOUNT_MOVEMENT',
    pattern: new RegExp(
      `(?:(?:compte|carte)[^\\n]{0,40}?(d[ée]bit[ée]|cr[ée]dit[ée])\\s+(?:de\\s+|d'un montant de\\s+)?${AMT}${CUR}` +
        `|(D[ée]bit|Cr[ée]dit)\\s+de\\s+${AMT}${CUR}\\s+sur (?:votre )?(?:compte|carte))`,
      'i',
    ),
    build: (m, s) => {
      const isCredit = /^cr/i.test(m[1] ?? m[3]);
      const label = cleanName(field(s, /(?:Libell[ée]|Motif|Op[ée]ration|Objet|Description)\s*:\s*([^\n.]+)/i) ?? '');
      const atm = /\b(?:GAB|DAB|ATM|RETRAIT)\b/i.test(label) || /\bretrait\b/i.test(s);
      return {
        type: isCredit ? 'INCOME' : atm ? 'CASH_WITHDRAWAL' : 'EXPENSE',
        amount: parseAmountOrZero(m[2] ?? m[4]),
        fee: parseAmountOrZero(field(s, new RegExp(`(?:Frais|Commission)\\s*:\\s*${OPT_AMT}${CUR}`, 'i'))),
        counterpartyName: label.length > 0 ? label : undefined,
        merchantOrRecipient: label.length > 0 ? label : undefined,
        balanceAfter: parseAmount(
          field(
            s,
            new RegExp(
              `(?:Nouveau solde|Solde(?: disponible| dispo(?:nible)?| comptable)?)\\s*:?\\s*${AMT}${CUR}`,
              'i',
            ),
          ),
        ),
        reference: field(s, /R[ée]f(?:[ée]rence)?\s*:\s*([A-Z0-9][A-Z0-9-]+)/i),
        occurredAt: parseFrenchDate(s),
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
      `(?:recharg[ée]|achat (?:de |d'un |du )?(?:cr[ée]dit|forfait|pass)|souscri\\w* (?:au |à |a )?(?:un |une |le |la |l')?(?:forfait|pass|offre internet|bundle)|(?:forfait|pass) (?:internet|data|appel|jour|semaine|mois|\\d))[^\\n]*?${AMT}${CUR}`,
      'i',
    ),
    build: (m, s) => {
      // Payé avec le crédit d'appel (pas avec le portefeuille MoMo) : déjà compté lors de la recharge.
      const paidWithCredit = PAID_WITH_CREDIT.test(s) && !MONEY_WALLET.test(s);
      if (paidWithCredit) {
        const isData = parseDataVolumeMb(s) !== undefined;
        return { type: 'DATA_FROM_CREDIT', amount: isData ? parseAmountOrZero(m[1]) : 0 };
      }
      return {
        type: 'AIRTIME_RECHARGE',
        amount: parseAmountOrZero(m[1]),
        balanceAfter: parseAmount(field(s, new RegExp(`solde[^\\d]{0,40}${AMT}${CUR}`, 'i'))),
        reference: field(s, /(?:Trans(?:action)?\s*id|TID|Txn ID|Ref)\s*:\s*([A-Z0-9]+(?:\.[A-Z0-9]+)*)/i),
      };
    },
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
  if (sms.length === 0 || isSensitiveSecuritySms(sms) || isInformationalSms(sms)) {
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
    const isDebit = draft.type !== 'INCOME' && draft.type !== 'AGENT_DEPOSIT' && draft.type !== 'DATA_FROM_CREDIT';
    const total = draft.total ?? round(isDebit ? draft.amount + fee + tax : draft.amount);
    const recharge = draft.type === 'AIRTIME_RECHARGE' || draft.type === 'DATA_FROM_CREDIT';
    const volume = recharge ? parseDataVolumeMb(sms) : undefined;
    const isData = recharge && (draft.type === 'DATA_FROM_CREDIT' || volume !== undefined || DATA_HINT.test(sms));
    return stripUndefined<ParsedSms>({
      ...draft,
      airtimeKind: recharge ? (isData ? 'DATA' : 'VOICE') : undefined,
      dataVolumeMb: isData ? volume : undefined,
      dataValidityDays: isData ? parseValidityDays(sms) : undefined,
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
