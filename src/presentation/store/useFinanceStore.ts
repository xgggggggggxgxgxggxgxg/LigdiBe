import { create } from 'zustand';
import { CATEGORIES } from '../../core/categories';
import { monthKey, nextMonthKey, toLocalIso } from '../../core/dates';
import { fingerprint, generateId } from '../../core/id';
import { CASH_ACCOUNT_ID, DEFAULT_ACCOUNTS, type Account } from '../../domain/models/Account';
import { DEFAULT_BUDGET_CONFIG, type BudgetConfig } from '../../domain/models/Budget';
import type { Debt } from '../../domain/models/Debt';
import type { PlannedItem } from '../../domain/models/PlannedItem';
import type { SavingsGoal } from '../../domain/models/SavingsGoal';
import type { Tontine } from '../../domain/models/Tontine';
import type { Transaction, TransactionType } from '../../domain/models/Transaction';
import type { ThemeMode } from '../theme/theme';
import type { Repositories } from '../../domain/repositories';
import { autoMatchPlannedItems, carryOverToNextMonth } from '../../domain/usecases/BudgetForecast';
import { counterpartyKey } from '../../domain/usecases/CategorizeTransaction';
import { applyRepayment } from '../../domain/usecases/ManageDebts';
import {
  EXTRA_SENDERS_KEY,
  LEARNED_CATEGORIES_KEY,
  ProcessIncomingSmsUseCase,
  type IncomingSms,
  type ProcessSmsResult,
} from '../../domain/usecases/ProcessIncomingSms';
import { UNRECOGNIZED_SMS_KEY, type UnrecognizedSms } from '../../domain/usecases/UnrecognizedSms';
import type { FamilyMember } from '../../domain/models/FamilyMember';
import type { FamilyRequest } from '../../domain/models/FamilyRequest';
import {
  FAMILY_MEMBERS_KEY,
  familyPhoneTails,
  isFamilyPhone,
  mergeFamilyMembers,
} from '../../domain/usecases/FamilyMembers';
import { WIDGET_SHOW_BALANCE_KEY } from '../../services/widget/WidgetService';
import { MONTHLY_DATA_LIMIT_KEY } from '../../domain/usecases/DataTracker';
import { LEARNING_DONE_KEY, LEARNING_SESSION_KEY } from '../../domain/usecases/LearningQueue';
import {
  decideRequest,
  FAMILY_REQUESTS_KEY,
  SOLIDARITY_BUDGET_KEY,
  type ReplyKind,
} from '../../domain/usecases/FamilySolidarity';

const PAID_FIXED_KEY = (month: string) => `paidFixed:${month}`;
const ONBOARDED_KEY = 'onboarded';
const USER_NAME_KEY = 'userName';
const THEME_KEY = 'themeMode';
export const CUSTOM_CATEGORIES_KEY = 'customCategories';

export interface ManualTransactionInput {
  accountId: string;
  type: Extract<TransactionType, 'EXPENSE' | 'INCOME'>;
  amount: number;
  category: string;
  note?: string;
  counterpartyName?: string;
  occurredAt?: Date;
  /** SMS d'origine (opération saisie depuis un SMS non reconnu). */
  rawSms?: string;
}

export interface FinanceState {
  ready: boolean;
  error?: string;
  /** Date de référence (rafraîchie à chaque rechargement, injectable en test). */
  now: Date;
  accounts: Account[];
  /** Transactions depuis le début de l'année (et au moins les 2 derniers mois). */
  transactions: Transaction[];
  debts: Debt[];
  plannedItems: PlannedItem[];
  tontines: Tontine[];
  savingsGoals: SavingsGoal[];
  budgetConfig: BudgetConfig;
  paidFixedExpenseIds: string[];
  learnedCategories: Record<string, string>;
  userName: string;
  onboarded: boolean;
  extraSenders: string[];
  themeMode: ThemeMode;
  /** SMS opérateur au format inconnu, en attente de saisie manuelle. */
  unrecognizedSms: UnrecognizedSms[];
  familyRequests: FamilyRequest[];
  /** Budget solidarité mensuel (0 = non défini). */
  solidarityBudget: number;
  /** Afficher le patrimoine total sur le widget d'écran d'accueil (masqué par défaut). */
  widgetShowBalance: boolean;
  /** « Ma famille » : proches dont les envois sont classés automatiquement. */
  familyMembers: FamilyMember[];
  /** Plafond mensuel des forfaits internet en FCFA (0 = aucun). */
  monthlyDataLimit: number;
  /** Catégories créées par l'utilisateur (en plus des catégories standard). */
  customCategories: string[];
  /** Apprentissage guidé : jamais fait, en pause (brouillon) ou terminé au moins une fois. */
  learningStatus: 'NEVER' | 'PAUSED' | 'DONE';

