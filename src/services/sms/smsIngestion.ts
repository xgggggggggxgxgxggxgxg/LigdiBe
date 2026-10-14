import type { Repositories } from '../../domain/repositories';
import { ProcessIncomingSmsUseCase, type ProcessSmsResult } from '../../domain/usecases/ProcessIncomingSms';
import { notifyAfterRecording, notifyUnrecognizedSms } from '../notifications/NotificationService';
import { refreshWidgetFromRepos } from '../widget/WidgetService';
import { drainPendingSms, readSmsInbox, type NativeSms } from './SmsBridge';

export interface IngestionReport {
  recorded: number;
  duplicates: number;
  ignored: number;
  /** SMS opérateur au format inconnu, mis de côté pour saisie manuelle. */
  unrecognized: number;
}

const tally = (report: IngestionReport, r: ProcessSmsResult) => {
  if (r.status === 'RECORDED') {
    report.recorded++;
  } else if (r.status === 'DUPLICATE') {
    report.duplicates++;
  } else if (r.status === 'UNRECOGNIZED') {
    report.unrecognized++;
  } else {
    report.ignored++;
  }
};

/**
 * Point d'entrée de la tâche Headless (SMS reçu en temps réel).
 * Enregistre la transaction puis déclenche notification interactive + alertes.
 */
export const processRealtimeSms = async (repos: Repositories, sms: NativeSms): Promise<ProcessSmsResult> => {
  const result = await new ProcessIncomingSmsUseCase(repos).execute({
    body: sms.body,
    sender: sms.sender,
    receivedAt: new Date(sms.timestamp),
  });
  if (result.status === 'RECORDED') {
    await notifyAfterRecording(repos, result.entries.transactions);
    // Application fermée : le widget reflète aussitôt la dépense.
    await refreshWidgetFromRepos(repos).catch(() => false);
  } else if (result.status === 'UNRECOGNIZED') {
    await notifyUnrecognizedSms(result.pending);
  }
  return result;
};

/** Import silencieux de l'historique (premier lancement) + SMS en file d'attente native. */
export const importSmsBacklog = async (repos: Repositories, sinceMs: number): Promise<IngestionReport> => {
  const report: IngestionReport = { recorded: 0, duplicates: 0, ignored: 0, unrecognized: 0 };
  const uc = new ProcessIncomingSmsUseCase(repos);
  const messages = [...(await readSmsInbox(sinceMs)), ...(await drainPendingSms())].sort(
    (a, b) => a.timestamp - b.timestamp,
  );
  for (const sms of messages) {
    tally(report, await uc.execute({ body: sms.body, sender: sms.sender, receivedAt: new Date(sms.timestamp) }));
  }
  return report;
};
