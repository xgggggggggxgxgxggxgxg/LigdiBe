import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import { phoneTail } from '../../domain/usecases/FamilyMembers';

export interface PhoneContact {
  id: string;
  name: string;
  phone: string;
  starred: boolean;
}

interface LigdiBeContactsModule {
  list(): Promise<PhoneContact[]>;
}

const nativeModule = (): LigdiBeContactsModule | undefined => NativeModules.LigdiBeContacts;

export type ContactsLoadResult = { status: 'OK'; contacts: PhoneContact[] } | { status: 'DENIED' | 'UNAVAILABLE' };

/**
 * Un contact par numéro (les doublons « +226… » / « 70… » sont fusionnés),
 * favoris d'abord puis ordre alphabétique sans accents.
 */
export const normalizeContacts = (raw: ReadonlyArray<PhoneContact>): PhoneContact[] => {
  const byTail = new Map<string, PhoneContact>();
  for (const c of raw) {
    const tail = phoneTail(c.phone);
    const name = c.name.trim();
    if (!tail || !name) {
      continue;
    }
    const existing = byTail.get(tail);
    if (!existing || (c.starred && !existing.starred)) {
      byTail.set(tail, { ...c, name, phone: c.phone.replace(/[^\d+]/g, '') });
    }
  }
  const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return [...byTail.values()].sort((a, b) =>
    a.starred !== b.starred ? (a.starred ? -1 : 1) : fold(a.name).localeCompare(fold(b.name)),
  );
};

/** Demande READ_CONTACTS (avec explication) puis lit les contacts localement. */
export const loadPhoneContacts = async (): Promise<ContactsLoadResult> => {
  const native = nativeModule();
  if (Platform.OS !== 'android' || !native) {
    return { status: 'UNAVAILABLE' };
  }
  const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_CONTACTS, {
    title: 'Accès aux contacts',
    message:
      'LigdiBe lit tes contacts sur ton téléphone pour ajouter ta famille en un tap. Rien n’est envoyé sur Internet.',
    buttonPositive: 'Autoriser',
    buttonNegative: 'Plus tard',
  });
  if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
    return { status: 'DENIED' };
  }
  try {
    return { status: 'OK', contacts: normalizeContacts(await native.list()) };
  } catch {
    return { status: 'DENIED' };
  }
};