  hydrate(now?: Date): Promise<void>;
  ingestSms(sms: IncomingSms): Promise<ProcessSmsResult>;
  addManualTransaction(input: ManualTransactionInput): Promise<Transaction>;
  recategorize(transactionId: string, category: string, learn?: boolean): Promise<void>;
  deleteTransaction(transactionId: string): Promise<void>;
  setAccountBalance(accountId: string, balance: number): Promise<void>;

  saveDebt(debt: Omit<Debt, 'id' | 'createdAt' | 'amountRepaid' | 'isSettled'> & Partial<Debt>): Promise<void>;
  repayDebt(debtId: string, amount: number): Promise<void>;
  deleteDebt(debtId: string): Promise<void>;

  savePlannedItem(item: Omit<PlannedItem, 'id' | 'month' | 'isDone'> & Partial<PlannedItem>): Promise<void>;
  togglePlannedItem(itemId: string, matchedTransactionId?: string): Promise<void>;
  deletePlannedItem(itemId: string): Promise<void>;
  autoCheckPlannedItems(): Promise<number>;
  carryOverToNextMonth(): Promise<number>;

  saveBudgetConfig(config: BudgetConfig): Promise<void>;
  toggleFixedExpensePaid(fixedExpenseId: string): Promise<void>;

  saveTontine(tontine: Omit<Tontine, 'id' | 'paidContributions'> & Partial<Tontine>): Promise<void>;
  payTontine(tontineId: string): Promise<void>;
  deleteTontine(tontineId: string): Promise<void>;

  saveGoal(goal: Omit<SavingsGoal, 'id' | 'contributions' | 'createdAt'> & Partial<SavingsGoal>): Promise<void>;
  contributeToGoal(goalId: string, amount: number): Promise<void>;
  deleteGoal(goalId: string): Promise<void>;

  completeOnboarding(userName: string, config: BudgetConfig): Promise<void>;
  setUserName(userName: string): Promise<void>;
  /** Transactions d'un mois quelconque (depuis la mémoire si disponible, sinon la base). */
  getMonthTransactions(month: string): Promise<Transaction[]>;
  /** Tout l'historique (recherche), y compris au-delà de la fenêtre chargée en mémoire. */
  loadAllTransactions(): Promise<Transaction[]>;
  setExtraSenders(senders: string[]): Promise<void>;
  setThemeMode(mode: ThemeMode): Promise<void>;
  /** Transforme un SMS non reconnu en opération manuelle puis le retire de la file. */
  resolveUnrecognizedSms(smsId: string, input: ManualTransactionInput): Promise<Transaction>;
  dismissUnrecognizedSms(smsId: string): Promise<void>;

  saveFamilyRequest(
    input: Pick<FamilyRequest, 'contactName' | 'amount'> & Partial<Pick<FamilyRequest, 'phone' | 'reason' | 'id'>>,
  ): Promise<void>;
  /**
   * Décide d'une demande. Pour un don : `accountId` crée la dépense (espèces…) ;
   * sans compte, l'envoi MoMo récent du même montant est rattaché et reclassé « Famille ».
   */
  decideFamilyRequest(requestId: string, kind: ReplyKind, givenAmount?: number, accountId?: string): Promise<void>;
  deleteFamilyRequest(requestId: string): Promise<void>;
  setSolidarityBudget(amount: number): Promise<void>;
  setWidgetShowBalance(show: boolean): Promise<void>;
  /**
   * Ajoute des proches (sans doublon) et reclasse en « Famille » leurs envois déjà
   * enregistrés comme simples transferts. Retourne le nombre d'opérations reclassées.
   */
  addFamilyMembers(members: ReadonlyArray<Omit<FamilyMember, 'id'> & Partial<FamilyMember>>): Promise<number>;
  removeFamilyMember(memberId: string): Promise<void>;
  setMonthlyDataLimit(amount: number): Promise<void>;
  /** Crée une catégorie (sans doublon, insensible à la casse) ; retourne son nom final. */
  addCustomCategory(name: string): Promise<string>;
}

