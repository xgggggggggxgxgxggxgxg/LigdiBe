import notifee, {
  AndroidImportance,
  AndroidStyle,
  EventType,
  RepeatFrequency,
  TriggerType,
  type Event,
} from '@notifee/react-native';
import { QUICK_EXPENSE_CATEGORIES } from '../../core/categories';
import { formatFCFA } from '../../core/currency';
import { addDays, formatMonthLabel, monthKey, nextMonthKey, previousMonthKey } from '../../core/dates';
import type { BudgetConfig } from '../../domain/models/Budget';
import type { Debt } from '../../domain/models/Debt';
import { isSpending, type Transaction } from '../../domain/models/Transaction';
import type { Repositories } from '../../domain/repositories';
import { summarizeAirtime } from '../../domain/usecases/AirtimeTracker';
import { calculateDailyBudget } from '../../domain/usecases/CalculateDailyBudget';
import { counterpartyKey } from '../../domain/usecases/CategorizeTransaction';
import { envelopeThresholdCrossed } from '../../domain/usecases/CategoryBudgets';
import { compareMonths, totalFees } from '../../domain/usecases/Statistics';
import { applyRepayment, debtRemaining, findDebtForTransaction } from '../../domain/usecases/ManageDebts';
import { LEARNED_CATEGORIES_KEY } from '../../domain/usecases/ProcessIncomingSms';

export const CHANNELS = {
  TRANSACTIONS: 'ligdibe-transactions',
  REMINDERS: 'ligdibe-reminders',
  ALERTS: 'ligdibe-alerts',
} as const;

const ACTION_CATEGORY = 'category:';
const ACTION_DEBT = 'debt-repay:';
const MORNING_ID = 'ligdibe-morning';
const MONTHLY_REPORT_ID = 'ligdibe-monthly-report';
const FORECAST_REMINDER_ID = 'ligdibe-forecast-reminder';
const EVENING_ID = 'ligdibe-evening';
const AIRTIME_ALERT_KEY = (month: string) => `airtimeAlert:${month}`;

export const ensureNotificationChannels = async (): Promise<void> => {
  await notifee.requestPermission();
  await notifee.createChannel({
    id: CHANNELS.TRANSACTIONS,
    name: 'Transactions détectées',
    importance: AndroidImportance.HIGH,
  });
  await notifee.createChannel({
    id: CHANNELS.REMINDERS,
    name: 'Rappels budget (matin & soir)',
    importance: AndroidImportance.DEFAULT,
  });
  await notifee.createChannel({ id: CHANNELS.ALERTS, name: 'Alertes dépassement', importance: AndroidImportance.HIGH });
};

/** « Dépense de X FCFA détectée. Choisis une catégorie : [Carburant] [Courses] [Repas] » */
export const notifyExpenseDetected = async (tx: Transaction): Promise<void> => {
  await notifee.displayNotification({
    id: `tx-${tx.id}`,
    title: `💸 Dépense de ${formatFCFA(tx.amount)} détectée`,
    body: `${tx.counterpartyName ? `${tx.counterpartyName}. ` : ''}Choisis une catégorie :`,
    data: { transactionId: tx.id },
    android: {
      channelId: CHANNELS.TRANSACTIONS,
      smallIcon: 'ic_launcher',
      pressAction: { id: 'default' },
      actions: QUICK_EXPENSE_CATEGORIES.map(c => ({ title: c, pressAction: { id: `${ACTION_CATEGORY}${c}` } })),
    },
  });
};

export const notifyCashConversion = async (tx: Transaction): Promise<void> => {
  await notifee.displayNotification({
    id: `tx-${tx.id}`,
    title: `👛 ${formatFCFA(tx.amount)} ajoutés à ta Poche`,
    body: 'Retrait converti en espèces : ce n’est pas une dépense. Les frais d’agent sont classés en « Frais & Taxes ».',
    android: { channelId: CHANNELS.TRANSACTIONS, smallIcon: 'ic_launcher', pressAction: { id: 'default' } },
  });
};

export const notifyIncome = async (tx: Transaction, debt?: Debt): Promise<void> => {
  const from = tx.counterpartyName ? ` de ${tx.counterpartyName}` : '';
  await notifee.displayNotification({
    id: `tx-${tx.id}`,
    title: `🎉 ${formatFCFA(tx.amount)} reçus${from}`,
    body: debt
      ? `Est-ce le remboursement de ${debt.contactName} (reste ${formatFCFA(debtRemaining(debt))}) ?`
      : 'Ton solde a été mis à jour automatiquement.',
    data: { transactionId: tx.id, amount: String(tx.amount) },
    android: {
      channelId: CHANNELS.TRANSACTIONS,
      smallIcon: 'ic_launcher',
      pressAction: { id: 'default' },
      actions: debt ? [{ title: '✅ Oui, rembourser', pressAction: { id: `${ACTION_DEBT}${debt.id}` } }] : undefined,
    },
  });
};

