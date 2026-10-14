import { create } from 'zustand';
import { toLocalIso } from '../../core/dates';
import type { FamilyMember } from '../../domain/models/FamilyMember';
import { FAMILY_MEMBERS_KEY, familyPhoneTails } from '../../domain/usecases/FamilyMembers';
import {
  buildLearningQueue,
  CommitLearningSessionUseCase,
  EMPTY_LEARNED_STATE,
  LEARNING_PATTERNS_KEY,
  LEARNING_SESSION_KEY,
  nextUndecidedIndex,
  referenceKey,
  replayDecisions,
  sortByConfidence,
  summarizeSession,
  type CommitReport,
  type Decision,
  type LearnedState,
  type LearningItem,
  type LearningSession,
  type QueueBuildResult,
  type RawSms,
} from '../../domain/usecases/LearningQueue';
import { EXTRA_SENDERS_KEY, LEARNED_CATEGORIES_KEY } from '../../domain/usecases/ProcessIncomingSms';
import { drainPendingSms, readSmsInbox } from '../../services/sms/SmsBridge';
import { getConfiguredRepositories, useFinanceStore } from './useFinanceStore';

/**
 * Store dédié (et non une tranche de useFinanceStore) : une session contient des
 * centaines de SMS et change à chaque tap ; l'isoler évite de re-rendre tous les
 * écrans financiers et garde le brouillon séparé des données validées.
 */
export type LearningStatus = 'IDLE' | 'LOADING' | 'ACTIVE' | 'DONE';

export interface LearningContext {
  extraSenders: string[];
  learnedCategories: Record<string, string>;
  familyTails: Set<string>;
}

interface LearningState {
  status: LearningStatus;
  session?: LearningSession;
  /** Votes validés (sessions précédentes) — base de l'apprentissage. */
  baseLearned: LearnedState;
  /** baseLearned + décisions du brouillon (recalculé à chaque décision : l'annulation est exacte). */
  learned: LearnedState;
  context: LearningContext;
  loading: { done: number; total: number };
  /** Historique des décisions de la session (pour « Annuler »). */
  history: string[];
  lastReport?: CommitReport & { remaining: number };
  error?: string;

  /** Recharge une session interrompue (reprise au même SMS). */
  restore(): Promise<boolean>;
  /** Démarre une session depuis l'historique SMS (ou des messages fournis, en test). */
  start(options?: {
    messages?: RawSms[];
    sinceMs?: number;
    chunkSize?: number;
  }): Promise<QueueBuildResult['excluded'] | undefined>;
  decide(decision: Decision): Promise<void>;
  undo(): Promise<void>;
  /** Revient sur un SMS déjà traité (ex. « Revoir les ignorés »). */
  reopen(itemId: string): Promise<void>;
  /** Abandonne le brouillon : rien n'est enregistré. */
  discard(): Promise<void>;
  /** Valide les décisions (transaction unique) ; les SMS non traités restent pour plus tard. */
  commit(now?: Date): Promise<CommitReport>;
  reset(): void;
}

const DAY_MS = 24 * 3600 * 1000;
const yieldToUi = () => new Promise<void>(resolve => setTimeout(resolve, 0));

const loadContext = async (): Promise<{ context: LearningContext; baseLearned: LearnedState }> => {
  const r = await getConfiguredRepositories();
  const [extraSenders, learnedCategories, members, baseLearned] = await Promise.all([
    r.settings.getJson<string[]>(EXTRA_SENDERS_KEY, []),
    r.settings.getJson<Record<string, string>>(LEARNED_CATEGORIES_KEY, {}),
    r.settings.getJson<FamilyMember[]>(FAMILY_MEMBERS_KEY, []),
    r.settings.getJson<LearnedState>(LEARNING_PATTERNS_KEY, EMPTY_LEARNED_STATE),
  ]);
  return { context: { extraSenders, learnedCategories, familyTails: familyPhoneTails(members) }, baseLearned };
};

const persist = async (session: LearningSession | null) => {
  const r = await getConfiguredRepositories();
  await r.settings.setJson(LEARNING_SESSION_KEY, session);
};

