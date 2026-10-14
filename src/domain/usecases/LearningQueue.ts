import { CATEGORIES } from '../../core/categories';
import { fingerprint } from '../../core/id';
import { parseTransactionSms, type ParsedSms } from '../../data/parser/SmsParserEngine';
import {
  isSensitiveSecuritySms,
  isWhitelistedSender,
  normalizeSender,
  providerFromSender,
} from '../../data/parser/securityFilters';
import { normalizeSms } from '../../data/parser/textUtils';
import { accountIdForProvider, CASH_ACCOUNT_ID, DEFAULT_ACCOUNTS, type Account } from '../models/Account';
import type { ParsedTransactionType, Provider, Transaction } from '../models/Transaction';
import type { AccountRepository, SettingsRepository, TransactionRepository } from '../repositories';
import { buildLedgerEntries, LEARNED_CATEGORIES_KEY } from './ProcessIncomingSms';
import { autoCategorize, counterpartyKey } from './CategorizeTransaction';
import { looksLikeFinancialSms, toUnrecognizedSms } from './UnrecognizedSms';

/**
 * Apprentissage guidé : l'utilisateur classe son historique SMS un par un, avec
 * une proposition pré-remplie qui s'affine à chaque confirmation / correction.
 * Module pur (aucun import React Native) : file, propositions, mise à jour.
 */

export const LEARNING_SESSION_KEY = 'learningSession';
export const LEARNING_PATTERNS_KEY = 'learningPatterns';

export interface RawSms {
  sender: string;
  body: string;
  /** Date de réception (ISO local). */
  receivedAt: string;
}

export interface LearningItem extends RawSms {
  /** Empreinte du SMS (identifiant stable, sert aussi à la déduplication). */
  id: string;
}

export type ExclusionReason =
  | 'NOT_WHITELISTED'
  | 'SECURITY_CODE'
  | 'NOT_FINANCIAL'
  | 'ALREADY_RECORDED'
  | 'DUPLICATE_IN_INBOX';

export interface QueueBuildResult {
  items: LearningItem[];
  excluded: Record<ExclusionReason, number>;
}

export interface KnownTransactions {
  fingerprints: ReadonlySet<string>;
  /** Clés « PROVIDER|référence ». */
  references: ReadonlySet<string>;
}

export const referenceKey = (provider: string, reference: string) => `${provider}|${reference}`;

/** Analyse (déterministe) d'un élément : jamais stockée, recalculée à la demande. */
export const parseItem = (item: RawSms, extraSenders: ReadonlyArray<string> = []): ParsedSms | null =>
  parseTransactionSms(item.body, { sender: item.sender, extraSenders });

/**
 * Filtre l'historique AVANT tout affichage : expéditeurs agréés uniquement, codes
 * de sécurité (OTP / PIN / 2FA) rejetés, SMS déjà enregistrés et doublons exclus.
 */
export const buildLearningQueue = (
  messages: ReadonlyArray<RawSms>,
  known: KnownTransactions,
  extraSenders: ReadonlyArray<string> = [],
): QueueBuildResult => {
  const excluded: Record<ExclusionReason, number> = {
    NOT_WHITELISTED: 0,
    SECURITY_CODE: 0,
    NOT_FINANCIAL: 0,
    ALREADY_RECORDED: 0,
    DUPLICATE_IN_INBOX: 0,
  };
  const seen = new Set<string>();
  const items: LearningItem[] = [];
  for (const m of messages) {
    if (!isWhitelistedSender(m.sender, extraSenders)) {
      excluded.NOT_WHITELISTED++;
      continue;
    }
    if (isSensitiveSecuritySms(normalizeSms(m.body))) {
      excluded.SECURITY_CODE++;
      continue;
    }
    const parsed = parseItem(m, extraSenders);
    if (!parsed && !looksLikeFinancialSms(m.body)) {
      excluded.NOT_FINANCIAL++;
      continue;
    }
    const id = fingerprint(m.body);
    const dedupKey = parsed?.reference ? referenceKey(parsed.provider, parsed.reference) : `fp:${id}`;
    if (
      known.fingerprints.has(id) ||
      (parsed?.reference !== undefined && known.references.has(referenceKey(parsed.provider, parsed.reference)))
    ) {
      excluded.ALREADY_RECORDED++;
      continue;
    }
    if (seen.has(dedupKey)) {
      excluded.DUPLICATE_IN_INBOX++;
      continue;
    }
    seen.add(dedupKey);
    items.push({ ...m, id });
  }
  return { items, excluded };
};