export const notifyAlert = async (id: string, title: string, body: string): Promise<void> => {
  await notifee.displayNotification({
    id,
    title,
    body,
    android: {
      channelId: CHANNELS.ALERTS,
      smallIcon: 'ic_launcher',
      pressAction: { id: 'default' },
      style: { type: AndroidStyle.BIGTEXT, text: body },
    },
  });
};

const nextOccurrence = (now: Date, hour: number, minute: number): Date => {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0);
  return d.getTime() > now.getTime() ? d : addDays(d, 1);
};

/**
 * (Re)programme le rappel matinal 07h30 et le bilan du soir 21h30 avec un contenu
 * calculé sur les dernières données. Appelé à l'ouverture et après chaque SMS :
 * les ID fixes écrasent la programmation précédente.
 */
export const scheduleDailyReminders = async (
  config: BudgetConfig,
  transactions: ReadonlyArray<Transaction>,
  now = new Date(),
  paidFixedExpenseIds: ReadonlyArray<string> = [],
): Promise<void> => {
  const morning = nextOccurrence(now, 7, 30);
  const evening = nextOccurrence(now, 21, 30);
  const mb = calculateDailyBudget(config, transactions, morning, paidFixedExpenseIds);
  const eb = calculateDailyBudget(config, transactions, evening, paidFixedExpenseIds);
  const weekend = mb.isWeekendBoostActive || mb.todayMultiplier > 1 ? ' (bonus week-end inclus 🎉)' : '';

  await notifee.createTriggerNotification(
    {
      id: MORNING_ID,
      title: `☀️ Ton budget du jour : ${formatFCFA(mb.todayBudget)}`,
      body: `Il reste ${formatFCFA(Math.max(0, mb.availableForRestOfMonth))} pour ${
        mb.remainingDays
      } jours${weekend}. Bonne journée !`,
      android: { channelId: CHANNELS.REMINDERS, smallIcon: 'ic_launcher', pressAction: { id: 'default' } },
    },
    {
      type: TriggerType.TIMESTAMP,
      timestamp: morning.getTime(),
      repeatFrequency: RepeatFrequency.DAILY,
      alarmManager: { allowWhileIdle: true },
    },
  );

  const verdict =
    eb.status === 'EXCEEDED'
      ? `⚠️ Enveloppe dépassée de ${formatFCFA(-eb.todayRemaining)}. Demain on se rattrape 💪`
      : `✅ Il te reste ${formatFCFA(eb.todayRemaining)} sur l'enveloppe. Bravo !`;
  await notifee.createTriggerNotification(
    {
      id: EVENING_ID,
      title: `🌙 Bilan du jour : ${formatFCFA(eb.todaySpent)} dépensés`,
      body: `${verdict} Pense à noter tes dépenses en espèces.`,
      android: { channelId: CHANNELS.REMINDERS, smallIcon: 'ic_launcher', pressAction: { id: 'default' } },
    },
    {
      type: TriggerType.TIMESTAMP,
      timestamp: evening.getTime(),
      repeatFrequency: RepeatFrequency.DAILY,
      alarmManager: { allowWhileIdle: true },
    },
  );
};

/**
 * Bilan mensuel (le 1er à 09h00, contenu = mois écoulé) et rappel de préparation
 * du prévisionnel (le 28 à 19h00). Reprogrammés à chaque ouverture / SMS.
 */
export const scheduleMonthlyReminders = async (
  transactions: ReadonlyArray<Transaction>,
  now = new Date(),
): Promise<void> => {
  const month = monthKey(now);
  const inMonth = (m: string) => transactions.filter(t => t.occurredAt.startsWith(m));
  const label = (m: string) => formatMonthLabel(m).split(' ')[0];
  const cmp = compareMonths(inMonth(month), inMonth(previousMonthKey(month)), label(previousMonthKey(month)));
  const fees = totalFees(inMonth(month));

  const firstOfNext = new Date(now.getFullYear(), now.getMonth() + 1, 1, 9, 0, 0);
  await notifee.createTriggerNotification(
    {
      id: MONTHLY_REPORT_ID,
      title: `📊 Ton bilan de ${label(month)} est prêt`,
      body: `${formatFCFA(cmp.current)} dépensés. ${cmp.message}${
        fees > 0 ? ` Frais MoMo : ${formatFCFA(fees)}.` : ''
      }`,
      android: { channelId: CHANNELS.REMINDERS, smallIcon: 'ic_launcher', pressAction: { id: 'default' } },
    },
    { type: TriggerType.TIMESTAMP, timestamp: firstOfNext.getTime(), alarmManager: { allowWhileIdle: true } },
  );

  let reminder = new Date(now.getFullYear(), now.getMonth(), 28, 19, 0, 0);
  if (reminder.getTime() <= now.getTime()) {
    reminder = new Date(now.getFullYear(), now.getMonth() + 1, 28, 19, 0, 0);
  }
  await notifee.createTriggerNotification(
    {
      id: FORECAST_REMINDER_ID,
      title: `🗓️ Prépare ton prévisionnel de ${label(nextMonthKey(monthKey(reminder)))}`,
      body: 'Reporte tes lignes récurrentes en un tap et vois si le mois prochain tient la route.',
      android: { channelId: CHANNELS.REMINDERS, smallIcon: 'ic_launcher', pressAction: { id: 'default' } },
    },
    { type: TriggerType.TIMESTAMP, timestamp: reminder.getTime(), alarmManager: { allowWhileIdle: true } },
  );
};

