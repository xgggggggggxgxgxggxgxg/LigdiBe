import '@testing-library/react-native/extend-expect';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import { CATEGORIES } from '../src/core/categories';
import { parseTransactionSms } from '../src/data/parser/SmsParserEngine';
import type { FamilyMember } from '../src/domain/models/FamilyMember';
import { autoCategorize } from '../src/domain/usecases/CategorizeTransaction';
import {
  FAMILY_MEMBERS_KEY,
  familyPhoneTails,
  isFamilyPhone,
  mergeFamilyMembers,
  phoneTail,
} from '../src/domain/usecases/FamilyMembers';
import { ProcessIncomingSmsUseCase } from '../src/domain/usecases/ProcessIncomingSms';
import { DebtsScreen } from '../src/presentation/screens/DebtsScreen';
import { configureFinanceStore, useFinanceStore } from '../src/presentation/store/useFinanceStore';
import { theme } from '../src/presentation/theme/theme';
import { loadPhoneContacts, normalizeContacts } from '../src/services/contacts/ContactsService';
import { createInMemoryRepositories, tx } from './helpers/inMemoryRepositories';

const setOS = (os: 'android' | 'ios') => Object.defineProperty(Platform, 'OS', { get: () => os, configurable: true });

const CONTACTS = [
  { id: '1', name: 'Maman', phone: '+226 70 11 22 33', starred: false },
  { id: '1', name: 'Maman', phone: '70112233', starred: true },
  { id: '2', name: 'Élodie Ouédraogo', phone: '76 55 44 33', starred: false },
  { id: '3', name: 'Abdoul', phone: '0022678000001', starred: false },
  { id: '4', name: 'Court', phone: '123', starred: false },
  { id: '5', name: '  ', phone: '70000009', starred: false },
];

describe('FamilyMembers (domaine)', () => {
  test('numéro : 8 derniers chiffres, tous formats', () => {
    expect(phoneTail('+226 70 11 22 33')).toBe('70112233');
    expect(phoneTail('0022670112233')).toBe('70112233');
    expect(phoneTail('123')).toBeUndefined();
    expect(phoneTail(undefined)).toBeUndefined();
    const tails = familyPhoneTails([{ phone: '70112233' }, {}]);
    expect(isFamilyPhone('22670112233', tails)).toBe(true);
    expect(isFamilyPhone('22670999999', tails)).toBe(false);
    expect(isFamilyPhone(undefined, tails)).toBe(false);
  });

  test('fusion sans doublon (numéro, ou nom sans numéro)', () => {
    const merged = mergeFamilyMembers(
      [
        { id: 'a', name: 'Maman', phone: '70112233' },
        { id: 'b', name: 'Tonton' },
      ],
      [
        { id: 'c', name: 'Maman chérie', phone: '+22670112233' },
        { id: 'd', name: 'tonton ' },
        { id: 'e', name: 'Papa', phone: '70445566' },
      ],
    );
    expect(merged.map(m => m.id)).toEqual(['c', 'd', 'e']);
  });

  test('un envoi MoMo vers un proche est classé « Famille » (après les catégories apprises)', () => {
    const tails = familyPhoneTails([{ phone: '70112233' }]);
    const parsed = { type: 'EXPENSE' as const, counterpartyPhone: '22670112233', counterpartyName: 'MAMAN' };
    expect(autoCategorize(parsed, {}, tails)).toBe(CATEGORIES.FAMILY);
    expect(autoCategorize(parsed, { '22670112233': 'Loyer' }, tails)).toBe('Loyer');
    expect(autoCategorize(parsed)).toBe(CATEGORIES.TRANSFER);
  });

  test('ProcessIncomingSms utilise « Ma famille »', async () => {
    const repos = createInMemoryRepositories();
    await repos.settings.setJson<FamilyMember[]>(FAMILY_MEMBERS_KEY, [{ id: 'm', name: 'Paul', phone: '70112233' }]);
    const sms = `Transfert reussi vers 22670112233 OUEDRAOGO PAUL\nMontant: 5 000,00 FCFA\nFrais: 50,00 FCFA\nSolde: 12 000,00 FCFA`;
    expect(parseTransactionSms(sms)).not.toBeNull();
    const r = await new ProcessIncomingSmsUseCase(repos).execute({ body: sms, sender: 'MoovMoney' });
    expect(r.status === 'RECORDED' && r.entries.transactions[0].category).toBe(CATEGORIES.FAMILY);
  });
});

describe('ContactsService', () => {
  afterEach(() => {
    setOS('ios');
    delete NativeModules.LigdiBeContacts;
    jest.restoreAllMocks();
  });

  test('normalisation : doublons fusionnés (favori gardé), favoris en tête, tri sans accents', () => {
    expect(normalizeContacts(CONTACTS).map(c => [c.name, c.phone, c.starred])).toEqual([
      ['Maman', '70112233', true],
      ['Abdoul', '0022678000001', false],
      ['Élodie Ouédraogo', '76554433', false],
    ]);
  });

  test('permission accordée, refusée, module absent, erreur native', async () => {
    expect(await loadPhoneContacts()).toEqual({ status: 'UNAVAILABLE' });
    setOS('android');
    expect(await loadPhoneContacts()).toEqual({ status: 'UNAVAILABLE' });

    const list = jest.fn(async () => CONTACTS);
    NativeModules.LigdiBeContacts = { list };
    const request = jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
    const ok = await loadPhoneContacts();
    expect(ok.status === 'OK' && ok.contacts).toHaveLength(3);
    expect(request).toHaveBeenCalledWith(
      PermissionsAndroid.PERMISSIONS.READ_CONTACTS,
      expect.objectContaining({ message: expect.stringMatching(/Rien n’est envoyé/) }),
    );

    request.mockResolvedValue(PermissionsAndroid.RESULTS.DENIED);
    expect(await loadPhoneContacts()).toEqual({ status: 'DENIED' });

    request.mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
    list.mockRejectedValueOnce(new Error('boom'));
    expect(await loadPhoneContacts()).toEqual({ status: 'DENIED' });
  });
});

