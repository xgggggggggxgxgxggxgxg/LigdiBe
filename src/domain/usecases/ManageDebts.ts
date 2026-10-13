import { formatFCFA } from '../../core/currency';
import { dayKey } from '../../core/dates';
import type { Debt } from '../models/Debt';
import type { Transaction } from '../models/Transaction';

export const debtRemaining = (d: Debt): number => Math.max(0, d.amount - d.amountRepaid);

export interface DebtSummary {
  owedToMe: number;
  owedByMe: number;
  net: number;
  overdueCount: number;
}

export const summarizeDebts = (debts: ReadonlyArray<Debt>, now: Date): DebtSummary => {
  const open = debts.filter(d => !d.isSettled);
  const sum = (dir: Debt['direction']) =>
    open.filter(d => d.direction === dir).reduce((s, d) => s + debtRemaining(d), 0);
  const owedToMe = sum('OWED_TO_ME');
  const owedByMe = sum('OWED_BY_ME');
  const today = dayKey(now);
  return {
    owedToMe,
    owedByMe,
    net: owedToMe - owedByMe,
    overdueCount: open.filter(d => d.dueDate !== undefined && d.dueDate.slice(0, 10) < today).length,
  };
};

/** Enregistre un remboursement (partiel ou total). */
export const applyRepayment = (debt: Debt, amount: number): Debt => {
  const amountRepaid = Math.min(debt.amount, debt.amountRepaid + Math.max(0, amount));
  return { ...debt, amountRepaid, isSettled: amountRepaid >= debt.amount };
};

const formatDueDate = (iso: string): string => {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

/** Message courtois pré-rempli (le ton compte : on préserve la relation). */
export const buildReminderMessage = (debt: Debt, senderName?: string): string => {
  const firstName = debt.contactName.trim().split(/\s+/)[0];
  const amount = formatFCFA(debtRemaining(debt));
  const due = debt.dueDate ? ` prévu pour le ${formatDueDate(debt.dueDate)}` : '';
  const signature = senderName ? `\n${senderName}` : '';
  if (debt.direction === 'OWED_TO_ME') {
    return (
      `Bonjour ${firstName}, j'espère que tu vas bien ainsi que la famille 🙏🏾. ` +
      `Petit rappel amical concernant les ${amount}${due}. ` +
      `Fais-moi signe quand ce sera possible pour toi. Merci beaucoup !${signature}`
    );
  }
  return (
    `Bonjour ${firstName}, j'espère que tu vas bien 🙏🏾. ` +
    `Je n'oublie pas les ${amount} que je te dois${due}. Je reviens vers toi très vite. Merci pour ta patience !${signature}`
  );
};

/** Normalise un numéro au format international sans « + » (ex: 70112233 → 22670112233). */
export const toInternationalPhone = (phone: string, defaultCountryCode = '226'): string => {
  const digits = phone.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) {
    return digits.slice(1);
  }
  if (digits.startsWith('00')) {
    return digits.slice(2);
  }
  if (digits.length > 10) {
    return digits;
  }
  // Côte d'Ivoire : numéros à 10 chiffres dont le 0 initial fait partie du numéro (depuis 2021).
  return `${defaultCountryCode}${defaultCountryCode === '225' ? digits : digits.replace(/^0+/, '')}`;
};

export const buildWhatsAppUrl = (phone: string, text: string, defaultCountryCode?: string): string =>
  `https://wa.me/${toInternationalPhone(phone, defaultCountryCode)}?text=${encodeURIComponent(text)}`;

export const buildSmsUrl = (phone: string, text: string): string =>
  `sms:${phone.replace(/[^\d+]/g, '')}?body=${encodeURIComponent(text)}`;

const phoneTail = (p?: string) => (p ? p.replace(/\D/g, '').slice(-8) : undefined);

/**
 * Détecte qu'une transaction entrante/sortante correspond probablement au
 * remboursement d'une dette ouverte (même numéro ou même nom).
 */
export const findDebtForTransaction = (debts: ReadonlyArray<Debt>, tx: Transaction): Debt | undefined => {
  const direction = tx.type === 'INCOME' ? 'OWED_TO_ME' : tx.type === 'EXPENSE' ? 'OWED_BY_ME' : undefined;
  if (!direction) {
    return undefined;
  }
  const txPhone = phoneTail(tx.counterpartyPhone);
  const txName = tx.counterpartyName?.toUpperCase().replace(/\s+/g, ' ').trim();
  return debts.find(
    d =>
      !d.isSettled &&
      d.direction === direction &&
      ((txPhone !== undefined && phoneTail(d.phone) === txPhone) ||
        (txName !== undefined && txName.includes(d.contactName.toUpperCase().trim()))),
  );
};
