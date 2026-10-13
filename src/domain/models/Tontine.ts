/** Tontine (épargne rotative informelle). */
export interface Tontine {
  id: string;
  name: string;
  contributionAmount: number;
  frequency: 'WEEKLY' | 'MONTHLY';
  membersCount: number;
  /** Rang de l'utilisateur dans l'ordre de ramassage (1-based). */
  myTurn: number;
  startDate: string;
  /** Dates ISO des cotisations déjà versées. */
  paidContributions: string[];
}
