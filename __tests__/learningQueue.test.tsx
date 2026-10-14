import '@testing-library/react-native/extend-expect';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { PaperProvider } from 'react-native-paper';
import { CATEGORIES } from '../src/core/categories';
import { fingerprint } from '../src/core/id';
import { runMigrations } from '../src/data/database/schema';
import { createSqliteRepositories } from '../src/data/repositories/SqliteRepositories';
import {
  buildLearningQueue,
  CommitLearningSessionUseCase,
  EMPTY_LEARNED_STATE,
  keywordsOf,
  learnFromDecision,
  LEARNING_DONE_KEY,
  LEARNING_PATTERNS_KEY,
  LEARNING_SESSION_KEY,
  MIN_VOTES,
  nextUndecidedIndex,
  proposeFor,
  replayDecisions,
  sortByConfidence,
  summarizeSession,
  type Decision,
  type LearnedState,
  type LearningSession,
  type RawSms,
} from '../src/domain/usecases/LearningQueue';
import { LEARNED_CATEGORIES_KEY } from '../src/domain/usecases/ProcessIncomingSms';
import { LearningScreen } from '../src/presentation/screens/LearningScreen';
import { configureFinanceStore, useFinanceStore } from '../src/presentation/store/useFinanceStore';
import { useLearningStore } from '../src/presentation/store/useLearningStore';
import { darkTheme, theme } from '../src/presentation/theme/theme';
import { createInMemoryRepositories, tx } from './helpers/inMemoryRepositories';
import { createNodeSqliteDatabase } from './helpers/nodeSqliteDatabase';

// ---------------------------------------------------------------- Fixtures (10 SMS mélangés)
const sms = (sender: string, body: string, day: number): RawSms => ({
  sender,
  body,
  receivedAt: `2026-10-${String(day).padStart(2, '0')}T10:00:00`,
});
const tezda = (n: number, day: number) =>
  sms(
    'MoovMoney',
    `Paiement reussi auprés du marchand TEZDA\nMontant: ${n} 000,00 FCFA\nFrais: 0,00 FCFA\nTotal: ${n} 000,00 FCFA\nDate: ${day}/10/2026 20:03\nTID: TZ${n}${day}AB\nSolde: 9 891,00 FCFA`,
    day,
  );

const MOOV_WITHDRAW = sms(
  'MoovMoney',
  `Retrait reussi auprès de l'Agent IBRAHIM ILBOUDO\nCode d'agent: 1003631\nMontant: 1 000,00 FCFA\nFrais: 10,00 FCFA\nTotal: 1 010,00 FCFA\nDate: 03/10/2026 18:17:58\nTxn ID: DIU3L2SENF\nSolde: 16 316,00 FCFA`,
  3,
);
const ORANGE_PAY = sms(
  'OrangeMoney',
  `Votre paiement de 500.00 FCFA, Frais: 4.3478 FCFA, Taxe: 0.6522 FCFA a WENDSONGUEDE DAVID SAWADOGO a ete effectue avec succes. Votre solde est de : 192284.67 FCFA. Trans id: MP261012.1637.71387533.`,
  12,
);
const ORANGE_IN = sms(
  'OrangeMoney',
  `Vous avez recu 110560.48 FCFA, Frais:  FCFA, Taxe:  FCFA du 76900142,ROMARIC. Le solde de votre compte est de 189986.92 FCFA Trans ID: PP261010.0944.25789150.`,
  10,
);
const WAVE_IN = sms(
  'Wave',
  `Vous avez reçu 3.000F De OKPEOLOU Eric (+2250747070797) 24/09/2026 à 10:38 +infos: 80001257 Avec UBA xot-25m7hbegg2y40`,
  9,
);
const WAVE_OUT = sms(
  'Wave',
  `Vous avez retiré 2.500F chez Sadja Design le 20/09/2026  18:19. Solde Wave: 500F Avec UBA ATXVXMWMMIVVXJH64FX`,
  8,
);
const GENERIC_SENT = sms(
  'OrangeMoney',
  `Vous avez envoye 5 000 FCFA au 70112233, MOUSSA. Frais: 50 FCFA. Nouveau solde: 40 000 FCFA`,
  11,
);
const UNKNOWN_1 = sms(
  'OrangeMoney',
  'Cher client, votre facture SONABEL de 12 450 FCFA a ete reglee. Nouveau solde 8 300 FCFA.',
  7,
);
const UNKNOWN_2 = sms('MoovMoney', 'Operation enregistree : debit 2 000 FCFA, reference K88.', 6);
const OTP = sms('OrangeMoney', 'Votre code OTP est 482913. Ne le communiquez a personne. Retrait de 5000 FCFA', 13);
const SPAM_SENDER = sms('Promo', 'Vous avez reçu 5 000 FCFA de bonus !', 13);
const PROMO = sms('Orange', 'Bienvenue chez Orange, profitez de nos offres', 13);

