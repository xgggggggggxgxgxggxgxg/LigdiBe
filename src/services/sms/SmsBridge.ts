import { NativeModules, PermissionsAndroid, Platform } from 'react-native';

export interface NativeSms {
  sender: string;
  body: string;
  timestamp: number;
}

interface LigdiBeSmsModule {
  readInbox(sinceMs: number, limit: number): Promise<NativeSms[]>;
  drainPending(): Promise<NativeSms[]>;
}

const native: LigdiBeSmsModule | undefined = NativeModules.LigdiBeSms;

export const isSmsSupported = (): boolean => Platform.OS === 'android' && native !== undefined;

/** Demande RECEIVE_SMS (écoute temps réel) et READ_SMS (import de l'historique). */
export const requestSmsPermissions = async (): Promise<boolean> => {
  if (Platform.OS !== 'android') {
    return false;
  }
  const result = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
    PermissionsAndroid.PERMISSIONS.READ_SMS,
  ]);
  return Object.values(result).every(r => r === PermissionsAndroid.RESULTS.GRANTED);
};

export const hasSmsPermissions = async (): Promise<boolean> =>
  Platform.OS === 'android' &&
  (await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS)) &&
  (await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS));

export const readSmsInbox = async (sinceMs: number, limit = 2000): Promise<NativeSms[]> =>
  native ? native.readInbox(sinceMs, limit) : [];

export const drainPendingSms = async (): Promise<NativeSms[]> => (native ? native.drainPending() : []);
