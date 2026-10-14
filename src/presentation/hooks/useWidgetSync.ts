import { useEffect } from 'react';
import { buildWidgetPayload, pushWidget } from '../../services/widget/WidgetService';
import { useFinanceStore } from '../store/useFinanceStore';
import { useAccounts } from './useAccounts';
import { useBudget } from './useBudget';

/** Tient le widget d'écran d'accueil à jour à chaque changement de budget ou de solde. */
export const useWidgetSync = (): void => {
  const budget = useBudget();
  const { totalBalance } = useAccounts();
  const ready = useFinanceStore(s => s.ready && s.onboarded && !s.error);
  const showBalance = useFinanceStore(s => s.widgetShowBalance);

  useEffect(() => {
    if (!ready) {
      return;
    }
    pushWidget(
      buildWidgetPayload({
        budget,
        streak: budget.streak,
        now: new Date(),
        totalBalance: showBalance ? totalBalance : undefined,
      }),
    );
  }, [ready, budget, totalBalance, showBalance]);
};