const TEN = [
  MOOV_WITHDRAW,
  UNKNOWN_1,
  ORANGE_PAY,
  WAVE_OUT,
  GENERIC_SENT,
  ORANGE_IN,
  UNKNOWN_2,
  WAVE_IN,
  tezda(6, 4),
  tezda(2, 5),
];
const NO_KNOWN = { fingerprints: new Set<string>(), references: new Set<string>() };

type RecordDecision = Extract<Decision, { action: 'CONFIRM' | 'CORRECT' }>;
const confirmOf = (p: ReturnType<typeof proposeFor>): RecordDecision => ({
  action: 'CONFIRM',
  type: p.type,
  category: p.category,
  accountId: p.accountId,
  amount: p.amount,
  counterpartyName: p.counterpartyName,
});

describe('LearningQueue : construction de la file', () => {
  test('10 SMS Orange / Moov / Wave : ordre de confiance décroissante', () => {
    const { items } = buildLearningQueue(TEN, NO_KNOWN);
    expect(items).toHaveLength(10);
    const ordered = sortByConfidence(items, EMPTY_LEARNED_STATE);
    const confidences = ordered.map(i => proposeFor(i, EMPTY_LEARNED_STATE).confidence);
    expect([...confidences].sort((a, b) => b - a)).toEqual(confidences);
    const sources = ordered.map(i => proposeFor(i, EMPTY_LEARNED_STATE).source);
    expect(sources.slice(-2)).toEqual(['UNRECOGNIZED', 'UNRECOGNIZED']);
    // Haute confiance d'abord (règles opérateur), la règle générique ensuite, triés du plus récent
    expect(ordered[0].body).toBe(ORANGE_PAY.body);
    expect(ordered[7].body).toBe(GENERIC_SENT.body);
    expect(ordered.slice(-2).map(i => i.body)).toEqual([UNKNOWN_1.body, UNKNOWN_2.body]);
  });

  test('OTP, expéditeurs non agréés, non financiers, déjà enregistrés et doublons exclus sans action', () => {
    const known = {
      fingerprints: new Set([fingerprint(WAVE_OUT.body)]),
      references: new Set(['MOOV|DIU3L2SENF']),
    };
    const { items, excluded } = buildLearningQueue(
      [...TEN, OTP, SPAM_SENDER, PROMO, ORANGE_PAY, { ...ORANGE_PAY, body: `${ORANGE_PAY.body} ` }],
      known,
    );
    expect(excluded).toEqual({
      NOT_WHITELISTED: 1,
      SECURITY_CODE: 1,
      NOT_FINANCIAL: 1,
      ALREADY_RECORDED: 2,
      DUPLICATE_IN_INBOX: 2,
    });
    expect(items).toHaveLength(8);
    expect(items.some(i => /OTP/.test(i.body))).toBe(false);
  });

  test('expéditeur ajouté par l’utilisateur accepté ; mots-clés distinctifs', () => {
    const custom = sms('MaBanque', 'Votre compte a ete debite de 10 000 XOF. Libelle: LOYER', 1);
    expect(buildLearningQueue([custom], NO_KNOWN).items).toHaveLength(0);
    expect(buildLearningQueue([custom], NO_KNOWN, ['MaBanque']).items).toHaveLength(1);
    expect(keywordsOf('Paiement reussi auprés du marchand TEZDA Montant')).toEqual(['TEZDA']);
  });
});

