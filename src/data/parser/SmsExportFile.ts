/**
 * Lecture d'un export texte de l'application Android « SMS Exporter » :
 *
 *   [ Exporté le 2026-10-14 02:03 avec l'application SMS Exporter android … ]
 *   ==================================================
 *   Conversation avec OrangeMoney
 *   339 messages
 *   ==================================================
 *
 *   Reçu de OrangeMoney le 2026-03-11 16:06
 *
 *    Vous avez recu 4,000.00 FCFA du …
 *
 *   -----------------------------------------------------
 *
 * Plusieurs exports peuvent être concaténés (l'en-tête suivant colle parfois au
 * dernier message). Seuls les SMS reçus sont gardés : les envoyés ne sont jamais
 * des notifications d'opérateur.
 */
export interface ExportedSms {
  sender: string;
  body: string;
  /** Date de réception (ISO local, sans fuseau). */
  receivedAt: string;
}

const EXPORT_HEADER = /\[\s*Export[ée] le [^\]]*\]/g;
const MESSAGE_HEADER =
  /^(Reçu de|Recu de|Envoyé à|Envoye a) (.+?) le (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(?::(\d{2}))?\s*$/gm;
const SEPARATOR = /^\s*(?:-{5,}|={5,})\s*$/m;

export const parseSmsExportText = (text: string): ExportedSms[] => {
  const clean = text.replace(/\r\n?/g, '\n').replace(EXPORT_HEADER, '\n=====\n');
  const headers = [...clean.matchAll(MESSAGE_HEADER)];
  const out: ExportedSms[] = [];
  headers.forEach((h, i) => {
    // matchAll fournit toujours `index`.
    const start = h.index! + h[0].length;
    const end = i + 1 < headers.length ? headers[i + 1].index! : clean.length;
    const body = clean.slice(start, end).split(SEPARATOR)[0].trim();
    if (!/^Re[çc]u/.test(h[1]) || body.length === 0) {
      return;
    }
    out.push({ sender: h[2].trim(), body, receivedAt: `${h[3]}T${h[4]}:${h[5] ?? '00'}` });
  });
  return out;
};

/** Reconnaît un export « SMS Exporter » (sinon : message d'erreur explicite à l'utilisateur). */
export const looksLikeSmsExport = (text: string): boolean => {
  MESSAGE_HEADER.lastIndex = 0;
  return MESSAGE_HEADER.test(text);
};
