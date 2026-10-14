import { CATEGORIES } from '../../core/categories';
import { roundMoney } from '../../core/currency';
import { toLocalIso } from '../../core/dates';
import { fingerprint, generateId } from '../../core/id';
import { parseTransactionSms, type ParsedSms } from '../../data/parser/SmsParserEngine';
import { isSensitiveSecuritySms, isWhitelistedSender } from '../../data/parser/securityFilters';
import { accountIdForProvider, CASH_ACCOUNT_ID, DEFAULT_ACCOUNTS, type Account } from '../models/Account';
import type { Provider, Transaction } from '../models/Transaction';
import type { AccountRepository, SettingsRepository, TransactionRepository } from '../repositories';
import type { FamilyMember } from '../models/FamilyMember';
import { autoCategorize } from './CategorizeTransaction';
import { FAMILY_MEMBERS_KEY, familyPhoneTails } from './FamilyMembers';
import {
  enqueueUnrecognized,
  looksLikeFinancialSms,
  toUnrecognizedSms,
  UNRECOGNIZED_SMS_KEY,
  type UnrecognizedSms,
} from './UnrecognizedSms';

export interface LedgerEntries {
  transactions: Transaction[];
  /** Comptes modifiés (nouveaux soldes). */
  accounts: Account[];
}

export const PROVIDER_LABELS: Record<Provider, string> = {
  MOOV: 'Moov Money',
  ORANGE: 'Orange Money',
  UBA_WAVE: 'Wave / UBA',
  WAVE: 'Wave',
  TELECEL: 'Telecel Money',
  ECOBANK: 'Ecobank',
  BANK: 'Banque',
  CASH: 'Portefeuille Espèces (Poche)',
};

const findOrCreateAccount = (accounts: ReadonlyArray<Account>, provider: Provider): Account => {
  const id = accountIdForProvider(provider);
  const existing = accounts.find(a => a.id === id) ?? DEFAULT_ACCOUNTS.find(a => a.id === id);
  return existing
    ? { ...existing }
    : {
        id,
        name: PROVIDER_LABELS[provider],
        provider,
        currentBalance: 0,
        type: provider === 'ECOBANK' || provider === 'BANK' ? 'BANK' : 'MOMO',
      };
};

/**
 * Transforme un SMS analysé en écritures comptables locales.
 *
 * Règles métier :
 * - Retrait kiosque : le compte MoMo est débité (montant + frais) mais le
 *   « Portefeuille Espèces » est crédité du montant net. Ce n'est PAS une dépense.
 * - Frais & taxes : isolés dans une écriture `FEE` (catégorie « Frais & Taxes »).
 * - Solde opérateur : le solde annoncé par le SMS fait foi, sauf s'il est plus
 *   ancien que le dernier solde connu (import d'historique).
 */