describe('LearningQueue : apprentissage actif', () => {
  test('2 corrections « Famille » sur le même marchand → le 3e est proposé « Famille » avec indicateur', () => {
    const items = [tezda(1, 1), tezda(2, 2), tezda(3, 3)].map(m => ({ ...m, id: fingerprint(m.body) }));
    let learned: LearnedState = EMPTY_LEARNED_STATE;
    expect(proposeFor(items[0], learned)).toMatchObject({ source: 'PARSER', category: CATEGORIES.OTHER });
    for (const item of items.slice(0, 2)) {
      const p = proposeFor(item, learned);
      learned = learnFromDecision(learned, item, { ...confirmOf(p), action: 'CORRECT', category: CATEGORIES.FAMILY });
      if (item === items[0]) {
        // 1 seul choix : pas encore assez pour écraser le parseur
        expect(proposeFor(items[1], learned).source).toBe('PARSER');
      }
    }
    const third = proposeFor(items[2], learned);
    expect(third).toMatchObject({ source: 'LEARNED', category: CATEGORIES.FAMILY, learnedVotes: MIN_VOTES });
    expect(third.confidence).toBeGreaterThanOrEqual(0.8);
  });

  test('le type appris l’emporte aussi ; un vote contraire réduit la confiance', () => {
    const item = { ...UNKNOWN_2, id: 'u' };
    let learned: LearnedState = EMPTY_LEARNED_STATE;
    const correction: Decision = {
      action: 'CORRECT',
      type: 'AIRTIME_RECHARGE',
      category: CATEGORIES.AIRTIME,
      accountId: 'moov-money',
      amount: 2000,
    };
    learned = learnFromDecision(learned, item, correction);
    learned = learnFromDecision(learned, item, correction);
    const p = proposeFor(item, learned);
    expect(p).toMatchObject({ source: 'LEARNED', type: 'AIRTIME_RECHARGE', category: CATEGORIES.AIRTIME });
    const mixed = learnFromDecision(learned, item, { ...correction, category: CATEGORIES.OTHER });
    expect(proposeFor(item, mixed).confidence).toBeLessThan(p.confidence);
  });

  test('jamais d’apprentissage depuis un rejet ou un code de sécurité ; rejeu = annulation exacte', () => {
    const item = { ...tezda(1, 1), id: 'a' };
    const d: Decision = {
      action: 'CORRECT',
      type: 'EXPENSE',
      category: CATEGORIES.FAMILY,
      accountId: 'moov-money',
      amount: 1000,
    };
    expect(learnFromDecision(EMPTY_LEARNED_STATE, item, { action: 'IGNORE', reason: 'SPAM' })).toBe(
      EMPTY_LEARNED_STATE,
    );
    expect(learnFromDecision(EMPTY_LEARNED_STATE, OTP, d)).toBe(EMPTY_LEARNED_STATE);
    const once = learnFromDecision(EMPTY_LEARNED_STATE, item, d);
    expect(replayDecisions(EMPTY_LEARNED_STATE, [item], { a: d })).toEqual(once);
    expect(replayDecisions(EMPTY_LEARNED_STATE, [item], {})).toEqual(EMPTY_LEARNED_STATE);
  });

  test('résumé de session et prochain SMS sans décision', () => {
    const items = TEN.slice(0, 4).map((m, i) => ({ ...m, id: `i${i}` }));
    const decisions: Record<string, Decision> = {
      i0: { action: 'IGNORE', reason: 'SPAM' },
      i2: { action: 'CONFIRM', type: 'EXPENSE', category: 'Autre', accountId: 'bank', amount: 1 },
    };
    expect(summarizeSession({ items, decisions })).toEqual({
      total: 4,
      recorded: 1,
      ignored: 1,
      ignoredByReason: { SPAM: 1, OTP: 0, DUPLICATE: 0, OTHER: 0 },
      remaining: 2,
    });
    expect(nextUndecidedIndex({ items, decisions }, 2)).toBe(3);
    expect(nextUndecidedIndex({ items, decisions }, 4)).toBe(1);
    expect(nextUndecidedIndex({ items, decisions: { ...decisions, i1: decisions.i0, i3: decisions.i0 } }, 0)).toBe(-1);
  });
});

