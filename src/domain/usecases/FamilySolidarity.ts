import { formatFCFA } from '../../core/currency';
import type { FamilyRequest, FamilyRequestStatus } from '../models/FamilyRequest';
import type { Transaction } from '../models/Transaction';
import { familySupport } from './Statistics';

export const FAMILY_REQUESTS_KEY = 'familyRequests';
export const SOLIDARITY_BUDGET_KEY = 'solidarityBudget';

export type SolidarityLevel = 'OK' | 'WARNING' | 'EXCEEDED' | 'NO_BUDGET';

export interface SolidaritySummary {
  /** Budget solidarité mensuel (0 = non défini). */
  budget: number;
  /** Déjà donné ce mois (dépenses « Famille & Solidarité », SMS et espèces). */
  given: number;
  remaining: number;
  /** Part du budget consommée (peut dépasser 1). */
  ratio: number;
  level: SolidarityLevel;
  pendingCount: number;
  pendingAmount: number;
}

export const summarizeSolidarity = (
  requests: ReadonlyArray<FamilyRequest>,
  monthTransactions: ReadonlyArray<Transaction>,
  budget: number,
): SolidaritySummary => {
  const given = familySupport(monthTransactions).total;
  const pending = requests.filter(r => r.status === 'PENDING' || r.status === 'LATER');
  const ratio = budget > 0 ? given / budget : 0;
  return {
    budget,
    given,
    remaining: Math.max(0, budget - given),
    ratio,
    level: budget <= 0 ? 'NO_BUDGET' : ratio > 1 ? 'EXCEEDED' : ratio >= 0.8 ? 'WARNING' : 'OK',
    pendingCount: pending.length,
    pendingAmount: pending.reduce((s, r) => s + r.amount, 0),
  };
};

/**
 * Conseil avant de répondre : peut-on donner sans casser le budget solidarité ?
 * Retourne le montant conseillé (0 = mieux vaut reporter).
 */
export const suggestedGift = (request: Pick<FamilyRequest, 'amount'>, summary: SolidaritySummary): number =>
  summary.level === 'NO_BUDGET' ? request.amount : Math.min(request.amount, summary.remaining);

export type ReplyKind = Exclude<FamilyRequestStatus, 'PENDING'>;

const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? name;

/** Réponses courtoises pré-rédigées (dire non sans froisser fait partie du budget). */
export const buildFamilyReply = (
  kind: ReplyKind,
  request: Pick<FamilyRequest, 'contactName' | 'amount' | 'reason'>,
  options: { given?: number; senderName?: string; laterDate?: string } = {},
): string => {
  const hello = `Bonjour ${firstName(request.contactName)},`;
  const about = request.reason ? ` pour ${request.reason.trim()}` : '';
  const sign = options.senderName ? `\n${options.senderName}` : '';
  switch (kind) {
    case 'GIVEN':
      return `${hello} c'est fait : je t'ai envoyé ${formatFCFA(
        options.given ?? request.amount,
      )}${about}. Courage à toi 🙏🏾${sign}`;
    case 'PARTIAL':
      return `${hello} ce mois-ci je ne peux pas tout, mais je t'envoie ${formatFCFA(
        options.given ?? 0,
      )}${about}. J'espère que ça aidera 🙏🏾${sign}`;
    case 'LATER':
      return `${hello} j'ai bien reçu ta demande${about}. Je ne peux pas maintenant, mais je reviens vers toi ${
        options.laterDate ? `le ${options.laterDate}` : 'en fin de mois'
      }. Courage 🙏🏾${sign}`;
    case 'DECLINED':
      return `${hello} j'ai bien reçu ta demande${about}. Ce mois-ci mon budget est déjà engagé et je ne peux malheureusement pas aider. Je pense fort à toi 🙏🏾${sign}`;
  }
};

/** Applique une décision à une demande. */
export const decideRequest = (
  request: FamilyRequest,
  kind: ReplyKind,
  givenAmount: number,
  decidedAt: string,
): FamilyRequest => ({
  ...request,
  status: kind,
  givenAmount: kind === 'GIVEN' || kind === 'PARTIAL' ? givenAmount : 0,
  decidedAt,
});

/** Les demandes en attente d'abord (les plus anciennes en tête), puis l'historique récent. */
export const sortRequests = (requests: ReadonlyArray<FamilyRequest>): FamilyRequest[] => {
  const open = (r: FamilyRequest) => r.status === 'PENDING' || r.status === 'LATER';
  return [...requests].sort((a, b) =>
    open(a) !== open(b)
      ? open(a)
        ? -1
        : 1
      : open(a)
      ? a.createdAt.localeCompare(b.createdAt)
      : (b.decidedAt ?? b.createdAt).localeCompare(a.decidedAt ?? a.createdAt),
  );
};
