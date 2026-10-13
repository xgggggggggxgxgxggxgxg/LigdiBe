import 'react-native-get-random-values';
import * as Keychain from 'react-native-keychain';

const SERVICE = 'com.ligdibe.db';

/**
 * Clé AES-256 SQLCipher : 32 octets aléatoires générés au premier lancement et
 * conservés dans l'Android Keystore (via react-native-keychain). La clé ne
 * quitte jamais l'appareil.
 */
export const getOrCreateDatabaseKey = async (): Promise<string> => {
  const existing = await Keychain.getGenericPassword({ service: SERVICE });
  if (existing) {
    return existing.password;
  }
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const key = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  await Keychain.setGenericPassword('ligdibe', key, {
    service: SERVICE,
    accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
  return key;
};
