export type FamilyRequestStatus = 'PENDING' | 'GIVEN' | 'PARTIAL' | 'LATER' | 'DECLINED';

/** Demande d'argent d'un proche (« Tonton, il faut m'aider pour l'ordonnance… »). */
export interface FamilyRequest {
  id: string;
  contactName: string;
  phone?: string;
  amount: number;
  reason?: string;
  status: FamilyRequestStatus;
  /** Montant effectivement donné (GIVEN / PARTIAL). */
  givenAmount: number;
  createdAt: string;
  decidedAt?: string;
  /** Opération enregistrée lors du don (espèces ou MoMo saisi à la main). */
  transactionId?: string;
}
