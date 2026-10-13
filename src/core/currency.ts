export const CURRENCY_CODE = 'XOF';
export const CURRENCY_LABEL = 'FCFA';

/** Formate un montant en FCFA : 1234567.8 → "1 234 568 FCFA" (pas de centimes en usage courant). */
export const formatFCFA = (amount: number, opts: { withUnit?: boolean; signed?: boolean } = {}): string => {
  const { withUnit = true, signed = false } = opts;
  const rounded = Math.round(Math.abs(amount));
  const digits = String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const sign = amount < 0 && rounded !== 0 ? '-' : signed && rounded !== 0 ? '+' : '';
  return `${sign}${digits}${withUnit ? ` ${CURRENCY_LABEL}` : ''}`;
};

/** Format compact pour les cartes : 1 250 000 → "1,25 M", 15 000 → "15 k". */
export const formatCompact = (amount: number): string => {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  if (abs >= 1_000_000) {
    return `${sign}${trim(abs / 1_000_000)} M`;
  }
  if (abs >= 10_000) {
    return `${sign}${trim(abs / 1_000)} k`;
  }
  return formatFCFA(amount, { withUnit: false });
};

const trim = (n: number): string =>
  n
    .toFixed(2)
    .replace(/\.?0+$/, '')
    .replace('.', ',');

export const roundMoney = (n: number): number => Math.round(n * 100) / 100;
