import type { FamilyMember } from '../models/FamilyMember';

export const FAMILY_MEMBERS_KEY = 'familyMembers';

/**
 * Les 8 derniers chiffres identifient un abonné quel que soit le format
 * (70112233, +226 70 11 22 33, 0022670112233). `undefined` si trop court.
 */
export const phoneTail = (phone: string | undefined): string | undefined => {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length >= 8 ? digits.slice(-8) : undefined;
};

export const familyPhoneTails = (members: ReadonlyArray<Pick<FamilyMember, 'phone'>>): Set<string> =>
  new Set(members.map(m => phoneTail(m.phone)).filter((t): t is string => t !== undefined));

export const isFamilyPhone = (phone: string | undefined, tails: ReadonlySet<string>): boolean => {
  const tail = phoneTail(phone);
  return tail !== undefined && tails.has(tail);
};

/** Fusionne sans doublon (même numéro, ou même nom sans numéro) ; les nouveaux en tête. */
export const mergeFamilyMembers = (
  current: ReadonlyArray<FamilyMember>,
  added: ReadonlyArray<FamilyMember>,
): FamilyMember[] => {
  const keyOf = (m: FamilyMember) => phoneTail(m.phone) ?? `name:${m.name.trim().toLowerCase()}`;
  const seen = new Set<string>();
  return [...added, ...current].filter(m => {
    const key = keyOf(m);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};