export const buildLedgerEntries = (
  parsed: ParsedSms,
  accounts: ReadonlyArray<Account>,
  receivedAt: Date,
  options: {
    learnedCategories?: Readonly<Record<string, string>>;
    familyTails?: ReadonlySet<string>;
    idGen?: (p: string) => string;
  } = {},
): LedgerEntries => {
  const idGen = options.idGen ?? generateId;
  const nowIso = toLocalIso(receivedAt);
  const occurredAt = parsed.occurredAt ?? nowIso;
  const account = findOrCreateAccount(accounts, parsed.provider);
  const fp = fingerprint(parsed.rawSms);

  const main: Transaction = {
    id: idGen('tx'),
    accountId: account.id,
    provider: parsed.provider,
    type: parsed.type,
    amount: parsed.amount,
    fee: parsed.fee,
    tax: parsed.tax,
    counterpartyName: parsed.counterpartyName ?? parsed.merchantOrRecipient,
    counterpartyPhone: parsed.counterpartyPhone,
    category: autoCategorize(parsed, options.learnedCategories, options.familyTails),
    balanceAfter: parsed.balanceAfter,
    reference: parsed.reference,
    rawSms: parsed.rawSms,
    smsFingerprint: fp,
    source: 'SMS',
    occurredAt,
    createdAt: nowIso,
    dataVolumeMb: parsed.dataVolumeMb,
    dataValidityDays: parsed.dataValidityDays,
  };
  if (main.dataVolumeMb === undefined) {
    delete main.dataVolumeMb;
  }
  if (main.dataValidityDays === undefined) {
    delete main.dataValidityDays;
  }
  const transactions: Transaction[] = [main];
  if (parsed.type === 'DATA_FROM_CREDIT') {
    // Forfait payé avec le crédit d'appel : on suit le volume, aucun solde MoMo ne bouge.
    return { transactions, accounts: [] };
  }

  const charges = roundMoney(parsed.fee + parsed.tax);
  if (charges > 0) {
    transactions.push({
      id: idGen('tx'),
      accountId: account.id,
      provider: parsed.provider,
      type: 'FEE',
      amount: charges,
      fee: 0,
      tax: 0,
      counterpartyName: main.counterpartyName,
      category: CATEGORIES.FEES,
      note: `Frais ${parsed.fee} + taxes ${parsed.tax}`,
      parentId: main.id,
      source: 'SYSTEM',
      occurredAt,
      createdAt: nowIso,
    });
  }

  const touched: Account[] = [];
  const isNewer = !account.updatedAt || occurredAt >= account.updatedAt;
  if (parsed.balanceAfter !== undefined) {
    if (isNewer) {
      account.currentBalance = parsed.balanceAfter;
      account.updatedAt = occurredAt;
    }
  } else {
    const credit = parsed.type === 'INCOME' || parsed.type === 'AGENT_DEPOSIT';
    const delta = credit ? parsed.amount - charges : -(parsed.amount + charges);
    account.currentBalance = roundMoney(account.currentBalance + delta);
    account.updatedAt = isNewer ? occurredAt : account.updatedAt;
  }
  touched.push(account);

  if (parsed.type === 'CASH_WITHDRAWAL') {
    const cash = { ...(accounts.find(a => a.id === CASH_ACCOUNT_ID) ?? findOrCreateAccount(accounts, 'CASH')) };
    cash.currentBalance = roundMoney(cash.currentBalance + parsed.amount);
    cash.updatedAt = nowIso;
    touched.push(cash);
    transactions.push({
      id: idGen('tx'),
      accountId: CASH_ACCOUNT_ID,
      provider: 'CASH',
      type: 'CASH_DEPOSIT',
      amount: parsed.amount,
      fee: 0,
      tax: 0,
      counterpartyName: main.counterpartyName,
      category: CATEGORIES.CASH_IN,
      note: `Retrait ${PROVIDER_LABELS[parsed.provider]} converti en espèces`,
      parentId: main.id,
      source: 'SYSTEM',
      occurredAt,
      createdAt: nowIso,
    });
  }

  if (parsed.type === 'AGENT_DEPOSIT') {
    // Dépôt chez un agent : les espèces de la Poche passent sur le compte MoMo (ni revenu, ni dépense).
    const cash = { ...(accounts.find(a => a.id === CASH_ACCOUNT_ID) ?? findOrCreateAccount(accounts, 'CASH')) };
    cash.currentBalance = roundMoney(cash.currentBalance - parsed.amount);
    cash.updatedAt = nowIso;
    touched.push(cash);
    transactions.push({
      id: idGen('tx'),
      accountId: CASH_ACCOUNT_ID,
      provider: 'CASH',
      type: 'CASH_OUT',
      amount: parsed.amount,
      fee: 0,
      tax: 0,
      counterpartyName: main.counterpartyName,
      category: CATEGORIES.MOMO_DEPOSIT,
      note: `Espèces déposées sur ${PROVIDER_LABELS[parsed.provider]}`,
      parentId: main.id,
      source: 'SYSTEM',
      occurredAt,
      createdAt: nowIso,
    });
  }

  return { transactions, accounts: touched };
};

export type ProcessSmsResult =
  | { status: 'IGNORED' }
  /** Expéditeur agréé mais format inconnu : SMS mis de côté pour saisie manuelle. */
  | { status: 'UNRECOGNIZED'; pending: UnrecognizedSms }
  | { status: 'DUPLICATE'; parsed: ParsedSms }
  | { status: 'RECORDED'; parsed: ParsedSms; entries: LedgerEntries };

