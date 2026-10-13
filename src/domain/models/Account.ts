import type { Provider } from './Transaction';

export type AccountType = 'MOMO' | 'BANK' | 'CASH';

export interface Account {
  id: string;
  name: string;
  provider: Provider;
  currentBalance: number;
  type: AccountType;
  /** Date de la dernière mise à jour de solde (ISO). */
  updatedAt?: string;
}

export const CASH_ACCOUNT_ID = 'cash-wallet';

export const DEFAULT_ACCOUNTS: ReadonlyArray<Account> = [
  { id: 'orange-money', name: 'Orange Money', provider: 'ORANGE', currentBalance: 0, type: 'MOMO' },
  { id: 'moov-money', name: 'Moov Money', provider: 'MOOV', currentBalance: 0, type: 'MOMO' },
  { id: 'wave-uba', name: 'Wave / UBA', provider: 'UBA_WAVE', currentBalance: 0, type: 'MOMO' },
  { id: 'bank', name: 'Banque', provider: 'BANK', currentBalance: 0, type: 'BANK' },
  { id: CASH_ACCOUNT_ID, name: 'Portefeuille Espèces (Poche)', provider: 'CASH', currentBalance: 0, type: 'CASH' },
];

export const accountIdForProvider = (provider: Provider): string => {
  const found = DEFAULT_ACCOUNTS.find(a => a.provider === provider);
  return found ? found.id : `${provider.toLowerCase()}-account`;
};