describe('Famille : import des contacts', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    act(() => jest.runOnlyPendingTimers());
    jest.useRealTimers();
    setOS('ios');
    delete NativeModules.LigdiBeContacts;
    jest.restoreAllMocks();
  });

  test('import multi-sélection, reclassement des envois, raccourci dans la demande', async () => {
    setOS('android');
    NativeModules.LigdiBeContacts = { list: jest.fn(async () => CONTACTS) };
    jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
    const now = new Date();
    const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01T09:00:00`;
    const repos = createInMemoryRepositories();
    await repos.transactions.insertMany([
      tx({
        id: 'to-mum',
        amount: 5000,
        counterpartyPhone: '22670112233',
        category: CATEGORIES.TRANSFER,
        occurredAt: iso,
      }),
      tx({ id: 'rent', amount: 50000, counterpartyPhone: '22670112233', category: CATEGORIES.RENT, occurredAt: iso }),
    ]);
    configureFinanceStore(async () => repos);
    await useFinanceStore.getState().hydrate(now);

    render(
      <PaperProvider theme={theme}>
        <DebtsScreen />
      </PaperProvider>,
    );
    fireEvent.press(screen.getByTestId('tab-FAMILY'));
    fireEvent.press(await screen.findByTestId('import-family'));
    fireEvent.press(await screen.findByTestId('contact-70112233'));
    fireEvent.changeText(screen.getByTestId('contacts-search'), 'elodie');
    await waitFor(() => expect(screen.queryByTestId('contact-0022678000001')).toBeNull());
    fireEvent.press(screen.getByTestId('contact-76554433'));
    expect(screen.getByTestId('contacts-add')).toHaveTextContent(/Ajouter 2 proches/);
    fireEvent.press(screen.getByTestId('contacts-add'));

    await waitFor(() => expect(useFinanceStore.getState().familyMembers).toHaveLength(2));
    expect(await screen.findByTestId('family-toast')).toHaveTextContent(
      /2 proches ajoutés · 1 envoi reclassé en Famille/,
    );
    const cat = (id: string) => useFinanceStore.getState().transactions.find(t => t.id === id)?.category;
    expect(cat('to-mum')).toBe(CATEGORIES.FAMILY);
    expect(cat('rent')).toBe(CATEGORIES.RENT);
    expect((await repos.transactions.listAll()).find(t => t.id === 'to-mum')?.category).toBe(CATEGORIES.FAMILY);

    // Les membres déjà ajoutés sont signalés, l'ajout manuel fonctionne
    fireEvent.press(screen.getByTestId('open-contacts'));
    expect(await screen.findByText(/déjà dans ta famille/)).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Retour'));
    fireEvent.changeText(screen.getByLabelText('Nom'), 'Tonton Issa');
    fireEvent.press(screen.getByTestId('member-add-manual'));
    await waitFor(() => expect(useFinanceStore.getState().familyMembers).toHaveLength(3));
    const issa = useFinanceStore.getState().familyMembers[0];
    fireEvent.press(screen.getByLabelText(`Retirer ${issa.name}`));
    await waitFor(() => expect(useFinanceStore.getState().familyMembers).toHaveLength(2));
    fireEvent.press(screen.getByText('Fermer'));

    // Raccourci : choisir un proche remplit nom et téléphone
    fireEvent.press(screen.getByTestId('fab-debt'));
    const maman = useFinanceStore.getState().familyMembers.find(m => m.name === 'Maman')!;
    fireEvent.press(await screen.findByTestId(`pick-member-${maman.id}`));
    expect(screen.getByLabelText('Téléphone (WhatsApp)')).toHaveProp('value', '70112233');
  });

  test('permission refusée : explication et nouvel essai', async () => {
    setOS('android');
    NativeModules.LigdiBeContacts = { list: jest.fn(async () => CONTACTS) };
    const request = jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(PermissionsAndroid.RESULTS.DENIED);
    configureFinanceStore(async () => createInMemoryRepositories());
    await useFinanceStore.getState().hydrate(new Date());
    render(
      <PaperProvider theme={theme}>
        <DebtsScreen />
      </PaperProvider>,
    );
    fireEvent.press(screen.getByTestId('tab-FAMILY'));
    fireEvent.press(await screen.findByTestId('import-family'));
    expect(await screen.findByTestId('contacts-denied')).toHaveTextContent(/Autorise l’accès aux contacts/);
    request.mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
    fireEvent.press(screen.getByText('Réessayer'));
    expect(await screen.findByTestId('contact-70112233')).toBeTruthy();
  });
});