const sessionOf = (
  raw: RawSms[],
  decide: (p: ReturnType<typeof proposeFor>, i: number) => Decision | undefined,
): LearningSession => {
  const items = buildLearningQueue(raw, NO_KNOWN).items;
  const decisions: Record<string, Decision> = {};
  items.forEach((item, i) => {
    const d = decide(proposeFor(item, EMPTY_LEARNED_STATE), i);
    if (d) {
      decisions[item.id] = d;
    }
  });
  return {
    version: 1,
    startedAt: 'x',
    items,
    index: 0,
    decisions,
    excluded: { NOT_WHITELISTED: 0, SECURITY_CODE: 0, NOT_FINANCIAL: 0, ALREADY_RECORDED: 0, DUPLICATE_IN_INBOX: 0 },
  };
};

describe('CommitLearningSessionUseCase', () => {
  test('écritures complètes (frais, Poche), corrections, ignorés, apprentissage persisté', async () => {
    const repos = createInMemoryRepositories();
    const session = sessionOf([MOOV_WITHDRAW, tezda(2, 5), UNKNOWN_1, ORANGE_PAY], (p, i) =>
      i === 3
        ? ({ action: 'IGNORE', reason: 'DUPLICATE' } as Decision)
        : i === 1
        ? { ...confirmOf(p), action: 'CORRECT', category: 'Cadeaux' }
        : i === 2
        ? { ...confirmOf(p), action: 'CORRECT', amount: 12450, category: CATEGORIES.BILLS }
        : confirmOf(p),
    );
    const report = await new CommitLearningSessionUseCase(repos).execute(session, new Date(2026, 9, 14));
    expect(report).toEqual({ recorded: 3, skippedDuplicates: 0, ignored: 1 });
    const all = await repos.transactions.listAll();
    expect(all.map(t => t.type).sort()).toEqual(
      ['CASH_DEPOSIT', 'CASH_WITHDRAWAL', 'EXPENSE', 'EXPENSE', 'FEE'].sort(),
    );
    expect(all.find(t => t.counterpartyName === 'TEZDA')?.category).toBe('Cadeaux');
    expect(all.find(t => t.amount === 12450)).toMatchObject({
      category: CATEGORIES.BILLS,
      accountId: 'orange-money',
      rawSms: UNKNOWN_1.body,
    });
    expect((await repos.accounts.getAll()).find(a => a.id === 'cash-wallet')?.currentBalance).toBe(1000);
    expect(await repos.settings.getJson(LEARNED_CATEGORIES_KEY, {})).toEqual({ TEZDA: 'Cadeaux' });
    const patterns = await repos.settings.getJson<LearnedState>(LEARNING_PATTERNS_KEY, EMPTY_LEARNED_STATE);
    expect(patterns.patterns['cp:TEZDA'].categories).toEqual({ Cadeaux: 1 });
    expect(await repos.settings.getJson(LEARNING_SESSION_KEY, 'x')).toBeNull();
    expect(await repos.settings.getJson(LEARNING_DONE_KEY, null)).not.toBeNull();
  });

  test('doublon arrivé entre-temps (SMS temps réel) : non réinséré', async () => {
    const repos = createInMemoryRepositories();
    const session = sessionOf([ORANGE_PAY, UNKNOWN_1], p => confirmOf({ ...p, amount: p.amount || 12450 }));
    await repos.transactions.insertMany([tx({ provider: 'ORANGE', reference: 'MP261012.1637.71387533' })]);
    await repos.transactions.insertMany([tx({ smsFingerprint: fingerprint(UNKNOWN_1.body) })]);
    expect(await new CommitLearningSessionUseCase(repos).execute(session, new Date())).toEqual({
      recorded: 0,
      skippedDuplicates: 2,
      ignored: 0,
    });
  });

  test('transaction SQL : une erreur annule TOUT (aucune écriture partielle)', async () => {
    const db = createNodeSqliteDatabase();
    await runMigrations(db);
    const repos = createSqliteRepositories(db);
    const session = sessionOf([MOOV_WITHDRAW, ORANGE_PAY, ORANGE_IN], confirmOf);
    const original = repos.transactions.insertMany.bind(repos.transactions);
    let calls = 0;
    repos.transactions.insertMany = async t => {
      if (++calls === 3) {
        throw new Error('disque plein');
      }
      return original(t);
    };
    await expect(new CommitLearningSessionUseCase(repos).execute(session, new Date())).rejects.toThrow('disque plein');
    expect(await repos.transactions.listAll()).toEqual([]);
    expect(await repos.accounts.getAll()).toEqual([]);
    repos.transactions.insertMany = original;
    expect((await new CommitLearningSessionUseCase(repos).execute(session, new Date())).recorded).toBe(3);
  });
});