// ------------------------------------------------------------------ Motifs appris

/** Votes par motif : { "cp:70112233": { categories: { Famille: 2 }, types: { EXPENSE: 2 } } }. */
export interface PatternVotes {
  categories: Record<string, number>;
  types: Record<string, number>;
}

export interface LearnedState {
  patterns: Record<string, PatternVotes>;
}

export const EMPTY_LEARNED_STATE: LearnedState = { patterns: {} };

/** Votes nécessaires pour qu'un motif appris l'emporte sur le parseur. */
export const MIN_VOTES = 2;

const STOP_WORDS = new Set([
  'VOUS',
  'AVEZ',
  'VOTRE',
  'SOLDE',
  'FCFA',
  'MONTANT',
  'FRAIS',
  'TOTAL',
  'DATE',
  'AUPRES',
  'REUSSI',
  'MERCI',
  'TRANS',
  'POUR',
  'AVEC',
  'DANS',
  'CHEZ',
  'MONEY',
  'ORANGE',
  'MOOV',
  'WAVE',
  'COMPTE',
  'NOUVEAU',
  'EFFECTUE',
  'SUCCES',
  'TAXE',
  'RECU',
  'ENVOYE',
  'PAIEMENT',
  'RETRAIT',
  'NUMERO',
  'CODE',
  'AGENT',
  'TRANSFERT',
  'MARCHAND',
  'CLIENT',
  'CHER',
  'OPERATION',
]);

/** Mots-clés distinctifs d'un SMS (≥ 4 lettres, hors vocabulaire opérateur). */
export const keywordsOf = (body: string, max = 3): string[] =>
  [
    ...new Set(
      normalizeSms(body)
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toUpperCase()
        .split(/[^A-Z]+/)
        .filter(w => w.length >= 4 && !STOP_WORDS.has(w)),
    ),
  ].slice(0, max);

/**
 * Motifs d'un SMS, du plus spécifique au plus général :
 * contrepartie (numéro ou nom), puis expéditeur + mot-clé.
 */
export const patternKeys = (item: RawSms, parsed: ParsedSms | null): string[] => {
  const keys: string[] = [];
  const cp = parsed ? counterpartyKey(parsed) : undefined;
  if (cp) {
    keys.push(`cp:${cp}`);
  }
  const sender = normalizeSender(item.sender);
  for (const kw of keywordsOf(parsed?.counterpartyName ?? parsed?.merchantOrRecipient ?? item.body)) {
    keys.push(`kw:${sender}:${kw}`);
  }
  return keys;
};

const topVote = (votes: Record<string, number>): [string, number] | undefined =>
  Object.entries(votes).sort((a, b) => b[1] - a[1])[0];

// ------------------------------------------------------------------ Propositions

export type ProposalSource = 'PARSER' | 'LEARNED' | 'UNRECOGNIZED';
export type ProposalType = ParsedTransactionType;

export interface Proposal {
  type: ProposalType;
  category: string;
  accountId: string;
  amount: number;
  counterpartyName?: string;
  source: ProposalSource;
  /** 0 à 1. */
  confidence: number;
  /** Nombre de choix précédents ayant produit la proposition (source LEARNED). */
  learnedVotes?: number;
}

