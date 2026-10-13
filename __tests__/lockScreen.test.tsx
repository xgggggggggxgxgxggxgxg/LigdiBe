import '@testing-library/react-native/extend-expect';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { PaperProvider } from 'react-native-paper';
import * as AppLock from '../src/services/security/AppLock';
import { LockScreen } from '../src/presentation/screens/LockScreen';
import { RELOCK_AFTER_MS, useLockStore } from '../src/presentation/store/useLockStore';

jest.mock('../src/services/security/AppLock', () => ({
  hasPin: jest.fn(async () => true),
  verifyPin: jest.fn(),
  getPinLength: jest.fn(async () => 6),
}));

describe('useLockStore', () => {
  test('verrouille au démarrage si un PIN existe, puis après 1 min en arrière-plan', async () => {
    await useLockStore.getState().init();
    expect(useLockStore.getState().locked).toBe(true);
    useLockStore.getState().unlock();
    useLockStore.getState().onBackground(0);
    useLockStore.getState().onForeground(RELOCK_AFTER_MS - 1);
    expect(useLockStore.getState().locked).toBe(false);
    useLockStore.getState().onBackground(0);
    useLockStore.getState().onForeground(RELOCK_AFTER_MS);
    expect(useLockStore.getState().locked).toBe(true);
    useLockStore.getState().setPinEnabled(false);
    useLockStore.getState().onForeground(RELOCK_AFTER_MS * 10);
    expect(useLockStore.getState().locked).toBe(false);
  });

  test('erreur Keychain : pas de verrouillage', async () => {
    (AppLock.hasPin as jest.Mock).mockRejectedValueOnce(new Error('keystore'));
    await useLockStore.getState().init();
    expect(useLockStore.getState().pinEnabled).toBe(false);
  });
});

describe('LockScreen', () => {
  beforeEach(() => (AppLock.verifyPin as jest.Mock).mockClear());
  const enter = (digits: string) => digits.split('').forEach(d => fireEvent.press(screen.getByTestId(`key-${d}`)));

  test('déverrouille avec le bon code', async () => {
    (AppLock.verifyPin as jest.Mock).mockResolvedValue({ ok: true });
    useLockStore.setState({ locked: true, pinEnabled: true });
    (AppLock.getPinLength as jest.Mock).mockResolvedValueOnce(4);
    render(
      <PaperProvider>
        <LockScreen />
      </PaperProvider>,
    );
    await act(async () => undefined);
    enter('2580');
    await waitFor(() => expect(useLockStore.getState().locked).toBe(false));
    expect(AppLock.verifyPin).toHaveBeenCalledWith('2580');
  });

  test('code faux à 6 chiffres puis blocage', async () => {
    (AppLock.verifyPin as jest.Mock).mockResolvedValue({ ok: false, remainingAttempts: 3 });
    render(
      <PaperProvider>
        <LockScreen />
      </PaperProvider>,
    );
    await act(async () => undefined);
    enter('1239');
    fireEvent.press(screen.getByTestId('key-⌫'));
    expect(AppLock.verifyPin).not.toHaveBeenCalled();
    enter('456');
    expect(AppLock.verifyPin).toHaveBeenCalledWith('123456');
    await waitFor(() => expect(screen.getByTestId('lock-message')).toHaveTextContent(/3 essai/));

    (AppLock.verifyPin as jest.Mock).mockResolvedValue({ ok: false, lockedForMs: 30000 });
    enter('999999');
    await waitFor(() => expect(screen.getByTestId('lock-message')).toHaveTextContent(/30 s/));
  });
});
