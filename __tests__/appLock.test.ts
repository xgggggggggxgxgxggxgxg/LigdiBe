import * as Keychain from 'react-native-keychain';
import { hashPin, sha256Hex } from '../src/core/sha256';
import { getPinLength, hasPin, isValidPin, removePin, setPin, verifyPin } from '../src/services/security/AppLock';

describe('sha256', () => {
  test.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
  ])('vecteur NIST %p', (msg, hex) => {
    expect(sha256Hex(msg)).toBe(hex);
  });

  test('UTF-8 multi-octets, emoji et message multi-blocs (référence : crypto Node)', () => {
    expect(sha256Hex('é')).toBe('4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c');
    expect(sha256Hex('💚')).toBe('7306878e137ad0c878bbd788d0e50c502eb218045408b171ae954380fb2090bf');
    expect(sha256Hex('a'.repeat(1000))).toBe(
      require('crypto').createHash('sha256').update('a'.repeat(1000)).digest('hex'),
    );
    expect(sha256Hex('ߐ')).toBe(require('crypto').createHash('sha256').update('ߐ').digest('hex'));
  });

  test('hashPin dépend du sel', () => {
    expect(hashPin('1234', 'a', 10)).not.toBe(hashPin('1234', 'b', 10));
    expect(hashPin('1234', 'a', 10)).toBe(hashPin('1234', 'a', 10));
  });
});

describe('AppLock', () => {
  let vault: string | undefined;
  beforeAll(() => {
    (globalThis as { crypto?: unknown }).crypto ??= { getRandomValues: (b: Uint8Array) => b.fill(7) };
    (Keychain.getGenericPassword as jest.Mock).mockImplementation(async () => (vault ? { password: vault } : false));
    (Keychain.setGenericPassword as jest.Mock).mockImplementation(async (_u: string, p: string) => {
      vault = p;
      return true;
    });
    (Keychain.resetGenericPassword as jest.Mock).mockImplementation(async () => {
      vault = undefined;
      return true;
    });
  });

  test('cycle complet : définir, vérifier, blocage après 5 échecs, supprimer', async () => {
    expect(await hasPin()).toBe(false);
    expect(await verifyPin('0000')).toEqual({ ok: true });
    await expect(setPin('12a4')).rejects.toThrow();
    expect(isValidPin('123456')).toBe(true);
    expect(await getPinLength()).toBe(4);
    await setPin('258000');
    expect(await getPinLength()).toBe(6);
    await setPin('2580');
    expect(await hasPin()).toBe(true);
    expect(await verifyPin('2580', 0)).toEqual({ ok: true });
    expect(await verifyPin('1111', 0)).toEqual({ ok: false, remainingAttempts: 4 });
    expect(await verifyPin('2580', 0)).toEqual({ ok: true }); // réinitialise le compteur
    for (let i = 0; i < 4; i++) {
      await verifyPin('1111', 0);
    }
    expect(await verifyPin('1111', 0)).toEqual({ ok: false, lockedForMs: 30000 });
    expect(await verifyPin('2580', 10_000)).toEqual({ ok: false, lockedForMs: 20000 });
    expect(await verifyPin('2580', 31_000)).toEqual({ ok: true });
    await removePin();
    expect(await hasPin()).toBe(false);
  });
});