describe('useLearningStore : session, reprise, validation', () => {
  const setup = async () => {
    const repos = createInMemoryRepositories();
    configureFinanceStore(async () => repos);
    await useFinanceStore.getState().hydrate(new Date());
    useLearningStore.getState().reset();
    return repos;
  };

  test('lots, reprise exacte après interruption, annulation, commit partiel', async () => {
    const repos = await setup();
    const many = Array.from({ length: 250 }, (_, i) => tezda(i + 1, (i % 27) + 1));
    const excluded = await useLearningStore.getState().start({ messages: [...many, OTP, many[0]], chunkSize: 40 });
    expect(excluded).toMatchObject({ SECURITY_CODE: 1, DUPLICATE_IN_INBOX: 1 });
    const s = () => useLearningStore.getState();
    expect(s().session?.items).toHaveLength(250);
    expect(s().loading).toEqual({ done: 252, total: 252 });

    for (let k = 0; k < 3; k++) {
      const p = proposeFor(s().session!.items[s().session!.index], s().learned, s().context);
      await s().decide({ ...confirmOf(p), action: 'CORRECT', category: CATEGORIES.FAMILY });
    }
    await s().decide({ action: 'IGNORE', reason: 'SPAM' });
    const resumeAt = s().session!.items[s().session!.index].id;
    expect(proposeFor(s().session!.items[s().session!.index], s().learned, s().context).category).toBe(
      CATEGORIES.FAMILY,
    );

    // L'application est tuée : nouvel état mémoire, reprise depuis la base
    useLearningStore.setState({ status: 'IDLE', session: undefined, learned: EMPTY_LEARNED_STATE, history: [] });
    await useFinanceStore.getState().hydrate(new Date());
    expect(useFinanceStore.getState().learningStatus).toBe('PAUSED');
    expect(await s().restore()).toBe(true);
    expect(s().session!.items[s().session!.index].id).toBe(resumeAt);
    expect(s().history).toHaveLength(4);
    expect(proposeFor(s().session!.items[s().session!.index], s().learned, s().context).source).toBe('LEARNED');

    await s().undo();
    expect(summarizeSession(s().session!).ignored).toBe(0);
    await s().decide({ action: 'IGNORE', reason: 'OTP' });
    expect(await repos.transactions.listAll()).toEqual([]); // brouillon : rien n'est écrit

    const report = await s().commit(new Date(2026, 9, 14));
    expect(report).toEqual({ recorded: 3, skippedDuplicates: 0, ignored: 1 });
    expect(s().lastReport?.remaining).toBe(246);
    expect(await repos.transactions.listAll()).toHaveLength(3);
    expect(useFinanceStore.getState().transactions).toHaveLength(3);
    // Les restants sont gardés pour plus tard, l'apprentissage aussi
    expect(await s().restore()).toBe(true);
    expect(s().session!.items).toHaveLength(246);
    expect(proposeFor(s().session!.items[0], s().learned, s().context)).toMatchObject({
      source: 'LEARNED',
      category: CATEGORIES.FAMILY,
    });
    await s().discard();
    expect(await s().restore()).toBe(false);
  });

  test('aucun SMS à classer, rouvrir un ignoré, erreur de lecture', async () => {
    await setup();
    const s = () => useLearningStore.getState();
    await s().start({ messages: [OTP, PROMO] });
    expect(s().status).toBe('DONE');
    await s().start({ messages: [ORANGE_PAY, ORANGE_IN] });
    await s().decide({ action: 'IGNORE', reason: 'SPAM' });
    const ignoredId = s().session!.items[0].id;
    await s().decide({ action: 'IGNORE', reason: 'OTHER' });
    expect(s().status).toBe('DONE');
    await s().reopen(ignoredId);
    expect(s().status).toBe('ACTIVE');
    expect(s().session!.items[s().session!.index].id).toBe(ignoredId);
    await s().reopen('inconnu');
    configureFinanceStore(async () => {
      throw new Error('base fermée');
    });
    await s().start({ messages: [ORANGE_PAY] });
    expect(s().error).toBe('base fermée');
  });
});

