import '@testing-library/react-native/extend-expect';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Linking } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import { CATEGORIES } from '../src/core/categories';
import type { FamilyRequest } from '../src/domain/models/FamilyRequest';
import {
  buildFamilyReply,
  decideRequest,
  FAMILY_REQUESTS_KEY,
  sortRequests,
  suggestedGift,
  summarizeSolidarity,
} from '../src/domain/usecases/FamilySolidarity';
import { DebtsScreen } from '../src/presentation/screens/DebtsScreen';
import { configureFinanceStore, useFinanceStore } from '../src/presentation/store/useFinanceStore';
import { theme } from '../src/presentation/theme/theme';
import { buildJsonBackup, parseJsonBackup } from '../src/services/exportBuilders';
import { restoreBackup } from '../src/services/export/BackupService';
import { createInMemoryRepositories, tx } from './helpers/inMemoryRepositories';

const req = (over: Partial<FamilyRequest>): FamilyRequest => ({
  id: 'r1',
  contactName: 'Tonton Issa',
  amount: 20000,
  status: 'PENDING',
  givenAmount: 0,
  createdAt: '2026-10-10T08:00:00',
  ...over,
});
const family = (amount: number) => tx({ amount, category: CATEGORIES.FAMILY, counterpartyName: 'Maman' });

