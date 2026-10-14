import '@testing-library/react-native/extend-expect';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { strToU8 } from 'fflate';
import fs from 'fs';
import path from 'path';
import React from 'react';
import { NativeModules, Platform } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import { looksLikeSmsExport, parseSmsExportText } from '../src/data/parser/SmsExportFile';
import { buildLearningQueue, proposeFor, EMPTY_LEARNED_STATE } from '../src/domain/usecases/LearningQueue';
import { LearningScreen } from '../src/presentation/screens/LearningScreen';
import { configureFinanceStore, useFinanceStore } from '../src/presentation/store/useFinanceStore';
import { useLearningStore } from '../src/presentation/store/useLearningStore';
import { theme } from '../src/presentation/theme/theme';
import { bytesToBase64 } from '../src/services/archive/BackupArchive';
import { createInMemoryRepositories } from './helpers/inMemoryRepositories';

/** Extrait anonymisé d'un vrai export « SMS Exporter » (6 conversations concaténées). */
const SAMPLE = fs.readFileSync(path.join(__dirname, 'fixtures/smsExport.sample.txt'), 'utf8');

describe('Export « SMS Exporter »', () => {
  test('lecture : expéditeurs, dates, corps multi-lignes, en-têtes collés au dernier message', () => {
    const sms = parseSmsExportText(SAMPLE);
    expect(sms).toHaveLength(21);
    expect(sms[0]).toMatchObject({ sender: 'OrangeMaxit', receivedAt: '2026-04-23T13:28:00' });
    expect(sms[1].body).toBe(
      'Bravo ! Pass Sport Jour activé, 100 F facturé. Regardez vos matchs en direct dès maintenant !',
    );
    expect(sms[2].body).toContain('De OKPEOLOU Eric (+2250700000001)\n24/06/2026 à 10:38');
    expect(sms[4].body.endsWith('ATXVXMWMMIVVXJH64FX')).toBe(true);
    expect(sms.filter(s => s.sender === 'MOOV MONEY')[0].body.split('\n')).toHaveLength(5);
    expect(looksLikeSmsExport(SAMPLE)).toBe(true);
    expect(looksLikeSmsExport('bonjour')).toBe(false);
    expect(parseSmsExportText('Envoyé à Maman le 2026-01-01 10:00\n\n Coucou')).toEqual([]);
    expect(parseSmsExportText('Reçu de X le 2026-01-01 10:00:05\r\n\r\n Salut')).toEqual([
      { sender: 'X', body: 'Salut', receivedAt: '2026-01-01T10:00:05' },
    ]);
  });

  test('file d’apprentissage sur l’export : codes, promos, soldes, doublons et expéditeurs inconnus écartés', () => {
    const { items, excluded } = buildLearningQueue(parseSmsExportText(SAMPLE), {
      fingerprints: new Set(),
      references: new Set(),
    });
    expect(excluded).toEqual({
      NOT_WHITELISTED: 2,
      SECURITY_CODE: 3,
      NOT_FINANCIAL: 3,
      ALREADY_RECORDED: 0,
      DUPLICATE_IN_INBOX: 3,
    });
    const types = items.map(i => proposeFor(i, EMPTY_LEARNED_STATE)).map(p => `${p.type}:${p.amount}`);
    expect(types).toEqual([
      'INCOME:3000',
      'EXPENSE:2500',
      'INCOME:4000',
      'EXPENSE:200',
      'AIRTIME_RECHARGE:100',
      'EXPENSE:17850',
      'CASH_WITHDRAWAL:1000000',
      'AGENT_DEPOSIT:12000',
      'EXPENSE:2000',
      'AGENT_DEPOSIT:4900',
    ]);
    expect(items.every(i => proposeFor(i, EMPTY_LEARNED_STATE).source === 'PARSER')).toBe(true);
  });
});

describe('Import depuis l’écran d’apprentissage', () => {
  const setOS = (os: 'android' | 'ios') => Object.defineProperty(Platform, 'OS', { get: () => os, configurable: true });
  afterEach(() => {
    setOS('ios');
    delete NativeModules.LigdiBeFiles;
  });

  test('choisir le .txt lance la session ; un fichier quelconque est refusé avec un message', async () => {
    setOS('android');
    const pickFile = jest.fn(async () => ({ name: 'export.txt', size: 1, base64: bytesToBase64(strToU8(SAMPLE)) }));
    NativeModules.LigdiBeFiles = { pickFile, shareFile: jest.fn() };
    const repos = createInMemoryRepositories();
    configureFinanceStore(async () => repos);
    await useFinanceStore.getState().hydrate(new Date());
    useLearningStore.setState({ status: 'IDLE', session: undefined, lastReport: undefined, error: undefined });
    render(
      <PaperProvider theme={theme}>
        <LearningScreen />
      </PaperProvider>,
    );
    fireEvent.press(await screen.findByTestId('learning-import-export'));
    await waitFor(() => expect(useLearningStore.getState().session?.items).toHaveLength(10));
    expect(await screen.findByTestId('learning-progress')).toHaveTextContent(/1 \/ 10/);

    await act(async () => {
      await useLearningStore.getState().discard();
    });
    pickFile.mockResolvedValueOnce({ name: 'photo.txt', size: 1, base64: bytesToBase64(strToU8('rien à voir')) });
    fireEvent.press(await screen.findByTestId('learning-import-export'));
    expect(await screen.findByText(/pas un export « SMS Exporter »/)).toBeTruthy();
    screen.unmount();
    await act(async () => {
      await new Promise(r => setTimeout(r, 400));
    });
  });
});