export const useLearningStore = create<LearningState>((set, get) => ({
  status: 'IDLE',
  baseLearned: EMPTY_LEARNED_STATE,
  learned: EMPTY_LEARNED_STATE,
  context: { extraSenders: [], learnedCategories: {}, familyTails: new Set() },
  loading: { done: 0, total: 0 },
  history: [],

  async restore() {
    const r = await getConfiguredRepositories();
    const session = await r.settings.getJson<LearningSession | null>(LEARNING_SESSION_KEY, null);
    if (!session || session.items.length === 0) {
      return false;
    }
    const { context, baseLearned } = await loadContext();
    set({
      status: nextUndecidedIndex(session, session.index) === -1 ? 'DONE' : 'ACTIVE',
      session,
      context,
      baseLearned,
      learned: replayDecisions(baseLearned, session.items, session.decisions, context.extraSenders),
      history: Object.keys(session.decisions),
      error: undefined,
    });
    return true;
  },

  async start({ messages, sinceMs = Date.now() - 180 * DAY_MS, chunkSize = 100 } = {}) {
    set({ status: 'LOADING', loading: { done: 0, total: 0 }, error: undefined, lastReport: undefined });
    try {
      const r = await getConfiguredRepositories();
      const raw: RawSms[] =
        messages ??
        [...(await readSmsInbox(sinceMs)), ...(await drainPendingSms())].map(m => ({
          sender: m.sender,
          body: m.body,
          receivedAt: toLocalIso(new Date(m.timestamp)),
        }));
      const { context, baseLearned } = await loadContext();
      const existing = await r.transactions.listAll();
      const known = {
        fingerprints: new Set(existing.map(t => t.smsFingerprint).filter((f): f is string => !!f)),
        references: new Set(existing.filter(t => t.reference).map(t => referenceKey(t.provider, t.reference!))),
      };
      // Analyse par lots : l'interface reste fluide même sur 500+ SMS.
      const items: LearningItem[] = [];
      const excluded: QueueBuildResult['excluded'] = {
        NOT_WHITELISTED: 0,
        SECURITY_CODE: 0,
        NOT_FINANCIAL: 0,
        ALREADY_RECORDED: 0,
        DUPLICATE_IN_INBOX: 0,
      };
      const seen = new Set<string>();
      set({ loading: { done: 0, total: raw.length } });
      for (let i = 0; i < raw.length; i += chunkSize) {
        const part = buildLearningQueue(raw.slice(i, i + chunkSize), known, context.extraSenders);
        for (const item of part.items) {
          if (seen.has(item.id)) {
            excluded.DUPLICATE_IN_INBOX++;
          } else {
            seen.add(item.id);
            items.push(item);
          }
        }
        (Object.keys(excluded) as Array<keyof typeof excluded>).forEach(k => (excluded[k] += part.excluded[k]));
        set({ loading: { done: Math.min(raw.length, i + chunkSize), total: raw.length } });
        await yieldToUi();
      }
      // Doublons par référence entre lots : un second passage global les écarte.
      const global = buildLearningQueue(items, known, context.extraSenders);
      excluded.DUPLICATE_IN_INBOX += global.excluded.DUPLICATE_IN_INBOX;
      const ordered = sortByConfidence(global.items, baseLearned, context);
      const session: LearningSession = {
        version: 1,
        startedAt: toLocalIso(new Date()),
        items: ordered,
        index: 0,
        decisions: {},
        excluded,
      };
      await persist(session);
      set({
        status: ordered.length === 0 ? 'DONE' : 'ACTIVE',
        session,
        context,
        baseLearned,
        learned: baseLearned,
        history: [],
      });
      return excluded;
    } catch (e) {
      set({ status: 'IDLE', error: e instanceof Error ? e.message : String(e) });
      return undefined;
    }
  },

  async decide(decision) {
    const { session, baseLearned, context, history } = get();
    if (!session) {
      return;
    }
    const item = session.items[session.index];
    if (!item) {
      return;
    }
    const decisions = { ...session.decisions, [item.id]: decision };
    const next = nextUndecidedIndex({ items: session.items, decisions }, session.index + 1);
    const updated: LearningSession = { ...session, decisions, index: next === -1 ? session.index : next };
    set({
      session: updated,
      learned: replayDecisions(baseLearned, updated.items, decisions, context.extraSenders),
      history: [...history.filter(id => id !== item.id), item.id],
      status: next === -1 ? 'DONE' : 'ACTIVE',
    });
    await persist(updated);
  },

  async undo() {
    const { history } = get();
    const last = history[history.length - 1];
    if (last) {
      await get().reopen(last);
    }
  },

  async reopen(itemId) {
    const { session, baseLearned, context, history } = get();
    if (!session) {
      return;
    }
    const index = session.items.findIndex(i => i.id === itemId);
    if (index === -1) {
      return;
    }
    const decisions = { ...session.decisions };
    delete decisions[itemId];
    const updated: LearningSession = { ...session, decisions, index };
    set({
      session: updated,
      learned: replayDecisions(baseLearned, updated.items, decisions, context.extraSenders),
      history: history.filter(id => id !== itemId),
      status: 'ACTIVE',
    });
    await persist(updated);
  },

  async discard() {
    await persist(null);
    set({ status: 'IDLE', session: undefined, history: [], learned: get().baseLearned });
  },

  async commit(now = new Date()) {
    const { session, context } = get();
    if (!session) {
      return { recorded: 0, skippedDuplicates: 0, ignored: 0 };
    }
    const r = await getConfiguredRepositories();
    const report = await new CommitLearningSessionUseCase(r).execute(session, now, context.extraSenders);
    const remainingItems = session.items.filter(i => !session.decisions[i.id]);
    if (remainingItems.length > 0) {
      await persist({ ...session, items: remainingItems, decisions: {}, index: 0, startedAt: toLocalIso(now) });
    }
    const { baseLearned } = await loadContext();
    set({
      session: undefined,
      status: 'IDLE',
      history: [],
      baseLearned,
      learned: baseLearned,
      lastReport: { ...report, remaining: remainingItems.length },
    });
    await useFinanceStore.getState().hydrate();
    return report;
  },

  reset() {
    set({ status: 'IDLE', session: undefined, history: [], lastReport: undefined, error: undefined });
  },
}));

export const learningSummary = summarizeSession;