/** Règles opérateur précises → haute confiance ; règles génériques → moyenne. */
const parserConfidence = (parsed: ParsedSms): number =>
  parsed.ruleId.startsWith('GENERIC') || parsed.ruleId.startsWith('BANK')
    ? 0.65
    : // Crédit « reçu du <numéro> » sans solde : achat pour soi ou cadeau d'un proche ? À confirmer.
    parsed.ruleId === 'MOOV_CREDIT_PURCHASE' && parsed.balanceAfter === undefined
    ? 0.6
    : 0.9;

export const HIGH_CONFIDENCE = 0.8;

export const proposeFor = (
  item: RawSms,
  learned: LearnedState,
  options: {
    learnedCategories?: Readonly<Record<string, string>>;
    familyTails?: ReadonlySet<string>;
    extraSenders?: ReadonlyArray<string>;
  } = {},
): Proposal => {
  const parsed = parseItem(item, options.extraSenders);
  let base: Proposal;
  if (parsed) {
    base = {
      type: parsed.type,
      category: autoCategorize(parsed, options.learnedCategories, options.familyTails),
      accountId: accountIdForProvider(parsed.provider),
      amount: parsed.amount,
      counterpartyName: parsed.counterpartyName ?? parsed.merchantOrRecipient,
      source: 'PARSER',
      confidence: parserConfidence(parsed),
    };
  } else {
    const draft = toUnrecognizedSms(item.body, item.sender, item.receivedAt);
    const provider = providerFromSender(item.sender);
    base = {
      type: draft.suggestedType ?? 'EXPENSE',
      category: draft.suggestedType === 'INCOME' ? CATEGORIES.INCOME : CATEGORIES.OTHER,
      accountId: provider ? accountIdForProvider(provider) : CASH_ACCOUNT_ID,
      amount: draft.suggestedAmount ?? 0,
      source: 'UNRECOGNIZED',
      confidence: draft.suggestedAmount ? 0.3 : 0.15,
    };
  }
  // Les choix de l'utilisateur priment sur le parseur dès MIN_VOTES votes concordants.
  for (const key of patternKeys(item, parsed)) {
    const votes = learned.patterns[key];
    const cat = votes ? topVote(votes.categories) : undefined;
    if (!votes || !cat || cat[1] < MIN_VOTES) {
      continue;
    }
    const type = topVote(votes.types);
    const total = Object.values(votes.categories).reduce((s, n) => s + n, 0);
    return {
      ...base,
      category: cat[0],
      type: type && type[1] >= MIN_VOTES ? (type[0] as ProposalType) : base.type,
      source: 'LEARNED',
      confidence: Math.min(0.97, Math.max(base.confidence, 0.6 + 0.1 * cat[1]) * (cat[1] / total)),
      learnedVotes: cat[1],
    };
  }
  return base;
};

/**
 * Ordre de présentation : haute confiance d'abord (confirmation rapide), puis
 * les ambigus, puis les non reconnus ; à confiance égale, du plus récent au plus ancien.
 */
export const sortByConfidence = (
  items: ReadonlyArray<LearningItem>,
  learned: LearnedState,
  options: Parameters<typeof proposeFor>[2] = {},
): LearningItem[] => {
  const tier = (p: Proposal) => (p.source === 'UNRECOGNIZED' ? 2 : p.confidence >= HIGH_CONFIDENCE ? 0 : 1);
  return items
    .map(item => ({ item, p: proposeFor(item, learned, options) }))
    .sort(
      (a, b) =>
        tier(a.p) - tier(b.p) || b.p.confidence - a.p.confidence || b.item.receivedAt.localeCompare(a.item.receivedAt),
    )
    .map(x => x.item);
};

// ------------------------------------------------------------------ Décisions

export type IgnoreReason = 'SPAM' | 'OTP' | 'DUPLICATE' | 'OTHER';

export type Decision =
  | {
      action: 'CONFIRM' | 'CORRECT';
      type: ProposalType;
      category: string;
      accountId: string;
      amount: number;
      counterpartyName?: string;
    }
  | { action: 'IGNORE'; reason: IgnoreReason };

