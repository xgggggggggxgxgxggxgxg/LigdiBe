import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import RNFS from 'react-native-fs';
import {
  ActivityIndicator,
  Appbar,
  Avatar,
  Button,
  Card,
  Dialog,
  Icon,
  List,
  Portal,
  Surface,
  Text,
  useTheme,
} from 'react-native-paper';
import { monthKey } from '../../core/dates';
import { getRepositories } from '../../data/repositories';
import { base64ToBytes, readBackupBytes } from '../../services/archive/BackupArchive';
import { listBackupFiles, restoreBackup, type BackupFile } from '../../services/export/BackupService';
import { exportJsonBackup, exportTransactionsCsv, exportZipBackup } from '../../services/export/ExportService';
import type { BackupSnapshot } from '../../services/exportBuilders';
import { isFileTransferSupported, pickBackupFile, shareFile } from '../../services/files/FilesBridge';
import { useFinanceStore } from '../store/useFinanceStore';
import { palette } from '../theme/theme';

type ExportKind = 'zip' | 'csv' | 'json';

interface LastExport {
  kind: ExportKind;
  path: string;
  count: number;
}

interface PendingRestore {
  source: string;
  snapshot: BackupSnapshot;
}

const fileName = (path: string) => path.split('/').pop() ?? path;

/** « LigdiBe_sauvegarde_20261013-213000.zip » → « 13/10/2026 à 21:30 ». */
export const backupLabel = (name: string): string => {
  const m = name.match(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]} à ${m[4]}:${m[5]}` : name;
};

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`
    : `${Math.max(1, Math.round(bytes / 1024))} Ko`;

const Step = ({ n, icon, label }: { n: number; icon: string; label: string }) => {
  const theme = useTheme();
  return (
    <View style={styles.step}>
      <Avatar.Icon
        size={40}
        icon={icon}
        color={theme.colors.onPrimaryContainer}
        style={{ backgroundColor: theme.colors.primaryContainer }}
      />
      <Text variant="labelMedium" style={styles.stepLabel}>
        {n}. {label}
      </Text>
    </View>
  );
};

