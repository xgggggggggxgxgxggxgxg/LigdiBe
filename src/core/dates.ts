/** Utilitaires de dates en heure locale du téléphone (les SMS opérateurs sont en heure locale). */

const pad = (n: number): string => String(n).padStart(2, '0');

/** ISO local sans fuseau : 'YYYY-MM-DDTHH:mm:ss'. */
export const toLocalIso = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(
    d.getSeconds(),
  )}`;

/** Parse un ISO local (ou avec fuseau) en Date. */
export const fromIso = (iso: string): Date => new Date(iso);

export const dayKey = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const monthKey = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

export const yearKey = (d: Date): string => String(d.getFullYear());

export const nextMonthKey = (month: string): string => {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
};

export const previousMonthKey = (month: string): string => {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
};

export const daysInMonth = (d: Date): number => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();

export const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export const startOfMonth = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), 1);

export const addDays = (d: Date, n: number): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), d.getSeconds());

export const isSameDay = (a: Date, b: Date): boolean => dayKey(a) === dayKey(b);

/** Fenêtre « week-end » : du vendredi 18h00 au dimanche 23h59. */
export const isWeekendWindow = (d: Date): boolean => {
  const day = d.getDay();
  return day === 6 || day === 0 || (day === 5 && d.getHours() >= 18);
};

export const FRENCH_WEEKDAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
export const FRENCH_MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

export const formatMonthLabel = (month: string): string => {
  const [y, m] = month.split('-').map(Number);
  return `${FRENCH_MONTHS[m - 1]} ${y}`;
};

/** Horodatage pour noms de fichiers : 20261013-213000. */
export const fileTimestamp = (d: Date): string =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(
    d.getSeconds(),
  )}`;
