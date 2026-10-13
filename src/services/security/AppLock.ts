import 'react-native-get-random-values';
import * as Keychain from 'react-native-keychain';
import { hashPin } from '../../core/sha256';

const SERVICE = 'com.ligdibe.pin';
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 30_000;

interface StoredPin {
  salt: string;
  hash: string;
  failures: number;
  lockedUntil: number;
  /** Nombre de chiffres (permet la validation automatique sans bouton). */
  length: number;
}

const randomSalt = (): string => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
};

const read = async (): Promise<StoredPin | undefined> => {
  const creds = await Keychain.getGenericPassword({ service: SERVICE });
  return creds ? (JSON.parse(creds.password) as StoredPin) : undefined;
};

const write = (stored: StoredPin) =>
  Keychain.setGenericPassword('pin', JSON.stringify(stored), {
    service: SERVICE,
    accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });

export const isValidPin = (pin: string): boolean => /^\d{4,6}$/.test(pin);

export const hasPin = async (): Promise<boolean> => (await read()) !== undefined;

export const getPinLength = async (): Promise<number> => (await read())?.length ?? 4;

export const setPin = async (pin: string): Promise<void> => {
  if (!isValidPin(pin)) {
    throw new Error('Le code doit contenir 4 à 6 chiffres');
  }
  const salt = randomSalt();
  await write({ salt, hash: hashPin(pin, salt), failures: 0, lockedUntil: 0, length: pin.length });
};

export const removePin = async (): Promise<void> => {
  await Keychain.resetGenericPassword({ service: SERVICE });
};

export type VerifyResult = { ok: true } | { ok: false; remainingAttempts: number } | { ok: false; lockedForMs: number };

/** Vérifie le PIN ; après 5 échecs, blocage de 30 s (anti-essais à répétition). */
export const verifyPin = async (pin: string, now = Date.now()): Promise<VerifyResult> => {
  const stored = await read();
  if (!stored) {
    return { ok: true };
  }
  if (stored.lockedUntil > now) {
    return { ok: false, lockedForMs: stored.lockedUntil - now };
  }
  if (hashPin(pin, stored.salt) === stored.hash) {
    if (stored.failures > 0) {
      await write({ ...stored, failures: 0, lockedUntil: 0 });
    }
    return { ok: true };
  }
  const failures = stored.failures + 1;
  if (failures >= MAX_ATTEMPTS) {
    await write({ ...stored, failures: 0, lockedUntil: now + LOCKOUT_MS });
    return { ok: false, lockedForMs: LOCKOUT_MS };
  }
  await write({ ...stored, failures, lockedUntil: 0 });
  return { ok: false, remainingAttempts: MAX_ATTEMPTS - failures };
};
