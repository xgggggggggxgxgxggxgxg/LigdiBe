import { CATEGORIES } from '../../core/categories';
import { addDays, dayKey, FRENCH_MONTHS, startOfDay } from '../../core/dates';
import type { Provider, Transaction } from '../models/Transaction';
import { PROVIDER_LABELS } from './ProcessIncomingSms';

export type DataPeriod = 'WEEK' | 'MONTH' | 'YEAR';

export interface PeriodRange {
  period: DataPeriod;
  /** Début inclus (AAAA-MM-JJ). */
  from: string;
  /** Fin exclue (AAAA-MM-JJ). */
  to: string;
  label: string;
}

/**
 * Période courante (offset 0) ou passée (offset -1, -2…).
 * Semaine du lundi au dimanche.
 */
export const periodRange = (period: DataPeriod, now: Date, offset = 0): PeriodRange => {
  if (period === 'WEEK') {
    const today = startOfDay(now);
    const monday = addDays(today, -((today.getDay() + 6) % 7) + offset * 7);
    const sunday = addDays(monday, 6);
    const short = (d: Date) => `${d.getDate()}/${String(d.getMonth() + 1).padStart(2, '0')}`;
    return {
      period,
      from: dayKey(monday),
      to: dayKey(addDays(monday, 7)),
      label: offset === 0 ? 'Cette semaine' : `Du ${short(monday)} au ${short(sunday)}`,
    };
  }
  if (period === 'MONTH') {
    const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    return {
      period,
      from: dayKey(start),
      to: dayKey(end),
      label: `${FRENCH_MONTHS[start.getMonth()]} ${start.getFullYear()}`,
    };
  }
  const year = now.getFullYear() + offset;
  return { period, from: `${year}-01-01`, to: `${year + 1}-01-01`, label: String(year) };
};

/** Forfait internet (payé en MoMo ou avec le crédit d'appel). */
export const isDataPurchase = (t: Transaction): boolean =>
  t.type === 'DATA_FROM_CREDIT' || (t.type === 'AIRTIME_RECHARGE' && t.category === CATEGORIES.DATA);

export const isVoiceRecharge = (t: Transaction): boolean =>
  t.type === 'AIRTIME_RECHARGE' && t.category !== CATEGORIES.DATA;

export interface ProviderDataStat {
  provider: Provider;
  spent: number;
  volumeMb: number;
  count: number;
  /** FCFA par Go (sur les forfaits dont le volume est connu). */
  costPerGb?: number;
}

export interface DataBucket {
  key: string;
  label: string;
  spent: number;
  volumeMb: number;
}

export interface PackStat {
  label: string;
  count: number;
  total: number;
}

export interface DataSummary {
  range: PeriodRange;
  /** Argent sorti du portefeuille MoMo pour des forfaits. */
  spent: number;
  /** Forfaits payés avec le crédit d'appel (déjà comptés dans les recharges). */
  fromCreditAmount: number;
  fromCreditCount: number;
  purchases: number;
  volumeMb: number;
  /** Forfaits dont le volume n'a pas pu être lu dans le SMS. */
  unknownVolumeCount: number;
  costPerGb?: number;
  /** Recharges de crédit d'appel sur la même période (comparaison). */
  voiceSpent: number;
  /** Forfaits courts (≤ 7 jours) : signe d'achats « au jour le jour ». */
  shortPacks: number;
  byProvider: ProviderDataStat[];
  buckets: DataBucket[];
  topPacks: PackStat[];
}

export const formatVolume = (mb: number): string => {
  if (mb >= 1024) {
    const gb = mb / 1024;
    return `${(gb >= 10 ? Math.round(gb) : Math.round(gb * 10) / 10).toString().replace('.', ',')} Go`;
  }
  return `${Math.round(mb)} Mo`;
};

export const formatValidity = (days?: number): string =>
  days === undefined
    ? ''
    : days < 1
    ? ` · ${Math.round(days * 24)} h`
    : days === 1
    ? ' · 1 jour'
    : days === 7
    ? ' · 7 jours'
    : ` · ${days} j`;

const costPerGb = (spent: number, mb: number): number | undefined =>
  mb > 0 ? Math.round((spent / mb) * 1024) : undefined;

const buildBuckets = (txs: ReadonlyArray<Transaction>, range: PeriodRange): DataBucket[] => {
  const buckets: DataBucket[] = [];
  if (range.period === 'YEAR') {
    const year = range.from.slice(0, 4);
    for (let m = 0; m < 12; m++) {
      buckets.push({
        key: `${year}-${String(m + 1).padStart(2, '0')}`,
        label: FRENCH_MONTHS[m].slice(0, 3),
        spent: 0,
        volumeMb: 0,
      });
    }
  } else {
    const days = ['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di'];
    for (let d = new Date(`${range.from}T00:00:00`); dayKey(d) < range.to; d = addDays(d, 1)) {
      buckets.push({
        key: dayKey(d),
        label: range.period === 'WEEK' ? days[(d.getDay() + 6) % 7] : String(d.getDate()),
        spent: 0,
        volumeMb: 0,
      });
    }
  }
  for (const t of txs) {
    const b = buckets.find(x => t.occurredAt.startsWith(x.key));
    if (b) {
      b.spent += t.amount;
      b.volumeMb += t.dataVolumeMb ?? 0;
    }
  }
  return buckets;
};