let repositoriesProvider: () => Promise<Repositories> = async () => {
  throw new Error('Store non configuré : appeler configureFinanceStore()');
};

/** Injection des dépôts (SQLite chiffré en production, mémoire en test). */
export const configureFinanceStore = (provider: () => Promise<Repositories>) => {
  repositoriesProvider = provider;
};

/** Dépôts configurés (partagés avec les autres stores, ex. apprentissage guidé). */
export const getConfiguredRepositories = (): Promise<Repositories> => repositoriesProvider();

const loadWindowStart = (now: Date): string => {
  const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);
  return toLocalIso(twoMonthsAgo < yearStart ? twoMonthsAgo : yearStart);
};

export const useFinanceStore = create<FinanceState>((set, get) => {
  const repos = () => repositoriesProvider();

  const reloadTransactions = async () => {
    const r = await repos();
    const now = get().now;
    const transactions = await r.transactions.listBetween(loadWindowStart(now), '9999');
    set({ transactions });
  };

  const reloadAccounts = async () => {
    const r = await repos();
    set({ accounts: mergeWithDefaults(await r.accounts.getAll()) });
  };

  return {
    ready: false,
    now: new Date(),
    accounts: [...DEFAULT_ACCOUNTS],
    transactions: [],
    debts: [],
    plannedItems: [],
    tontines: [],
    savingsGoals: [],
    budgetConfig: DEFAULT_BUDGET_CONFIG,
    paidFixedExpenseIds: [],
    learnedCategories: {},
    userName: '',
    onboarded: false,
    extraSenders: [],
    themeMode: 'system',
    unrecognizedSms: [],
    familyRequests: [],
    solidarityBudget: 0,
    widgetShowBalance: false,
    familyMembers: [],
    monthlyDataLimit: 0,
    customCategories: [],
    learningStatus: 'NEVER',

    async hydrate(now = new Date()) {
      try {
        const r = await repos();
        const month = monthKey(now);
        const [
          accounts,
          transactions,
          debts,
          plannedItems,
          tontines,
          budgetConfig,
          paid,
          learned,
          userName,
          onboarded,
          extraSenders,
          savingsGoals,
          themeMode,
          unrecognizedSms,
          familyRequests,
          solidarityBudget,
          widgetShowBalance,
          familyMembers,
          monthlyDataLimit,
          customCategories,
          learningSession,
          learningDoneAt,
        ] = await Promise.all([
          r.accounts.getAll(),
          r.transactions.listBetween(loadWindowStart(now), '9999'),
          r.debts.getAll(),
          r.plannedItems.listByMonth(month),
          r.tontines.getAll(),
          r.settings.getBudgetConfig(),
          r.settings.getJson<string[]>(PAID_FIXED_KEY(month), []),
          r.settings.getJson<Record<string, string>>(LEARNED_CATEGORIES_KEY, {}),
          r.settings.getJson<string>(USER_NAME_KEY, ''),
          r.settings.getJson<boolean>(ONBOARDED_KEY, false),
          r.settings.getJson<string[]>(EXTRA_SENDERS_KEY, []),
          r.savingsGoals.getAll(),
          r.settings.getJson<ThemeMode>(THEME_KEY, 'system'),
          r.settings.getJson<UnrecognizedSms[]>(UNRECOGNIZED_SMS_KEY, []),
          r.settings.getJson<FamilyRequest[]>(FAMILY_REQUESTS_KEY, []),
          r.settings.getJson<number>(SOLIDARITY_BUDGET_KEY, 0),
          r.settings.getJson<boolean>(WIDGET_SHOW_BALANCE_KEY, false),
          r.settings.getJson<FamilyMember[]>(FAMILY_MEMBERS_KEY, []),
          r.settings.getJson<number>(MONTHLY_DATA_LIMIT_KEY, 0),
          r.settings.getJson<string[]>(CUSTOM_CATEGORIES_KEY, []),
          r.settings.getJson<{ items: unknown[] } | null>(LEARNING_SESSION_KEY, null),
          r.settings.getJson<string | null>(LEARNING_DONE_KEY, null),
        ]);
        set({
          ready: true,
          error: undefined,
          now,
          accounts: mergeWithDefaults(accounts),
          transactions,
          debts,
          plannedItems,
          tontines,
          budgetConfig,
          paidFixedExpenseIds: paid,
          learnedCategories: learned,
          userName,
          onboarded,
          extraSenders,
          savingsGoals,
          themeMode,
          unrecognizedSms,
          familyRequests,
          solidarityBudget,
          widgetShowBalance,
          familyMembers,
          monthlyDataLimit,
          customCategories,
          learningStatus: learningSession?.items.length ? 'PAUSED' : learningDoneAt ? 'DONE' : 'NEVER',
        });
      } catch (e) {
        set({ ready: true, error: e instanceof Error ? e.message : String(e) });
      }
    },

    async ingestSms(sms) {
      const r = await repos();
      const result = await new ProcessIncomingSmsUseCase(r).execute(sms);
      if (result.status === 'RECORDED') {
        await Promise.all([reloadTransactions(), reloadAccounts()]);
        await get().autoCheckPlannedItems();
      } else if (result.status === 'UNRECOGNIZED') {
        set({ unrecognizedSms: await r.settings.getJson<UnrecognizedSms[]>(UNRECOGNIZED_SMS_KEY, []) });
      }
      return result;
    },

    async addManualTransaction(input) {
      const r = await repos();
      const nowIso = toLocalIso(new Date());
      const account = get().accounts.find(a => a.id === input.accountId);
      if (!account) {
        throw new Error(`Compte inconnu : ${input.accountId}`);
      }
      const tx: Transaction = {
        id: generateId('tx'),
        accountId: account.id,
        provider: account.provider,
        type: input.type,
        amount: input.amount,
        fee: 0,
        tax: 0,
        category: input.category,
        note: input.note,
        counterpartyName: input.counterpartyName,
        rawSms: input.rawSms,
        // Empêche un ré-import ultérieur du même SMS de créer un doublon.
        smsFingerprint: input.rawSms ? fingerprint(input.rawSms) : undefined,
        source: 'MANUAL',
        occurredAt: toLocalIso(input.occurredAt ?? new Date()),
        createdAt: nowIso,
      };
      const delta = input.type === 'INCOME' ? input.amount : -input.amount;
      const updated: Account = { ...account, currentBalance: account.currentBalance + delta, updatedAt: nowIso };
      await r.runInTransaction(async () => {
        await r.transactions.insertMany([tx]);
        await r.accounts.saveMany([updated]);
      });
      set(s => ({
        transactions: [tx, ...s.transactions],
        accounts: s.accounts.map(a => (a.id === updated.id ? updated : a)),
      }));
      await get().autoCheckPlannedItems();
      return tx;
    },

    async recategorize(transactionId, category, learn = true) {
      const r = await repos();
      const tx = get().transactions.find(t => t.id === transactionId);
      await r.transactions.update(transactionId, { category });
      const key = tx ? counterpartyKey(tx) : undefined;
      if (learn && key && tx?.type === 'EXPENSE') {
        const learnedCategories = { ...get().learnedCategories, [key]: category };
        await r.settings.setJson(LEARNED_CATEGORIES_KEY, learnedCategories);
        set({ learnedCategories });
      }
      set(s => ({ transactions: s.transactions.map(t => (t.id === transactionId ? { ...t, category } : t)) }));
    },

    async deleteTransaction(transactionId) {
      const r = await repos();
      await r.transactions.delete(transactionId);
      set(s => ({ transactions: s.transactions.filter(t => t.id !== transactionId && t.parentId !== transactionId) }));
    },

    async setAccountBalance(accountId, balance) {
      const r = await repos();
      const account = get().accounts.find(a => a.id === accountId);
      if (!account) {
        return;
      }
      const updated = { ...account, currentBalance: balance, updatedAt: toLocalIso(new Date()) };
      await r.accounts.saveMany([updated]);
      set(s => ({ accounts: s.accounts.map(a => (a.id === accountId ? updated : a)) }));
    },

    async saveDebt(input) {
      const r = await repos();
      const debt: Debt = {
        id: input.id ?? generateId('debt'),
        createdAt: input.createdAt ?? toLocalIso(new Date()),
        amountRepaid: input.amountRepaid ?? 0,
        isSettled: input.isSettled ?? false,
        contactName: input.contactName,
        phone: input.phone,
        amount: input.amount,
        direction: input.direction,
        dueDate: input.dueDate,
        note: input.note,
      };
      await r.debts.save(debt);
      set({ debts: await r.debts.getAll() });
    },

    async repayDebt(debtId, amount) {
      const r = await repos();
      const debt = get().debts.find(d => d.id === debtId);
      if (!debt) {
        return;
      }
      await r.debts.save(applyRepayment(debt, amount));
      set({ debts: await r.debts.getAll() });
    },

    async deleteDebt(debtId) {
      const r = await repos();
      await r.debts.delete(debtId);
      set(s => ({ debts: s.debts.filter(d => d.id !== debtId) }));
    },

    async savePlannedItem(input) {
      const r = await repos();
      const item: PlannedItem = {
        ...input,
        id: input.id ?? generateId('plan'),
        month: input.month ?? monthKey(get().now),
        isDone: input.isDone ?? false,
      };
      await r.plannedItems.saveMany([item]);
      set({ plannedItems: await r.plannedItems.listByMonth(monthKey(get().now)) });
      // Une ligne ajoutée après coup est aussitôt cochée si l'opération du mois existe déjà.
      await get().autoCheckPlannedItems();
    },

    async togglePlannedItem(itemId, matchedTransactionId) {
      const r = await repos();
      const item = get().plannedItems.find(i => i.id === itemId);
      if (!item) {
        return;
      }
      const updated: PlannedItem =
        item.isDone && !matchedTransactionId
          ? { ...item, isDone: false, matchedTransactionId: undefined }
          : { ...item, isDone: true, matchedTransactionId: matchedTransactionId ?? item.matchedTransactionId };
      await r.plannedItems.saveMany([updated]);
      set(s => ({ plannedItems: s.plannedItems.map(i => (i.id === itemId ? updated : i)) }));
    },

    async deletePlannedItem(itemId) {
      const r = await repos();
      await r.plannedItems.delete(itemId);
      set(s => ({ plannedItems: s.plannedItems.filter(i => i.id !== itemId) }));
    },

    async autoCheckPlannedItems() {
      const { plannedItems, transactions, now } = get();
      const month = monthKey(now);
      const matched = autoMatchPlannedItems(
        plannedItems,
        transactions.filter(t => t.occurredAt.startsWith(month)),
      );
      if (matched.length > 0) {
        const r = await repos();
        await r.plannedItems.saveMany(matched);
        set(s => ({ plannedItems: s.plannedItems.map(i => matched.find(m => m.id === i.id) ?? i) }));
      }
      return matched.length;
    },

    async carryOverToNextMonth() {
      const r = await repos();
      const month = monthKey(get().now);
      const existing = await r.plannedItems.listByMonth(nextMonthKey(month));
      const items = carryOverToNextMonth(get().plannedItems, existing);
      await r.plannedItems.saveMany(items);
      return items.length;
    },

    async saveBudgetConfig(config) {
      const r = await repos();
      await r.settings.saveBudgetConfig(config);
      set({ budgetConfig: config });
    },

    async toggleFixedExpensePaid(fixedExpenseId) {
      const r = await repos();
      const current = get().paidFixedExpenseIds;
      const next = current.includes(fixedExpenseId)
        ? current.filter(id => id !== fixedExpenseId)
        : [...current, fixedExpenseId];
      await r.settings.setJson(PAID_FIXED_KEY(monthKey(get().now)), next);
      set({ paidFixedExpenseIds: next });
    },

    async saveTontine(input) {
      const r = await repos();
      const tontine: Tontine = {
        ...input,
        id: input.id ?? generateId('tontine'),
        paidContributions: input.paidContributions ?? [],
      };
      await r.tontines.save(tontine);
      set({ tontines: await r.tontines.getAll() });
    },

    async payTontine(tontineId) {
      const r = await repos();
      const t = get().tontines.find(x => x.id === tontineId);
      if (!t) {
        return;
      }
      const updated = { ...t, paidContributions: [...t.paidContributions, toLocalIso(new Date())] };
      await r.tontines.save(updated);
      set(s => ({ tontines: s.tontines.map(x => (x.id === tontineId ? updated : x)) }));
      await get().addManualTransaction({
        accountId: CASH_ACCOUNT_ID,
        type: 'EXPENSE',
        amount: t.contributionAmount,
        category: CATEGORIES.TONTINE,
        note: `Cotisation ${t.name}`,
      });
    },

    async deleteTontine(tontineId) {
      const r = await repos();
      await r.tontines.delete(tontineId);
      set(s => ({ tontines: s.tontines.filter(t => t.id !== tontineId) }));
    },

    async saveGoal(input) {
      const r = await repos();
      const goal: SavingsGoal = {
        ...input,
        id: input.id ?? generateId('goal'),
        contributions: input.contributions ?? [],
        createdAt: input.createdAt ?? toLocalIso(new Date()),
      };
      await r.savingsGoals.save(goal);
      set({ savingsGoals: await r.savingsGoals.getAll() });
    },

    async contributeToGoal(goalId, amount) {
      const r = await repos();
      const goal = get().savingsGoals.find(g => g.id === goalId);
      if (!goal || amount === 0) {
        return;
      }
      const updated = { ...goal, contributions: [...goal.contributions, { date: toLocalIso(new Date()), amount }] };
      await r.savingsGoals.save(updated);
      set(s => ({ savingsGoals: s.savingsGoals.map(g => (g.id === goalId ? updated : g)) }));
    },

    async deleteGoal(goalId) {
      const r = await repos();
      await r.savingsGoals.delete(goalId);
      set(s => ({ savingsGoals: s.savingsGoals.filter(g => g.id !== goalId) }));
    },

    async completeOnboarding(userName, config) {
      const r = await repos();
      await r.settings.setJson(USER_NAME_KEY, userName);
      await r.settings.setJson(ONBOARDED_KEY, true);
      await r.settings.saveBudgetConfig(config);
      await r.accounts.saveMany(get().accounts);
      set({ userName, onboarded: true, budgetConfig: config });
    },

    async getMonthTransactions(month) {
      const windowStart = loadWindowStart(get().now).slice(0, 7);
      if (month >= windowStart) {
        return get().transactions.filter(t => t.occurredAt.startsWith(month));
      }
      const r = await repos();
      return r.transactions.listBetween(`${month}-01`, `${nextMonthKey(month)}-01`);
    },

    async loadAllTransactions() {
      const r = await repos();
      return r.transactions.listAll();
    },

    async setUserName(userName) {
      const r = await repos();
      await r.settings.setJson(USER_NAME_KEY, userName);
      set({ userName });
    },

    async setThemeMode(mode) {
      const r = await repos();
      await r.settings.setJson(THEME_KEY, mode);
      set({ themeMode: mode });
    },

    async resolveUnrecognizedSms(smsId, input) {
      const pending = get().unrecognizedSms.find(u => u.id === smsId);
      const tx = await get().addManualTransaction({
        ...input,
        rawSms: input.rawSms ?? pending?.body,
        occurredAt: input.occurredAt ?? (pending ? new Date(pending.receivedAt) : undefined),
      });
      await get().dismissUnrecognizedSms(smsId);
      return tx;
    },

    async dismissUnrecognizedSms(smsId) {
      const r = await repos();
      const unrecognizedSms = get().unrecognizedSms.filter(u => u.id !== smsId);
      await r.settings.setJson(UNRECOGNIZED_SMS_KEY, unrecognizedSms);
      set({ unrecognizedSms });
    },

    async saveFamilyRequest(input) {
      const r = await repos();
      const existing = get().familyRequests.find(f => f.id === input.id);
      const request: FamilyRequest = {
        status: 'PENDING',
        givenAmount: 0,
        createdAt: toLocalIso(new Date()),
        ...existing,
        ...input,
        id: input.id ?? generateId('fam'),
      };
      const familyRequests = [request, ...get().familyRequests.filter(f => f.id !== request.id)];
      await r.settings.setJson(FAMILY_REQUESTS_KEY, familyRequests);
      set({ familyRequests });
    },

    async decideFamilyRequest(requestId, kind, givenAmount = 0, accountId) {
      const r = await repos();
      const request = get().familyRequests.find(f => f.id === requestId);
      if (!request) {
        return;
      }
      const now = new Date();
      let decided = decideRequest(request, kind, givenAmount, toLocalIso(now));
      if (decided.givenAmount > 0) {
        if (accountId) {
          const tx = await get().addManualTransaction({
            accountId,
            type: 'EXPENSE',
            amount: decided.givenAmount,
            category: CATEGORIES.FAMILY,
            counterpartyName: request.contactName,
            note: request.reason,
          });
          decided = { ...decided, transactionId: tx.id };
        } else {
          const since = toLocalIso(new Date(now.getTime() - 3 * 24 * 3600 * 1000));
          const sent = get()
            .transactions.filter(t => t.type === 'EXPENSE' && t.amount === decided.givenAmount && t.occurredAt >= since)
            .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
          if (sent) {
            await get().recategorize(sent.id, CATEGORIES.FAMILY, true);
            decided = { ...decided, transactionId: sent.id };
          }
        }
      }
      const familyRequests = get().familyRequests.map(f => (f.id === requestId ? decided : f));
      await r.settings.setJson(FAMILY_REQUESTS_KEY, familyRequests);
      set({ familyRequests });
    },

    async deleteFamilyRequest(requestId) {
      const r = await repos();
      const familyRequests = get().familyRequests.filter(f => f.id !== requestId);
      await r.settings.setJson(FAMILY_REQUESTS_KEY, familyRequests);
      set({ familyRequests });
    },

    async setSolidarityBudget(amount) {
      const r = await repos();
      await r.settings.setJson(SOLIDARITY_BUDGET_KEY, amount);
      set({ solidarityBudget: amount });
    },

    async addFamilyMembers(input) {
      const r = await repos();
      const added = input.map(m => ({ ...m, id: m.id ?? generateId('member'), name: m.name.trim() }));
      const familyMembers = mergeFamilyMembers(get().familyMembers, added);
      await r.settings.setJson(FAMILY_MEMBERS_KEY, familyMembers);
      set({ familyMembers });
      const tails = familyPhoneTails(added);
      const toReclassify = get().transactions.filter(
        t =>
          t.type === 'EXPENSE' &&
          (t.category === CATEGORIES.TRANSFER || t.category === CATEGORIES.OTHER) &&
          isFamilyPhone(t.counterpartyPhone, tails),
      );
      for (const t of toReclassify) {
        await r.transactions.update(t.id, { category: CATEGORIES.FAMILY });
      }
      const ids = new Set(toReclassify.map(t => t.id));
      set(st => ({
        transactions: st.transactions.map(t => (ids.has(t.id) ? { ...t, category: CATEGORIES.FAMILY } : t)),
      }));
      return toReclassify.length;
    },

    async removeFamilyMember(memberId) {
      const r = await repos();
      const familyMembers = get().familyMembers.filter(m => m.id !== memberId);
      await r.settings.setJson(FAMILY_MEMBERS_KEY, familyMembers);
      set({ familyMembers });
    },

    async addCustomCategory(name) {
      const clean = name.replace(/\s+/g, ' ').trim();
      const existing = [...Object.values(CATEGORIES), ...get().customCategories].find(
        c => c.toLowerCase() === clean.toLowerCase(),
      );
      if (existing || !clean) {
        return existing ?? clean;
      }
      const r = await repos();
      const customCategories = [...get().customCategories, clean];
      await r.settings.setJson(CUSTOM_CATEGORIES_KEY, customCategories);
      set({ customCategories });
      return clean;
    },

    async setMonthlyDataLimit(amount) {
      const r = await repos();
      await r.settings.setJson(MONTHLY_DATA_LIMIT_KEY, amount);
      set({ monthlyDataLimit: amount });
    },

    async setWidgetShowBalance(show) {
      const r = await repos();
      await r.settings.setJson(WIDGET_SHOW_BALANCE_KEY, show);
      set({ widgetShowBalance: show });
    },

    async setExtraSenders(senders) {
      const r = await repos();
      const extraSenders = senders.map(x => x.trim()).filter(Boolean);
      await r.settings.setJson(EXTRA_SENDERS_KEY, extraSenders);
      set({ extraSenders });
    },
  };
});

/** Garantit la présence des comptes par défaut (dont la Poche), triés dans l'ordre d'affichage. */
const mergeWithDefaults = (stored: Account[]): Account[] => {
  const defaults = DEFAULT_ACCOUNTS.map(d => stored.find(s => s.id === d.id) ?? { ...d });
  const extras = stored.filter(s => !DEFAULT_ACCOUNTS.some(d => d.id === s.id));
  return [...defaults, ...extras];
};