/** Notifications et alertes après l'enregistrement d'une transaction SMS. */
export const notifyAfterRecording = async (
  repos: Repositories,
  recorded: ReadonlyArray<Transaction>,
  now = new Date(),
): Promise<void> => {
  const main = recorded[0];
  if (!main) {
    return;
  }
  if (main.type === 'CASH_WITHDRAWAL') {
    await notifyCashConversion(main);
  } else if (main.type === 'INCOME') {
    await notifyIncome(main, findDebtForTransaction(await repos.debts.getAll(), main));
  } else if (main.type === 'EXPENSE') {
    await notifyExpenseDetected(main);
  }

  const month = monthKey(now);
  const config = await repos.settings.getBudgetConfig();
  const transactions = await repos.transactions.listBetween(`${now.getFullYear()}-01-01`, '9999');
  const paid = await repos.settings.getJson<string[]>(`paidFixed:${month}`, []);

  if (main.type === 'AIRTIME_RECHARGE') {
    const airtime = summarizeAirtime(transactions, now, config.monthlyAirtimeLimit);
    const alreadyAlerted = await repos.settings.getJson<boolean>(AIRTIME_ALERT_KEY(month), false);
    if (airtime.isOverMonthlyLimit && !alreadyAlerted) {
      await repos.settings.setJson(AIRTIME_ALERT_KEY(month), true);
      await notifyAlert(
        'airtime-limit',
        `📶 Crédit & data : ${formatFCFA(airtime.monthly_airtime_spent)} ce mois`,
        `${airtime.monthlyRechargeCount} petites recharges ont dépassé ton plafond de ${formatFCFA(
          config.monthlyAirtimeLimit,
        )}. Un forfait mensuel serait peut-être moins cher.`,
      );
    }
  }

  const crossed = envelopeThresholdCrossed(
    config,
    transactions.filter(t => t.occurredAt.startsWith(month)),
    main,
  );
  if (crossed) {
    const { envelope, threshold } = crossed;
    await notifyAlert(
      `envelope-${envelope.category}`,
      threshold === 1
        ? `🚨 Enveloppe « ${envelope.category} » dépassée`
        : `⚠️ Enveloppe « ${envelope.category} » à 80 %`,
      `${formatFCFA(envelope.spent)} dépensés sur ${formatFCFA(envelope.limit)} ce mois-ci.`,
    );
  }

  if (recorded.some(isSpending)) {
    const b = calculateDailyBudget(config, transactions, now, paid);
    if (b.status === 'EXCEEDED') {
      await notifyAlert(
        'budget-exceeded',
        '🚨 Enveloppe du jour dépassée',
        `Tu as dépensé ${formatFCFA(b.todaySpent)} sur ${formatFCFA(
          b.todayBudget,
        )} autorisés aujourd'hui. Le reste du mois est ré-équilibré automatiquement.`,
      );
    }
  }
  await scheduleDailyReminders(config, transactions, now, paid);
  await scheduleMonthlyReminders(transactions, now);
};

/**
 * Gestion des actions de notification (premier plan ET arrière-plan) :
 * catégorisation en un tap, confirmation de remboursement de dette.
 */
export const handleNotificationEvent = async (
  event: Event,
  repos: Repositories,
  onChange?: () => Promise<void>,
): Promise<void> => {
  if (event.type !== EventType.ACTION_PRESS) {
    return;
  }
  const actionId = event.detail.pressAction?.id ?? '';
  const data = event.detail.notification?.data ?? {};
  const transactionId = typeof data.transactionId === 'string' ? data.transactionId : undefined;

  if (actionId.startsWith(ACTION_CATEGORY) && transactionId) {
    const category = actionId.slice(ACTION_CATEGORY.length);
    await repos.transactions.update(transactionId, { category });
    const tx = (await repos.transactions.listRecent(50)).find(t => t.id === transactionId);
    const key = tx ? counterpartyKey(tx) : undefined;
    if (key) {
      const learned = await repos.settings.getJson<Record<string, string>>(LEARNED_CATEGORIES_KEY, {});
      await repos.settings.setJson(LEARNED_CATEGORIES_KEY, { ...learned, [key]: category });
    }
  } else if (actionId.startsWith(ACTION_DEBT)) {
    const debtId = actionId.slice(ACTION_DEBT.length);
    const debt = (await repos.debts.getAll()).find(d => d.id === debtId);
    if (debt) {
      await repos.debts.save(applyRepayment(debt, Number(data.amount ?? 0)));
    }
  } else {
    return;
  }
  if (event.detail.notification?.id) {
    await notifee.cancelNotification(event.detail.notification.id);
  }
  await onChange?.();
};
