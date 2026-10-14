import { NativeModules, Platform } from 'react-native';

export interface PickedFile {
  name: string;
  size: number;
  base64: string;
}

interface LigdiBeFilesModule {
  shareFile(path: string, mimeType: string, title: string): Promise<boolean>;
  pickFile(): Promise<PickedFile | null>;
}

const nativeModule = (): LigdiBeFilesModule | undefined =>
  Platform.OS === 'android' ? NativeModules.LigdiBeFiles : undefined;

export const isFileTransferSupported = (): boolean => nativeModule() !== undefined;

export const mimeTypeFor = (path: string): string =>
  /\.zip$/i.test(path) ? 'application/zip' : /\.json$/i.test(path) ? 'application/json' : 'text/csv';

/** Ouvre le menu de partage Android (WhatsApp, Bluetooth, e-mail, Drive…) pour ce fichier. */
export const shareFile = async (path: string, title = 'Envoyer ma sauvegarde LigdiBe'): Promise<boolean> => {
  const native = nativeModule();
  if (!native) {
    return false;
  }
  return native.shareFile(path, mimeTypeFor(path), title);
};

/** Sélecteur de fichiers Android ; `null` si l'utilisateur annule ou si indisponible. */
export const pickBackupFile = async (): Promise<PickedFile | null> => {
  const native = nativeModule();
  return native ? native.pickFile() : null;
};