export const BackupScreen = ({
  navigation,
}: {
  navigation?: { goBack: () => void; navigate?: (screen: 'Learning') => void };
}) => {
  const theme = useTheme();
  const now = useFinanceStore(s => s.now);
  const hydrate = useFinanceStore(s => s.hydrate);
  const [busy, setBusy] = useState<ExportKind | 'pick' | 'restore'>();
  const [last, setLast] = useState<LastExport>();
  const [files, setFiles] = useState<BackupFile[]>();
  const [pending, setPending] = useState<PendingRestore>();
  const [message, setMessage] = useState<{ ok: boolean; text: string }>();
  const canTransfer = isFileTransferSupported();

  const refreshFiles = useCallback(async () => {
    setFiles(await listBackupFiles());
  }, []);

  useEffect(() => {
    refreshFiles();
  }, [refreshFiles]);

  const runExport = async (kind: ExportKind) => {
    setBusy(kind);
    setMessage(undefined);
    try {
      const repos = await getRepositories();
      const month = monthKey(now);
      const res =
        kind === 'zip'
          ? await exportZipBackup(repos, month)
          : kind === 'json'
          ? await exportJsonBackup(repos, month)
          : await exportTransactionsCsv(repos);
      setLast({ kind, ...res });
      await refreshFiles();
    } catch (e) {
      setMessage({ ok: false, text: `Export impossible : ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(undefined);
    }
  };

  const preview = (source: string, base64: string) => {
    try {
      setPending({ source, snapshot: readBackupBytes(base64ToBytes(base64)) });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };

  const pick = async () => {
    setBusy('pick');
    setMessage(undefined);
    try {
      const picked = await pickBackupFile();
      if (picked) {
        preview(picked.name, picked.base64);
      }
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(undefined);
    }
  };

  const confirmRestore = async () => {
    if (!pending) {
      return;
    }
    setBusy('restore');
    try {
      const report = await restoreBackup(await getRepositories(), pending.snapshot);
      await hydrate();
      setMessage({
        ok: true,
        text: `Restauration réussie : ${report.transactions} opérations, ${report.debts} dettes, ${report.plannedItems} lignes de prévisionnel.`,
      });
    } catch (e) {
      setMessage({ ok: false, text: `Restauration impossible : ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setPending(undefined);
      setBusy(undefined);
    }
  };

  return (
    <View style={[styles.flex, { backgroundColor: theme.colors.background }]}>
      <Appbar.Header mode="small" elevated={false} style={{ backgroundColor: theme.colors.background }}>
        {navigation && <Appbar.BackAction onPress={navigation.goBack} testID="backup-back" />}
        <Appbar.Content title="Sauvegarde & transfert" />
      </Appbar.Header>
      <ScrollView contentContainerStyle={styles.content}>
        <Surface style={[styles.hero, { backgroundColor: theme.colors.primary }]} elevation={2}>
          <Text variant="titleLarge" style={[styles.bold, { color: theme.colors.onPrimary }]}>
            Change de téléphone sans rien perdre
          </Text>
          <Text variant="bodySmall" style={[styles.heroText, { color: theme.colors.onPrimary }]}>
            Tout reste hors-ligne : la sauvegarde est un simple fichier que tu envoies toi-même.
          </Text>
        </Surface>
        <View style={styles.steps}>
          <Step n={1} icon="archive-arrow-down-outline" label="Exporter" />
          <Icon source="chevron-right" size={20} color={theme.colors.outline} />
          <Step n={2} icon="share-variant-outline" label="Envoyer" />
          <Icon source="chevron-right" size={20} color={theme.colors.outline} />
          <Step n={3} icon="archive-arrow-up-outline" label="Importer" />
        </View>

        {message && (
          <Surface
            style={[
              styles.message,
              { backgroundColor: message.ok ? theme.colors.primaryContainer : theme.colors.errorContainer },
            ]}
            elevation={0}
            testID="backup-message">
            <Icon
              source={message.ok ? 'check-circle-outline' : 'alert-circle-outline'}
              size={20}
              color={message.ok ? palette.green : palette.red}
            />
            <Text variant="bodyMedium" style={styles.flex}>
              {message.text}
            </Text>
          </Surface>
        )}

        <Text variant="titleMedium" style={styles.section}>
          Exporter
        </Text>
        <Card style={styles.card} mode="elevated" testID="export-zip-card">
          <Card.Title
            title="Archive ZIP"
            subtitle="Recommandé · tout en un seul fichier"
            left={props => <Avatar.Icon {...props} icon="folder-zip-outline" />}
          />
          <Card.Content>
            <Text variant="bodySmall" style={styles.muted}>
              Opérations, comptes, dettes, tontines, épargne, famille, prévisionnel et budget + un tableau CSV pour
              Excel.
            </Text>
          </Card.Content>
          <Card.Actions>
            <Button
              mode="contained"
              icon="archive-arrow-down-outline"
              loading={busy === 'zip'}
              disabled={busy !== undefined}
              onPress={() => runExport('zip')}
              testID="export-zip">
              Exporter en ZIP
            </Button>
          </Card.Actions>
        </Card>
        <View style={styles.row}>
          <Button
            mode="outlined"
            icon="file-delimited-outline"
            style={styles.flex}
            loading={busy === 'csv'}
            disabled={busy !== undefined}
            onPress={() => runExport('csv')}
            testID="export-csv">
            CSV (Excel)
          </Button>
          <Button
            mode="outlined"
            icon="code-json"
            style={styles.flex}
            loading={busy === 'json'}
            disabled={busy !== undefined}
            onPress={() => runExport('json')}
            testID="export-json">
            JSON
          </Button>
        </View>

        {last && (
          <Card style={styles.card} testID="last-export">
            <Card.Title
              title={`${last.kind.toUpperCase()} prêt ✅`}
              subtitle={`${last.count} opérations · ${fileName(last.path)}`}
              left={props => <Avatar.Icon {...props} icon="check" style={{ backgroundColor: palette.green }} />}
            />
            <Card.Content>
              <Text variant="labelSmall" style={styles.muted} selectable>
                {last.path}
              </Text>
            </Card.Content>
            {canTransfer && (
              <Card.Actions>
                <Button
                  mode="contained-tonal"
                  icon="share-variant"
                  onPress={() =>
                    shareFile(last.path).catch(e =>
                      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) }),
                    )
                  }
                  testID="share-export">
                  Envoyer (WhatsApp, Bluetooth…)
                </Button>
              </Card.Actions>
            )}
          </Card>
        )}

        <Text variant="titleMedium" style={styles.section}>
          Importer
        </Text>
        <Card style={styles.card}>
          <Card.Title
            title="Depuis un fichier"
            subtitle="ZIP ou JSON reçu par WhatsApp, Drive, Bluetooth…"
            left={props => <Avatar.Icon {...props} icon="file-search-outline" />}
          />
          <Card.Actions>
            <Button
              mode="contained"
              icon="folder-open-outline"
              loading={busy === 'pick'}
              disabled={!canTransfer || busy !== undefined}
              onPress={pick}
              testID="pick-backup">
              Choisir un fichier…
            </Button>
          </Card.Actions>
        </Card>
        <Card style={styles.card}>
          <Card.Title
            title="Réanalyser mes SMS"
            subtitle="Apprentissage guidé : importe l'historique en classant chaque SMS"
            left={props => <Avatar.Icon {...props} icon="school-outline" />}
          />
          <Card.Actions>
            <Button
              icon="message-text-clock-outline"
              disabled={!navigation?.navigate}
              onPress={() => navigation?.navigate?.('Learning')}
              testID="backup-open-learning">
              Lancer
            </Button>
          </Card.Actions>
        </Card>
        <Card style={styles.card} testID="found-backups">
          <Card.Title
            title="Sauvegardes sur ce téléphone"
            subtitle="Dossier Téléchargements"
            right={() => <Button onPress={refreshFiles}>Actualiser</Button>}
          />
          {files === undefined && <ActivityIndicator style={styles.loader} />}
          {files?.length === 0 && (
            <Text variant="bodySmall" style={[styles.muted, styles.empty]}>
              Aucune sauvegarde trouvée. Copie ton fichier LigdiBe_sauvegarde_….zip dans Téléchargements, ou utilise «
              Choisir un fichier ».
            </Text>
          )}
          {files?.map(f => (
            <List.Item
              key={f.path}
              testID={`backup-file-${f.name}`}
              title={backupLabel(f.name)}
              description={`${/\.zip$/i.test(f.name) ? 'Archive ZIP' : 'JSON'} · ${formatSize(f.size)}`}
              left={p => <List.Icon {...p} icon={/\.zip$/i.test(f.name) ? 'folder-zip-outline' : 'code-json'} />}
              right={p => <List.Icon {...p} icon="backup-restore" />}
              onPress={async () => {
                try {
                  preview(f.name, await RNFS.readFile(f.path, 'base64'));
                } catch (e) {
                  setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
                }
              }}
            />
          ))}
        </Card>

        <View style={styles.privacy}>
          <Icon source="shield-alert-outline" size={18} color={theme.colors.onSurfaceVariant} />
          <Text variant="labelSmall" style={[styles.flex, styles.muted]}>
            Le fichier exporté n'est pas chiffré : envoie-le seulement à toi-même et supprime-le après l'import.
          </Text>
        </View>
      </ScrollView>

      <Portal>
        <Dialog visible={pending !== undefined} onDismiss={() => setPending(undefined)} testID="restore-dialog">
          <Dialog.Icon icon="backup-restore" />
          <Dialog.Title style={styles.center}>Importer cette sauvegarde ?</Dialog.Title>
          {pending && (
            <Dialog.Content>
              <Text variant="bodyMedium" testID="restore-preview">
                {pending.source}
                {'\n'}Exportée le {pending.snapshot.exportedAt.slice(8, 10)}/{pending.snapshot.exportedAt.slice(5, 7)}/
                {pending.snapshot.exportedAt.slice(0, 4)} · {pending.snapshot.transactions.length} opérations ·{' '}
                {pending.snapshot.debts.length} dettes
              </Text>
              <Text variant="bodySmall" style={[styles.muted, styles.dialogNote]}>
                Les données sont fusionnées : rien n'est supprimé sur ce téléphone.
              </Text>
            </Dialog.Content>
          )}
          <Dialog.Actions>
            <Button onPress={() => setPending(undefined)}>Annuler</Button>
            <Button mode="contained" loading={busy === 'restore'} onPress={confirmRestore} testID="confirm-restore">
              Importer
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, paddingBottom: 48 },
  bold: { fontWeight: '800' },
  muted: { opacity: 0.7 },
  center: { textAlign: 'center' },
  hero: { borderRadius: 24, padding: 20 },
  heroText: { opacity: 0.85, marginTop: 6 },
  steps: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: 16,
    paddingHorizontal: 4,
  },
  step: { alignItems: 'center', gap: 6 },
  stepLabel: { opacity: 0.85 },
  message: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, marginBottom: 8 },
  section: { fontWeight: '800', marginTop: 12, marginBottom: 4 },
  card: { marginTop: 10 },
  row: { flexDirection: 'row', gap: 10, marginTop: 10 },
  loader: { margin: 16 },
  empty: { marginHorizontal: 16, marginBottom: 16 },
  privacy: { flexDirection: 'row', gap: 8, marginTop: 20, alignItems: 'flex-start' },
  dialogNote: { marginTop: 8 },
});
