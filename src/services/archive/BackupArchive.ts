import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { parseJsonBackup, type BackupSnapshot } from '../exportBuilders';

export const BACKUP_JSON_NAME = 'sauvegarde.json';
export const BACKUP_CSV_NAME = 'transactions.csv';
export const MANIFEST_NAME = 'manifest.json';
/** Garde-fou « zip bomb » : une sauvegarde LigdiBe réelle pèse quelques Mo. */
export const MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;

export interface BackupManifest {
  app: 'LigdiBe';
  format: 1;
  exportedAt: string;
  transactions: number;
  debts: number;
  files: string[];
}

const README = `Sauvegarde LigdiBe
==================

Pour retrouver tes données sur un autre téléphone :
1. Installe LigdiBe.
2. Réglages › Sauvegarde & transfert › Importer un fichier.
3. Choisis ce fichier .zip (sans le décompresser).

transactions.csv s'ouvre aussi dans Excel ou Google Sheets.
Ce fichier n'est pas chiffré : garde-le en lieu sûr.
`;

/** Archive ZIP : sauvegarde complète (JSON) + CSV lisible + notice + manifeste. */
export const buildBackupZip = (snapshotJson: string, csv: string): Uint8Array => {
  const snapshot = parseJsonBackup(snapshotJson);
  const files = [BACKUP_JSON_NAME, BACKUP_CSV_NAME, 'LISEZMOI.txt', MANIFEST_NAME];
  const manifest: BackupManifest = {
    app: 'LigdiBe',
    format: 1,
    exportedAt: snapshot.exportedAt,
    transactions: snapshot.transactions.length,
    debts: snapshot.debts.length,
    files,
  };
  return zipSync(
    {
      [BACKUP_JSON_NAME]: strToU8(snapshotJson),
      [BACKUP_CSV_NAME]: strToU8(csv),
      'LISEZMOI.txt': strToU8(README),
      [MANIFEST_NAME]: strToU8(JSON.stringify(manifest, null, 2)),
    },
    { level: 6 },
  );
};

/** Les fichiers ZIP commencent par « PK\x03\x04 ». */
export const isZip = (bytes: Uint8Array): boolean =>
  bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;

/**
 * Lit une sauvegarde : archive ZIP LigdiBe ou fichier JSON brut.
 * Seul `sauvegarde.json` est décompressé (taille plafonnée), puis validé.
 */
export const readBackupBytes = (bytes: Uint8Array): BackupSnapshot => {
  if (!isZip(bytes)) {
    return parseJsonBackup(strFromU8(bytes));
  }
  let tooBig = false;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: f => {
        const wanted = f.name.split('/').pop() === BACKUP_JSON_NAME;
        if (wanted && f.originalSize > MAX_UNCOMPRESSED_BYTES) {
          tooBig = true;
          return false;
        }
        return wanted;
      },
    });
  } catch {
    throw new Error('Archive ZIP illisible ou endommagée.');
  }
  if (tooBig) {
    throw new Error('Archive trop volumineuse pour une sauvegarde LigdiBe.');
  }
  const entry = Object.keys(files)[0];
  if (!entry) {
    throw new Error(`Ce ZIP ne contient pas de ${BACKUP_JSON_NAME} : ce n'est pas une sauvegarde LigdiBe.`);
  }
  return parseJsonBackup(strFromU8(files[entry]));
};

// ------------------------------------------------------------- Base64 (RNFS lit/écrit le binaire en base64)
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Uint8Array(256).fill(255);
for (let i = 0; i < ALPHABET.length; i++) {
  LOOKUP[ALPHABET.charCodeAt(i)] = i;
}

/* eslint-disable no-bitwise */
export const bytesToBase64 = (bytes: Uint8Array): string => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out +=
      ALPHABET[(n >> 18) & 63] +
      ALPHABET[(n >> 12) & 63] +
      (i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63] : '=') +
      (i + 2 < bytes.length ? ALPHABET[n & 63] : '=');
  }
  return out;
};

export const base64ToBytes = (b64: string): Uint8Array => {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (LOOKUP[clean.charCodeAt(i)] << 18) |
      (LOOKUP[clean.charCodeAt(i + 1)] << 12) |
      ((i + 2 < clean.length ? LOOKUP[clean.charCodeAt(i + 2)] : 0) << 6) |
      (i + 3 < clean.length ? LOOKUP[clean.charCodeAt(i + 3)] : 0);
    out[o++] = (n >> 16) & 255;
    if (i + 2 < clean.length) {
      out[o++] = (n >> 8) & 255;
    }
    if (i + 3 < clean.length) {
      out[o++] = n & 255;
    }
  }
  return out.subarray(0, o);
};
/* eslint-enable no-bitwise */
