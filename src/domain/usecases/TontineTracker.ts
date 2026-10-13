import type { Tontine } from '../models/Tontine';

const stepDate = (start: Date, frequency: Tontine['frequency'], n: number): Date =>
  frequency === 'WEEKLY'
    ? new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7 * n)
    : new Date(start.getFullYear(), start.getMonth() + n, start.getDate());

export interface TontineStatus {
  /** Cagnotte reçue au tour de l'utilisateur. */
  potAmount: number;
  /** Nombre de cotisations dues à ce jour (tour courant inclus). */
  dueCount: number;
  paidCount: number;
  lateCount: number;
  nextContributionDate?: Date;
  myPickupDate: Date;
  hasReceivedPot: boolean;
  /** Tours restants avant que l'utilisateur ne ramasse. */
  roundsUntilMyTurn: number;
}

export const tontineStatus = (t: Tontine, now: Date): TontineStatus => {
  // 'YYYY-MM-DD' seul serait interprété en UTC : on force l'heure locale.
  const start = new Date(t.startDate.length === 10 ? `${t.startDate}T00:00:00` : t.startDate);
  let dueCount = 0;
  while (dueCount < t.membersCount && stepDate(start, t.frequency, dueCount) <= now) {
    dueCount++;
  }
  const paidCount = t.paidContributions.length;
  return {
    potAmount: t.contributionAmount * t.membersCount,
    dueCount,
    paidCount,
    lateCount: Math.max(0, dueCount - paidCount),
    nextContributionDate: dueCount < t.membersCount ? stepDate(start, t.frequency, dueCount) : undefined,
    myPickupDate: stepDate(start, t.frequency, t.myTurn - 1),
    hasReceivedPot: dueCount >= t.myTurn,
    roundsUntilMyTurn: Math.max(0, t.myTurn - dueCount),
  };
};