/** Met à jour les votes après une confirmation / correction (jamais depuis un code de sécurité ni un rejet). */
export const learnFromDecision = (
  learned: LearnedState,
  item: RawSms,
  decision: Decision,
  extraSenders: ReadonlyArray<string> = [],
): LearnedState => {
  if (decision.action === 'IGNORE' || isSensitiveSecuritySms(normalizeSms(item.body))) {
    return learned;
  }
  const patterns = { ...learned.patterns };
  for (const key of patternKeys(item, parseItem(item, extraSenders))) {
    const prev = patterns[key] ?? { categories: {}, types: {} };
    patterns[key] = {
      categories: { ...prev.categories, [decision.category]: (prev.categories[decision.category] ?? 0) + 1 },
      types: { ...prev.types, [decision.type]: (prev.types[decision.type] ?? 0) + 1 },
    };
  }
  return { patterns };
};

/** Recalcule l'état appris à partir des votes persistés + des décisions du brouillon (annulation exacte). */
export const replayDecisions = (
  base: LearnedState,
  items: ReadonlyArray<LearningItem>,
  decisions: Readonly<Record<string, Decision>>,
  extraSenders: ReadonlyArray<string> = [],
): LearnedState =>
  items.reduce(
    (acc, item) => (decisions[item.id] ? learnFromDecision(acc, item, decisions[item.id], extraSenders) : acc),
    base,
  );

// ------------------------------------------------------------------ Session

export interface LearningSession {
  version: 1;
  startedAt: string;
  /** Ordre figé au démarrage (les propositions, elles, évoluent). */
  items: LearningItem[];
  index: number;
  decisions: Record<string, Decision>;
  excluded: Record<ExclusionReason, number>;
}

export interface SessionSummary {
  total: number;
  recorded: number;
  ignored: number;
  ignoredByReason: Record<IgnoreReason, number>;
  remaining: number;
}

export const summarizeSession = (session: Pick<LearningSession, 'items' | 'decisions'>): SessionSummary => {
  const ignoredByReason: Record<IgnoreReason, number> = { SPAM: 0, OTP: 0, DUPLICATE: 0, OTHER: 0 };
  let recorded = 0;
  for (const item of session.items) {
    const d = session.decisions[item.id];
    if (!d) {
      continue;
    }
    if (d.action === 'IGNORE') {
      ignoredByReason[d.reason]++;
    } else {
      recorded++;
    }
  }
  const ignored = Object.values(ignoredByReason).reduce((s, n) => s + n, 0);
  return {
    total: session.items.length,
    recorded,
    ignored,
    ignoredByReason,
    remaining: session.items.length - recorded - ignored,
  };
};

/** Prochain élément sans décision à partir de `from` (puis depuis le début) ; -1 s'il n'y en a plus. */
export const nextUndecidedIndex = (session: Pick<LearningSession, 'items' | 'decisions'>, from: number): number => {
  const n = session.items.length;
  for (let k = 0; k < n; k++) {
    const i = (from + k) % n;
    if (!session.decisions[session.items[i].id]) {
      return i;
    }
  }
  return -1;
};

// ------------------------------------------------------------------ Validation finale

export interface CommitReport {
  recorded: number;
  /** Doublons détectés au moment de l'insertion (SMS arrivé entre-temps en temps réel). */
  skippedDuplicates: number;
  ignored: number;
}

/** SMS « équivalent » construit d'après la décision (type, compte ou montant corrigés). */
const decisionToParsed = (
  item: LearningItem,
  decision: Extract<Decision, { action: 'CONFIRM' | 'CORRECT' }>,
  parsed: ParsedSms | null,
  accounts: ReadonlyArray<Account>,
): ParsedSms => {
  const sameAsParser =
    parsed &&
    parsed.type === decision.type &&
    parsed.amount === decision.amount &&
    accountIdForProvider(parsed.provider) === decision.accountId;
  if (parsed && sameAsParser) {
    return parsed;
  }
  const provider: Provider =
    accounts.find(a => a.id === decision.accountId)?.provider ??
    DEFAULT_ACCOUNTS.find(a => a.id === decision.accountId)?.provider ??
    'CASH';
  return {
    provider,
    type: decision.type,
    amount: decision.amount,
    fee: parsed && parsed.type === decision.type ? parsed.fee : 0,
    tax: parsed && parsed.type === decision.type ? parsed.tax : 0,
    total: decision.amount,
    reference: parsed?.reference,
    occurredAt: parsed?.occurredAt ?? item.receivedAt,
    currency: 'XOF',
    ruleId: 'LEARNING_MANUAL',
    rawSms: item.body,
  };
};