export const summarizeData = (transactions: ReadonlyArray<Transaction>, range: PeriodRange): DataSummary => {
  const inRange = transactions.filter(t => t.occurredAt >= range.from && t.occurredAt < range.to);
  const data = inRange.filter(isDataPurchase);
  const paid = data.filter(t => t.type === 'AIRTIME_RECHARGE');
  const fromCredit = data.filter(t => t.type === 'DATA_FROM_CREDIT');
  const sum = (txs: ReadonlyArray<Transaction>) => txs.reduce((s, t) => s + t.amount, 0);
  const known = data.filter(t => (t.dataVolumeMb ?? 0) > 0);
  const volumeMb = known.reduce((s, t) => s + (t.dataVolumeMb ?? 0), 0);

  const providers = new Map<Provider, ProviderDataStat & { knownSpent: number }>();
  for (const t of data) {
    const p = providers.get(t.provider) ?? { provider: t.provider, spent: 0, volumeMb: 0, count: 0, knownSpent: 0 };
    p.spent += t.amount;
    p.count += 1;
    if ((t.dataVolumeMb ?? 0) > 0) {
      p.volumeMb += t.dataVolumeMb ?? 0;
      p.knownSpent += t.amount;
    }
    providers.set(t.provider, p);
  }

  const packs = new Map<string, PackStat>();
  for (const t of known) {
    const label = `${formatVolume(t.dataVolumeMb ?? 0)}${formatValidity(t.dataValidityDays)} · ${Math.round(
      t.amount,
    )} F`;
    const p = packs.get(label) ?? { label, count: 0, total: 0 };
    p.count += 1;
    p.total += t.amount;
    packs.set(label, p);
  }

  return {
    range,
    spent: sum(paid),
    fromCreditAmount: sum(fromCredit),
    fromCreditCount: fromCredit.length,
    purchases: data.length,
    volumeMb,
    unknownVolumeCount: data.length - known.length,
    costPerGb: costPerGb(sum(known), volumeMb),
    voiceSpent: sum(inRange.filter(isVoiceRecharge)),
    shortPacks: data.filter(t => t.dataValidityDays !== undefined && t.dataValidityDays <= 7).length,
    byProvider: [...providers.values()]
      .map(({ knownSpent, ...p }) => ({ ...p, costPerGb: costPerGb(knownSpent, p.volumeMb) }))
      .sort((a, b) => b.spent - a.spent),
    buckets: buildBuckets(data, range),
    topPacks: [...packs.values()].sort((a, b) => b.count - a.count || b.total - a.total).slice(0, 3),
  };
};

export interface DataInsight {
  id: string;
  icon: string;
  message: string;
}

/** Constats concrets pour réduire la facture data (sans inventer de tarifs opérateur). */
export const dataInsights = (current: DataSummary, previous?: DataSummary, monthlyLimit = 0): DataInsight[] => {
  const out: DataInsight[] = [];
  const total = current.spent + current.fromCreditAmount;
  if (previous && previous.spent + previous.fromCreditAmount > 0 && total > 0) {
    const before = previous.spent + previous.fromCreditAmount;
    const pct = Math.round(((total - before) / before) * 100);
    if (pct !== 0) {
      out.push({
        id: 'trend',
        icon: pct > 0 ? 'trending-up' : 'trending-down',
        message:
          pct > 0
            ? `${pct} % de plus en forfaits que sur la période précédente.`
            : `Bravo : ${-pct} % de moins en forfaits que sur la période précédente.`,
      });
    }
  }
  if (current.shortPacks >= 4) {
    const shortTotal = Math.round(total * (current.shortPacks / Math.max(1, current.purchases)));
    out.push({
      id: 'short-packs',
      icon: 'calendar-sync',
      message: `${current.shortPacks} forfaits de 7 jours ou moins (≈ ${shortTotal} F). Compare avec un forfait mensuel de ton opérateur : c'est souvent moins cher au Go.`,
    });
  }
  const priced = current.byProvider.filter(p => p.costPerGb !== undefined);
  if (priced.length >= 2) {
    const best = [...priced].sort((a, b) => (a.costPerGb ?? 0) - (b.costPerGb ?? 0))[0];
    out.push({
      id: 'best-provider',
      icon: 'trophy-outline',
      message: `Ton Go le moins cher : ${PROVIDER_LABELS[best.provider]} à ${best.costPerGb} F/Go.`,
    });
  }
  if (current.range.period === 'MONTH' && monthlyLimit > 0 && total > monthlyLimit) {
    out.push({
      id: 'limit',
      icon: 'alert-octagon-outline',
      message: `Plafond data dépassé de ${Math.round(total - monthlyLimit)} F ce mois-ci.`,
    });
  }
  if (current.fromCreditCount > 0) {
    out.push({
      id: 'from-credit',
      icon: 'swap-horizontal',
      message: `${current.fromCreditCount} forfait(s) payé(s) avec ton crédit d'appel : inclus dans le volume, pas recomptés en dépense.`,
    });
  }
  return out;
};

export const MONTHLY_DATA_LIMIT_KEY = 'monthlyDataLimit';