describe('LearningScreen', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    act(() => jest.runOnlyPendingTimers());
    jest.useRealTimers();
  });

  const renderScreen = (t = theme, goBack = jest.fn()) =>
    render(
      <PaperProvider theme={t}>
        <LearningScreen navigation={{ goBack }} />
      </PaperProvider>,
    );

  test('confirmer en un tap puis valider enregistre la transaction', async () => {
    const repos = createInMemoryRepositories();
    configureFinanceStore(async () => repos);
    await useFinanceStore.getState().hydrate(new Date());
    useLearningStore.getState().reset();
    jest.useRealTimers();
    await useLearningStore.getState().start({ messages: [ORANGE_PAY] });
    jest.useFakeTimers();
    renderScreen();
    expect(await screen.findByTestId('proposal-hint')).toHaveTextContent(/Reconnu automatiquement/);
    expect(screen.getByTestId('learning-amount')).toHaveTextContent('500 FCFA');
    fireEvent.press(screen.getByLabelText(/^Confirmer : Dépense/));
    expect(await screen.findByTestId('learning-summary-rows')).toHaveTextContent(
      /1 à enregistrer.*0 ignoré.*0 restant/,
    );
    fireEvent.press(screen.getByTestId('learning-commit'));
    expect(await screen.findByTestId('learning-report-text')).toHaveTextContent(
      '1 enregistré(s) · 0 ignoré(s) · 0 restant(s)',
    );
    const saved = await repos.transactions.listAll();
    expect(saved.find(t => t.type === 'EXPENSE')).toMatchObject({
      amount: 500,
      counterpartyName: 'WENDSONGUEDE DAVID SAWADOGO',
    });
    expect(saved.some(t => t.type === 'FEE')).toBe(true);
  });

  test('corriger avec une nouvelle catégorie, indicateur appris, ignorer avec motif, revoir les ignorés', async () => {
    const repos = createInMemoryRepositories();
    configureFinanceStore(async () => repos);
    await useFinanceStore.getState().hydrate(new Date());
    useLearningStore.getState().reset();
    jest.useRealTimers();
    await useLearningStore.getState().start({ messages: [tezda(1, 3), tezda(2, 2), tezda(3, 1), UNKNOWN_2] });
    jest.useFakeTimers();
    const goBack = jest.fn();
    renderScreen(darkTheme, goBack);

    for (let k = 0; k < 2; k++) {
      fireEvent.press(await screen.findByTestId('learning-correct'));
      if (k === 0) {
        fireEvent.press(screen.getByTestId('cat-create'));
        fireEvent.changeText(screen.getByTestId('cat-create-input'), '  Tontine  du quartier ');
        fireEvent.press(screen.getByTestId('cat-create-save'));
        await waitFor(() => expect(useFinanceStore.getState().customCategories).toEqual(['Tontine du quartier']));
      } else {
        fireEvent.press(screen.getByTestId('cat-Tontine du quartier'));
      }
      fireEvent.press(screen.getByTestId('correction-save'));
    }
    expect(await screen.findByTestId('proposal-hint')).toHaveTextContent(/Deviné d'après tes 2 choix précédents/);
    expect(screen.getByTestId('proposal-category')).toHaveTextContent(/Tontine du quartier/);
    fireEvent.press(screen.getByTestId('learning-confirm'));

    // Format inconnu : saisie pré-remplie ouverte d'office, puis ignoré avec motif
    expect(await screen.findByTestId('correction-panel')).toBeTruthy();
    expect(screen.getByTestId('correction-amount')).toHaveProp('value', '2000');
    fireEvent.press(screen.getByTestId('learning-ignore-unrecognized'));
    fireEvent.press(screen.getByLabelText('Ignorer : Pub / spam'));
    expect(await screen.findByTestId('learning-summary-rows')).toHaveTextContent(
      /3 à enregistrer.*1 ignoré\(s\) \(1 pub \/ spam\)/,
    );

    fireEvent.press(screen.getByTestId('review-ignored'));
    const ignored = useLearningStore.getState().session!.items[3];
    fireEvent.press(screen.getByTestId(`ignored-${ignored.id}`));
    expect(await screen.findByTestId('correction-panel')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Annuler le dernier choix'));
    await waitFor(() => expect(summarizeSession(useLearningStore.getState().session!).recorded).toBe(2));

    fireEvent.press(screen.getByTestId('learning-later'));
    expect(goBack).toHaveBeenCalled();
    expect(await repos.transactions.listAll()).toEqual([]);
  });

  test('écran d’accueil : démarrage depuis l’intro, état vide', async () => {
    const repos = createInMemoryRepositories();
    configureFinanceStore(async () => repos);
    await useFinanceStore.getState().hydrate(new Date());
    useLearningStore.setState({ status: 'IDLE', session: undefined, lastReport: undefined, error: undefined });
    renderScreen();
    expect(await screen.findByTestId('learning-intro')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Analyser mes SMS'));
    expect(await screen.findByTestId('learning-empty')).toBeTruthy();
  });
});

describe('Points d’entrée de l’apprentissage', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    act(() => jest.runOnlyPendingTimers());
    jest.useRealTimers();
  });

  test('bannière de l’accueil (jamais fait / en pause / terminé) et Réglages', async () => {
    const { DashboardScreen } = require('../src/presentation/screens/DashboardScreen');
    const { SettingsScreen } = require('../src/presentation/screens/SettingsScreen');
    const repos = createInMemoryRepositories();
    configureFinanceStore(async () => repos);
    await useFinanceStore.getState().hydrate(new Date());
    expect(useFinanceStore.getState().learningStatus).toBe('NEVER');
    const navigate = jest.fn();
    render(
      <PaperProvider theme={theme}>
        <DashboardScreen navigation={{ navigate }} />
      </PaperProvider>,
    );
    expect(screen.getByText(/Classe ton historique SMS/)).toBeTruthy();
    fireEvent.press(screen.getByTestId('open-learning'));
    expect(navigate).toHaveBeenCalledWith('Learning');

    await act(async () => {
      await repos.settings.setJson(LEARNING_DONE_KEY, 'x');
      await useFinanceStore.getState().hydrate(new Date());
    });
    expect(useFinanceStore.getState().learningStatus).toBe('DONE');
    screen.unmount();

    render(
      <PaperProvider theme={theme}>
        <SettingsScreen navigation={{ navigate }} />
      </PaperProvider>,
    );
    fireEvent.press(await screen.findByTestId('open-learning-settings'));
    expect(navigate).toHaveBeenLastCalledWith('Learning');
  });
});
