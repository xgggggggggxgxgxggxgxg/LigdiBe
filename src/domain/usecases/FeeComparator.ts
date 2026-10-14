import { CATEGORIES } from '../../core/categories';
import { roundMoney } from '../../core/currency';
import type { Provider, Transaction } from '../models/Transaction';

export type FeeOperation = 'TRANSFER' | 'WITHDRAWAL' | 'PAYMENT';

export interface FeeObservation {
  provider: Provider;
  operation: FeeOperation;
  amount: number;
  /** Frais + taxes réellement prélevés. */
  charges: number;
}

export interface FeeEstimate {
  provider: Provider;
  /** Frais estimés pour le montant demandé. */
  fee: number;
  /** Taux effectif (0.01 = 1 %). */
  rate: number;
  /** Nombre d'opérations réelles ayant servi à l'estimation. */
  samples: number;
  confidence: 'HIGH' | 'LOW';
}

export interface FeeComparison {
  estimates: FeeEstimate[];
  cheapest?: FeeEstimate;
  /** Écart entre l'opérateur le plus cher et le moins cher. */
  maxSaving: number;
}

/** Un SMS sans mention « Frais » ne dit rien des frais : on ne l'interprète pas comme gratuit. */
const FEE_DISCLOSED = /\b(?:Frais|Taxe|Commission)\s*:/i;

const operationOf = (t: Transaction): FeeOperation | undefined => {
  if (t.type === 'CASH_WITHDRAWAL') {
    return 'WITHDRAWAL';
  }
  if (t.type !== 'EXPENSE') {
    return undefined;
  }
  return t.counterpartyPhone || t.category === CATEGORIES.TRANSFER || t.category === CATEGORIES.FAMILY
    ? 'TRANSFER'
    : 'PAYMENT';
};

/** Frais observés dans l'historique SMS (écritures principales uniquement). */
export const collectFeeObservations = (txs: ReadonlyArray<Transaction>): FeeObservation[] =>
  txs.flatMap(t => {
    const operation = operationOf(t);
    const charges = roundMoney(t.fee + t.tax);
    if (!operation || t.source !== 'SMS' || t.amount <= 0 || t.provider === 'CASH') {
      return [];
    }
    if (charges === 0 && !FEE_DISCLOSED.test(t.rawSms ?? '')) {
      return [];
    }
    return [{ provider: t.provider, operation, amount: t.amount, charges }];
  });

const NEIGHBOURS = 3;
const HIGH_CONFIDENCE_SAMPLES = 5;

/**
 * Estime les frais d'un opérateur pour `amount` à partir des opérations réelles de
 * montant le plus proche (échelle logarithmique : les grilles opérateur sont par paliers).
 */
export const estimateFee = (
  observations: ReadonlyArray<FeeObservation>,
  provider: Provider,
  operation: FeeOperation,
  amount: number,
): FeeEstimate | undefined => {
  const own = observations.filter(o => o.provider === provider && o.operation === operation);
  if (own.length === 0 || amount <= 0) {
    return undefined;
  }
  const nearest = [...own]
    .sort((a, b) => Math.abs(Math.log(a.amount / amount)) - Math.abs(Math.log(b.amount / amount)))
    .slice(0, NEIGHBOURS);
  const rate = nearest.reduce((s, o) => s + o.charges / o.amount, 0) / nearest.length;
  return {
    provider,
    fee: roundMoney(rate * amount),
    rate,
    samples: own.length,
    confidence: own.length >= HIGH_CONFIDENCE_SAMPLES ? 'HIGH' : 'LOW',
  };
};

/** Compare les opérateurs déjà utilisés pour une opération donnée, du moins cher au plus cher. */
export const compareOperators = (
  txs: ReadonlyArray<Transaction>,
  operation: FeeOperation,
  amount: number,
): FeeComparison => {
  const observations = collectFeeObservations(txs);
  const providers = [...new Set(observations.filter(o => o.operation === operation).map(o => o.provider))];
  const estimates = providers
    .map(p => estimateFee(observations, p, operation, amount))
    .filter((e): e is FeeEstimate => e !== undefined)
    .sort((a, b) => a.fee - b.fee);
  const cheapest = estimates[0];
  const maxSaving = estimates.length > 1 ? roundMoney(estimates[estimates.length - 1].fee - cheapest.fee) : 0;
  return { estimates, cheapest, maxSaving };
};

/**
 * Économie possible sur une période : pour chaque opération payée, écart entre
 * les frais réellement payés et l'estimation chez l'opérateur le moins cher.
 */
export const potentialSavings = (
  periodTxs: ReadonlyArray<Transaction>,
  historyTxs: ReadonlyArray<Transaction>,
): number => {
  const observations = collectFeeObservations(historyTxs);
  const paid = collectFeeObservations(periodTxs).filter(o => o.charges > 0);
  let saving = 0;
  for (const o of paid) {
    const providers = [...new Set(observations.filter(x => x.operation === o.operation).map(x => x.provider))];
    const best = Math.min(...providers.map(p => estimateFee(observations, p, o.operation, o.amount)?.fee ?? Infinity));
    if (Number.isFinite(best) && best < o.charges) {
      saving += o.charges - best;
    }
  }
  return roundMoney(saving);
};
