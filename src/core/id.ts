/** Identifiant unique local (pas besoin d'UUID cryptographique : aucune synchro serveur). */
let counter = 0;
export const generateId = (prefix = 'id'): string => {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
};

/** Empreinte stable (FNV-1a 32 bits) pour dédupliquer un SMS sans référence. */
/* eslint-disable no-bitwise */
export const fingerprint = (text: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
};
/* eslint-enable no-bitwise */
