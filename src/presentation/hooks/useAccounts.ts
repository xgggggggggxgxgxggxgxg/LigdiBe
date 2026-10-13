import { useMemo } from 'react';
import { useFinanceStore } from '../store/useFinanceStore';

export const useAccounts = () => {
  const accounts = useFinanceStore(s => s.accounts);
  return useMemo(
    () => ({ accounts, totalBalance: accounts.reduce((sum, a) => sum + a.currentBalance, 0) }),
    [accounts],
  );
};
