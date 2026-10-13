import { useMemo } from 'react';
import { summarizeAirtime } from '../../domain/usecases/AirtimeTracker';
import { useFinanceStore } from '../store/useFinanceStore';

export const useAirtime = () => {
  const transactions = useFinanceStore(s => s.transactions);
  const limit = useFinanceStore(s => s.budgetConfig.monthlyAirtimeLimit);
  return useMemo(() => summarizeAirtime(transactions, new Date(), limit), [transactions, limit]);
};