/**
 * Valide une session : enregistre toutes les décisions dans UNE transaction SQL,
 * en vérifiant la déduplication juste avant chaque insertion, puis persiste les
 * motifs appris et les catégories par contrepartie (mécanisme `learn` existant).
 */
export class CommitLearningSessionUseCase {
  constructor(
    private readonly repos: {
      transactions: TransactionRepository;
      accounts: AccountRepository;
      settings: SettingsRepository;
      runInTransaction: <T>(fn: () => Promise<T>) => Promise<T>;
    },
  ) {}

  async execute(session: LearningSession, now: Date, extraSenders: ReadonlyArray<string> = []): Promise<CommitReport> {
    const report: CommitReport = { recorded: 0, skippedDuplicates: 0, ignored: 0 };
    await this.repos.runInTransaction(async () => {
      let accounts = await this.repos.accounts.getAll();
      const learnedCategories = await this.repos.settings.getJson<Record<string, string>>(LEARNED_CATEGORIES_KEY, {});
      const insertedFingerprints = new Set<string>();
      for (const item of session.items) {
        const decision = session.decisions[item.id];
        if (!decision) {
          continue;
        }
        if (decision.action === 'IGNORE') {
          report.ignored++;
          continue;
        }
        const parsed = parseItem(item, extraSenders);
        const effective = decisionToParsed(item, decision, parsed, accounts);
        const fp = fingerprint(item.body);
        const duplicate =
          insertedFingerprints.has(fp) ||
          (effective.reference
            ? await this.repos.transactions.existsByReference(effective.provider, effective.reference)
            : false) ||
          (await this.repos.transactions.existsBySmsFingerprint(fp));
        if (duplicate) {
          report.skippedDuplicates++;
          continue;
        }
        const entries = buildLedgerEntries(effective, accounts, new Date(item.receivedAt));
        const [main, ...rest] = entries.transactions;
        const counterpartyName = decision.counterpartyName?.trim() || main.counterpartyName;
        const mainTx: Transaction = { ...main, category: decision.category, counterpartyName };
        if (mainTx.counterpartyName === undefined) {
          delete mainTx.counterpartyName;
        }
        await this.repos.transactions.insertMany([mainTx, ...rest]);
        await this.repos.accounts.saveMany(entries.accounts);
        accounts = [...accounts.filter(a => !entries.accounts.some(t => t.id === a.id)), ...entries.accounts];
        insertedFingerprints.add(fp);
        report.recorded++;
        const key = counterpartyKey(effective);
        if (decision.action === 'CORRECT' && key && decision.type === 'EXPENSE') {
          learnedCategories[key] = decision.category;
        }
      }
      await this.repos.settings.setJson(LEARNED_CATEGORIES_KEY, learnedCategories);
      const base = await this.repos.settings.getJson<LearnedState>(LEARNING_PATTERNS_KEY, EMPTY_LEARNED_STATE);
      await this.repos.settings.setJson(
        LEARNING_PATTERNS_KEY,
        replayDecisions(base, session.items, session.decisions, extraSenders),
      );
      await this.repos.settings.setJson(LEARNING_SESSION_KEY, null);
      await this.repos.settings.setJson(LEARNING_DONE_KEY, now.toISOString());
    });
    return report;
  }
}

export const LEARNING_DONE_KEY = 'learningDoneAt';