export interface IncomingSms {
  body: string;
  sender?: string;
  receivedAt?: Date;
}

export const LEARNED_CATEGORIES_KEY = 'learnedCategories';
export const EXTRA_SENDERS_KEY = 'extraSenders';

/** Cas d'usage appelé par la tâche Headless Android et l'import d'historique. */
export class ProcessIncomingSmsUseCase {
  constructor(
    private readonly repos: {
      transactions: TransactionRepository;
      accounts: AccountRepository;
      settings: SettingsRepository;
      runInTransaction?: <T>(fn: () => Promise<T>) => Promise<T>;
    },
  ) {}

  async execute(sms: IncomingSms): Promise<ProcessSmsResult> {
    const extraSenders = await this.repos.settings.getJson<string[]>(EXTRA_SENDERS_KEY, []);
    const parsed = parseTransactionSms(sms.body, { sender: sms.sender, extraSenders });
    if (!parsed) {
      return this.keepUnrecognized(sms, extraSenders);
    }
    const duplicate = parsed.reference
      ? await this.repos.transactions.existsByReference(parsed.provider, parsed.reference)
      : await this.repos.transactions.existsBySmsFingerprint(fingerprint(parsed.rawSms));
    if (duplicate) {
      await this.refreshBalanceFromDuplicate(parsed, sms.receivedAt ?? new Date());
      return { status: 'DUPLICATE', parsed };
    }
    const learned = await this.repos.settings.getJson<Record<string, string>>(LEARNED_CATEGORIES_KEY, {});
    const accounts = await this.repos.accounts.getAll();
    const entries = buildLedgerEntries(parsed, accounts, sms.receivedAt ?? new Date(), {
      learnedCategories: learned,
      familyTails: familyPhoneTails(await this.repos.settings.getJson<FamilyMember[]>(FAMILY_MEMBERS_KEY, [])),
    });
    const write = async () => {
      await this.repos.transactions.insertMany(entries.transactions);
      await this.repos.accounts.saveMany(entries.accounts);
    };
    await (this.repos.runInTransaction ? this.repos.runInTransaction(write) : write());
    return { status: 'RECORDED', parsed, entries };
  }

  /**
   * Un même dépôt peut produire plusieurs SMS (Ecobank : 3) et seul l'un d'eux
   * donne le solde : s'il arrive après, on met le solde du compte à jour sans
   * réenregistrer l'opération.
   */
  private async refreshBalanceFromDuplicate(parsed: ParsedSms, receivedAt: Date): Promise<void> {
    if (parsed.balanceAfter === undefined) {
      return;
    }
    const accounts = await this.repos.accounts.getAll();
    const account = accounts.find(a => a.id === accountIdForProvider(parsed.provider));
    const at = parsed.occurredAt ?? toLocalIso(receivedAt);
    if (account && (!account.updatedAt || at >= account.updatedAt)) {
      await this.repos.accounts.saveMany([{ ...account, currentBalance: parsed.balanceAfter, updatedAt: at }]);
    }
  }

  /** Conserve un SMS opérateur non analysé (jamais un code de sécurité ni un expéditeur inconnu). */
  private async keepUnrecognized(sms: IncomingSms, extraSenders: string[]): Promise<ProcessSmsResult> {
    if (
      !sms.sender ||
      !isWhitelistedSender(sms.sender, extraSenders) ||
      isSensitiveSecuritySms(sms.body) ||
      !looksLikeFinancialSms(sms.body)
    ) {
      return { status: 'IGNORED' };
    }
    const pending = toUnrecognizedSms(sms.body, sms.sender, toLocalIso(sms.receivedAt ?? new Date()));
    const queue = await this.repos.settings.getJson<UnrecognizedSms[]>(UNRECOGNIZED_SMS_KEY, []);
    await this.repos.settings.setJson(UNRECOGNIZED_SMS_KEY, enqueueUnrecognized(queue, pending));
    return { status: 'UNRECOGNIZED', pending };
  }
}