describe('FamilySolidarity (domaine)', () => {
  test('synthèse : donné, reste, niveaux et demandes ouvertes', () => {
    const requests = [req({}), req({ id: 'r2', status: 'LATER', amount: 5000 }), req({ id: 'r3', status: 'GIVEN' })];
    expect(summarizeSolidarity(requests, [family(10000)], 50000)).toMatchObject({
      given: 10000,
      remaining: 40000,
      level: 'OK',
      pendingCount: 2,
      pendingAmount: 25000,
    });
    expect(summarizeSolidarity([], [family(41000)], 50000).level).toBe('WARNING');
    expect(summarizeSolidarity([], [family(60000)], 50000)).toMatchObject({ level: 'EXCEEDED', remaining: 0 });
    expect(summarizeSolidarity([], [family(50000)], 50000)).toMatchObject({ level: 'WARNING', remaining: 0 });
    expect(summarizeSolidarity([], [], 0)).toMatchObject({ level: 'NO_BUDGET', ratio: 0 });
  });

  test('montant conseillé selon le budget restant', () => {
    expect(suggestedGift(req({}), summarizeSolidarity([], [family(40000)], 50000))).toBe(10000);
    expect(suggestedGift(req({}), summarizeSolidarity([], [], 0))).toBe(20000);
    expect(suggestedGift(req({}), summarizeSolidarity([], [family(50000)], 50000))).toBe(0);
  });

  test('réponses courtoises pour chaque décision', () => {
    const r = req({ reason: "l'ordonnance" });
    expect(buildFamilyReply('GIVEN', r, { senderName: 'Awa' })).toBe(
      "Bonjour Tonton, c'est fait : je t'ai envoyé 20 000 FCFA pour l'ordonnance. Courage à toi 🙏🏾\nAwa",
    );
    expect(buildFamilyReply('PARTIAL', r, { given: 5000 })).toMatch(/je t'envoie 5 000 FCFA pour l'ordonnance/);
    expect(buildFamilyReply('PARTIAL', req({}))).toMatch(/0 FCFA\. J'espère/);
    expect(buildFamilyReply('LATER', r)).toMatch(/reviens vers toi en fin de mois/);
    expect(buildFamilyReply('LATER', r, { laterDate: '30/10' })).toMatch(/le 30\/10/);
    expect(buildFamilyReply('DECLINED', req({}))).toMatch(/^Bonjour Tonton, j'ai bien reçu ta demande\. Ce mois-ci/);
  });

  test('décision et tri (ouvertes d’abord)', () => {
    expect(decideRequest(req({}), 'DECLINED', 999, 'd')).toMatchObject({
      status: 'DECLINED',
      givenAmount: 0,
      decidedAt: 'd',
    });
    expect(decideRequest(req({}), 'PARTIAL', 5000, 'd').givenAmount).toBe(5000);
    const sorted = sortRequests([
      req({ id: 'done-old', status: 'GIVEN', decidedAt: '2026-10-01' }),
      req({ id: 'open-new', createdAt: '2026-10-12' }),
      req({ id: 'done-new', status: 'DECLINED', decidedAt: '2026-10-11' }),
      req({ id: 'open-old', status: 'LATER', createdAt: '2026-10-02' }),
      req({ id: 'done-nodate', status: 'GIVEN', createdAt: '2026-09-01' }),
    ]);
    expect(sorted.map(r => r.id)).toEqual(['open-old', 'open-new', 'done-new', 'done-old', 'done-nodate']);
  });
});

describe('Store : demandes de la famille', () => {
  const now = new Date();
  const recentIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}T07:00:00`;

  test('don en espèces, rattachement d’un envoi MoMo, refus, suppression, budget', async () => {
    const repos = createInMemoryRepositories();
    await repos.transactions.insertMany([
      tx({
        id: 'momo',
        amount: 15000,
        counterpartyName: 'Tonton Issa',
        counterpartyPhone: '70112233',
        occurredAt: recentIso,
      }),
    ]);
    configureFinanceStore(async () => repos);
    await useFinanceStore.getState().hydrate(now);
    const store = useFinanceStore.getState;

    await store().setSolidarityBudget(50000);
    await store().saveFamilyRequest({ contactName: 'Maman', amount: 10000, reason: 'Santé' });
    await store().saveFamilyRequest({ contactName: 'Tonton Issa', amount: 15000 });
    await store().saveFamilyRequest({ contactName: 'Cousin', amount: 30000 });
    const [cousin, issa, maman] = store().familyRequests;

    await store().decideFamilyRequest(maman.id, 'GIVEN', 10000, 'cash-wallet');
    const cashTx = store().transactions.find(t => t.counterpartyName === 'Maman')!;
    expect(cashTx).toMatchObject({ category: CATEGORIES.FAMILY, accountId: 'cash-wallet', note: 'Santé' });
    expect(store().familyRequests.find(r => r.id === maman.id)).toMatchObject({
      status: 'GIVEN',
      transactionId: cashTx.id,
    });

    await store().decideFamilyRequest(issa.id, 'GIVEN', 15000);
    expect(store().transactions.find(t => t.id === 'momo')?.category).toBe(CATEGORIES.FAMILY);
    expect(store().learnedCategories['70112233']).toBe(CATEGORIES.FAMILY);
    expect(store().familyRequests.find(r => r.id === issa.id)?.transactionId).toBe('momo');

    await store().decideFamilyRequest(cousin.id, 'DECLINED');
    expect(store().familyRequests.find(r => r.id === cousin.id)).toMatchObject({ status: 'DECLINED', givenAmount: 0 });
    await store().decideFamilyRequest('inconnu', 'GIVEN', 1);

    await store().saveFamilyRequest({ id: cousin.id, contactName: 'Cousin Ali', amount: 30000 });
    expect(store().familyRequests[0]).toMatchObject({ contactName: 'Cousin Ali', status: 'DECLINED' });
    await store().deleteFamilyRequest(cousin.id);
    expect(await repos.settings.getJson<FamilyRequest[]>(FAMILY_REQUESTS_KEY, [])).toHaveLength(2);

    await store().hydrate(now);
    expect(store().solidarityBudget).toBe(50000);
    expect(store().familyRequests).toHaveLength(2);
  });

  test('sauvegarde JSON : demandes et budget restaurés par fusion', async () => {
    const repos = createInMemoryRepositories();
    await repos.settings.setJson(FAMILY_REQUESTS_KEY, [req({ id: 'local' }), req({ id: 'shared', amount: 1 })]);
    const snapshot = parseJsonBackup(
      buildJsonBackup({
        exportedAt: 'x',
        accounts: [],
        transactions: [],
        debts: [],
        plannedItems: [],
        familyRequests: [req({ id: 'shared', amount: 2 })],
        solidarityBudget: 25000,
      }),
    );
    await restoreBackup(repos, snapshot);
    const restored = await repos.settings.getJson<FamilyRequest[]>(FAMILY_REQUESTS_KEY, []);
    expect(restored.map(r => [r.id, r.amount])).toEqual([
      ['shared', 2],
      ['local', 20000],
    ]);
    expect(await repos.settings.getJson('solidarityBudget', 0)).toBe(25000);
  });
});

describe('Carnet : onglet Famille', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    act(() => jest.runOnlyPendingTimers());
    jest.useRealTimers();
  });

  test('budget, ajout d’une demande, réponse WhatsApp pré-rédigée', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const repos = createInMemoryRepositories();
    configureFinanceStore(async () => repos);
    await useFinanceStore.getState().hydrate(new Date());
    await useFinanceStore.getState().setUserName('Awa');

    render(
      <PaperProvider theme={theme}>
        <DebtsScreen />
      </PaperProvider>,
    );
    fireEvent.press(screen.getByTestId('tab-FAMILY'));
    expect(await screen.findByText(/Fixe un budget mensuel/)).toBeTruthy();

    fireEvent.press(screen.getByTestId('edit-solidarity-budget'));
    fireEvent.changeText(screen.getByTestId('solidarity-budget-input'), '30000');
    fireEvent.press(screen.getByTestId('save-solidarity-budget'));
    await waitFor(() => expect(screen.getByTestId('solidarity-remaining')).toHaveTextContent(/Il reste 30 000 FCFA/));

    fireEvent.press(screen.getByTestId('fab-debt'));
    fireEvent.changeText(screen.getByLabelText('Qui demande ? (ex: Tonton Issa)'), 'Tante Fati');
    fireEvent.changeText(screen.getByLabelText('Téléphone (WhatsApp)'), '70998877');
    fireEvent.changeText(screen.getByTestId('family-amount'), '40000');
    fireEvent.press(screen.getByText('Scolarité'));
    fireEvent.press(screen.getByTestId('family-save'));
    await waitFor(() => expect(useFinanceStore.getState().familyRequests).toHaveLength(1));
    expect(await screen.findByTestId('solidarity-pending')).toHaveTextContent(/1 demande · 40 000 FCFA/);

    const id = useFinanceStore.getState().familyRequests[0].id;
    fireEvent.press(screen.getByTestId(`answer-${id}`));
    expect(await screen.findByTestId('family-advice')).toHaveTextContent(/donner une partie/);
    expect(screen.getByTestId('reply-amount')).toHaveProp('value', '30000');
    expect(screen.getByTestId('reply-message')).toHaveProp(
      'value',
      expect.stringMatching(/je t'envoie 30 000 FCFA pour Scolarité/),
    );
    fireEvent.press(screen.getByTestId('source-cash-wallet'));
    fireEvent.press(screen.getByTestId('reply-whatsapp'));

    await waitFor(() => expect(openURL).toHaveBeenCalledWith(expect.stringContaining('wa.me/22670998877')));
    expect(useFinanceStore.getState().familyRequests[0]).toMatchObject({ status: 'PARTIAL', givenAmount: 30000 });
    expect(useFinanceStore.getState().transactions[0]).toMatchObject({ amount: 30000, category: CATEGORIES.FAMILY });
    await waitFor(() => expect(screen.getByTestId('solidarity-remaining')).toHaveTextContent(/Budget du mois atteint/));
  });
});
