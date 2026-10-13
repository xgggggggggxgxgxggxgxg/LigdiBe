/**
 * Utilitaires de nettoyage de texte pour les SMS d'opérateurs.
 * Gère les espaces insécables, apostrophes typographiques, doubles espaces
 * et les formats numériques mixtes (6 000,00 / 200,000.00 / 3.000F / 4.3478).
 */

const EXOTIC_SPACES = /[     　\t]/g;
const ZERO_WIDTH = /[​-‍﻿]/g;

export const normalizeSms = (raw: string): string =>
  raw
    .replace(ZERO_WIDTH, '')
    .replace(EXOTIC_SPACES, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/ {2,}/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();

/** Réduit les espaces multiples et supprime la ponctuation finale parasite. */
export const cleanName = (value: string): string =>
  value
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, '')
    .trim();

const THOUSANDS_DOT = /^\d{1,3}(\.\d{3})+$/;
const THOUSANDS_COMMA = /^\d{1,3}(,\d{3})+$/;

/**
 * Convertit un montant textuel en nombre.
 * - Les espaces sont des séparateurs de milliers.
 * - Si `,` et `.` coexistent, le dernier rencontré est le séparateur décimal.
 * - Un séparateur unique suivi de groupes de 3 chiffres exactement est un séparateur
 *   de milliers (3.000F, 200,000) ; sinon il est décimal (500.00, 4.3478, 6000,00).
 * Retourne `undefined` si aucune valeur n'est exploitable (ex: "Frais:  FCFA").
 */
export const parseAmount = (value: string | undefined): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  let s = value.replace(/\s+/g, '').replace(/[^\d.,]/g, '');
  if (!/\d/.test(s)) {
    return undefined;
  }
  s = s.replace(/[.,]+$/, '');
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot !== -1 && lastComma !== -1) {
    const decimalSep = lastDot > lastComma ? '.' : ',';
    const thousandSep = decimalSep === '.' ? ',' : '.';
    s = s.split(thousandSep).join('').replace(decimalSep, '.');
  } else if (lastComma !== -1) {
    s = THOUSANDS_COMMA.test(s) ? s.replace(/,/g, '') : s.replace(/,/g, '.');
  } else if (lastDot !== -1 && THOUSANDS_DOT.test(s)) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

/** Montant obligatoire : 0 si absent (utile pour frais/taxes vides). */
export const parseAmountOrZero = (value: string | undefined): number =>
  parseAmount(value) ?? 0;

/** Convertit 'dd/mm/yyyy hh:mm[:ss]' en ISO local (sans fuseau, heure locale du téléphone). */
export const parseFrenchDate = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  const m = value.match(
    /(\d{2})\/(\d{2})\/(\d{4})(?:\s*(?:à|a)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (!m) {
    return undefined;
  }
  const [, dd, mm, yyyy, hh = '0', mi = '0', ss = '0'] = m;
  return buildIso(Number(yyyy), Number(mm), Number(dd), Number(hh), Number(mi), Number(ss));
};

/**
 * Les Trans ID Orange Money encodent la date : `MP261012.1637.71387533`
 * → 2026-10-12 16:37.
 */
export const parseOrangeTransIdDate = (transId: string | undefined): string | undefined => {
  if (!transId) {
    return undefined;
  }
  const m = transId.match(/^[A-Z]{2}(\d{2})(\d{2})(\d{2})\.(\d{2})(\d{2})\./);
  if (!m) {
    return undefined;
  }
  const [, yy, mm, dd, hh, mi] = m;
  return buildIso(2000 + Number(yy), Number(mm), Number(dd), Number(hh), Number(mi), 0);
};

const pad = (n: number): string => String(n).padStart(2, '0');

const buildIso = (y: number, mo: number, d: number, h: number, mi: number, s: number): string | undefined => {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) {
    return undefined;
  }
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}`;
};
