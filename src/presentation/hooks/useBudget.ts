import { useMemo } from 'react';
import { calculateDailyBudget, computeBudgetStreak } from '../../domain/usecases/CalculateDailyBudget';
import { useFinanceStore } from '../store/useFinanceStore';

export const useBudget = () => {
  const config = useFinanceStore(s => s.budgetConfig);
  const transactions = useFinanceStore(s => s.transactions);
  const paid = useFinanceStore(s => s.paidFixedExpenseIds);
  const now = useFinanceStore(s => s.now);
  return useMemo(
    () => ({
      ...calculateDailyBudget(config, transactions, new Date(), paid),
      streak: computeBudgetStreak(config, transactions, now),
    }),
    [config, transactions, paid, now],
  );
};
