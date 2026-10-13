import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Chip, Divider, IconButton, List, Text } from 'react-native-paper';
import { Field } from '../components/Field';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatFCFA } from '../../core/currency';
import { generateId } from '../../core/id';
import { getRepositories } from '../../data/repositories';
import { parseTransactionSms, type ParsedSms } from '../../data/parser/SmsParserEngine';
import type { BudgetConfig } from '../../domain/models/Budget';
import { ensureNotificationChannels, scheduleDailyReminders } from '../../services/notifications/NotificationService';
import { isValidPin, removePin, setPin } from '../../services/security/AppLock';
import { hasSmsPermissions, isSmsSupported, requestSmsPermissions } from '../../services/sms/SmsBridge';
import { importSmsBacklog } from '../../services/sms/smsIngestion';
import { listBackupFiles, restoreBackupFile, type BackupFile } from '../../services/export/BackupService';
import { AmountInput, parseInputAmount } from '../components/AmountInput';
import { CategoryPicker } from '../components/CategoryPicker';
import { CATEGORIES } from '../../core/categories';
import { useFinanceStore } from '../store/useFinanceStore';
import { useLockStore } from '../store/useLockStore';
import { palette } from '../theme/theme';

const DAY_MS = 24 * 3600 * 1000;

export const SettingsScreen = () => {
  const config = useFinanceStore(s => s.budgetConfig);
  const saveBudgetConfig = useFinanceStore(s => s.saveBudgetConfig);
  const userName = useFinanceStore(s => s.userName);
  const setUserName = useFinanceStore(s => s.setUserName);
  const extraSenders = useFinanceStore(s => s.extraSenders);
  const setExtraSenders = useFinanceStore(s => s.setExtraSenders);
  const hydrate = useFinanceStore(s => s.hydrate);
  const ingestSms = useFinanceStore(s => s.ingestSms);
  const transactions = useFinanceStore(s => s.transactions);
  const paid = useFinanceStore(s => s.paidFixedExpenseIds);

  const [name, setName] = useState(userName);
  const [monthly, setMonthly] = useState(String(config.monthlyBudget));
  const [weekend, setWeekend] = useState(String(config.weekendMultiplier));
  const [airtimeLimit, setAirtimeLimit] = useState(String(config.monthlyAirtimeLimit));
  const [yearly, setYearly] = useState(String(config.yearlyBudget));
  const [fixedLabel, setFixedLabel] = useState('');
  const [fixedAmount, setFixedAmount] = useState('');
  const [fixedDay, setFixedDay] = useState('');
  const [specialDate, setSpecialDate] = useState('');
  const [specialMult, setSpecialMult] = useState('2');
  const [senders, setSenders] = useState(extraSenders.join(', '));
  const [smsGranted, setSmsGranted] = useState(false);
  const [importing, setImporting] = useState(false);
  const [testSms, setTestSms] = useState('');
  const [testResult, setTestResult] = useState<ParsedSms | null | undefined>();
  const pinEnabled = useLockStore(s => s.pinEnabled);
  const setPinEnabled = useLockStore(s => s.setPinEnabled);
  const [newPin, setNewPin] = useState('');
  const [limitCategory, setLimitCategory] = useState<string>(CATEGORIES.FOOD);
  const [limitAmount, setLimitAmount] = useState('');
  const [backups, setBackups] = useState<BackupFile[] | undefined>();

  useEffect(() => {
    hasSmsPermissions()
      .then(setSmsGranted)
      .catch(() => setSmsGranted(false));
  }, []);

  const update = (patch: Partial<BudgetConfig>) => saveBudgetConfig({ ...config, ...patch });

  const saveBudget = async () => {
    const multiplier = Number(weekend.replace(',', '.'));
    await update({
      monthlyBudget: parseInputAmount(monthly),
      weekendMultiplier: Number.isFinite(multiplier) && multiplier >= 1 ? multiplier : 1,
      monthlyAirtimeLimit: parseInputAmount(airtimeLimit),
      yearlyBudget: parseInputAmount(yearly),
    });
    await setUserName(name.trim());
    Alert.alert('Enregistré ✅', 'Ton budget journalier est recalculé.');
  };

  const importHistory = async () => {
    setImporting(true);
    try {
      const granted = smsGranted || (await requestSmsPermissions());
      setSmsGranted(granted);
      if (!granted) {
        Alert.alert(
          'Permission refusée',
          'LigdiBe a besoin de lire les SMS des opérateurs pour remplir ton budget automatiquement.',
        );
        return;
      }
      const report = await importSmsBacklog(await getRepositories(), Date.now() - 90 * DAY_MS);
      await hydrate();
      Alert.alert('Import terminé', `${report.recorded} opération(s) ajoutée(s), ${report.duplicates} déjà connue(s).`);
    } catch (e) {
      Alert.alert('Import impossible', e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text variant="headlineSmall" style={styles.bold}>
          Réglages
        </Text>

        <Card style={styles.card}>
          <Card.Title title="Mon budget" />
          <Card.Content>
            <Field mode="outlined" label="Mon prénom" value={name} onChangeText={setName} style={styles.input} />
            <AmountInput label="Budget mensuel" value={monthly} onChangeText={setMonthly} testID="monthly-budget" />
            <Field
              mode="outlined"
              label="Coefficient week-end (ven. 18h → dim.)"
              value={weekend}
              onChangeText={setWeekend}
              keyboardType="decimal-pad"
              style={styles.input}
            />
            <AmountInput label="Plafond crédit & data / mois" value={airtimeLimit} onChangeText={setAirtimeLimit} />
            <AmountInput label="Budget annuel (0 = aucun)" value={yearly} onChangeText={setYearly} />
            <Button mode="contained" onPress={saveBudget}>
              Enregistrer
            </Button>
          </Card.Content>
        </Card>

        <Card style={styles.card}>
          <Card.Title
            title="Charges fixes"
            subtitle="Loyer, scolarité, électricité… réservées avant le budget du jour"
          />
          {config.fixedExpenses.map(f => (
            <List.Item
              key={f.id}
              title={f.label}
              description={`${formatFCFA(f.amount)} · le ${f.dayOfMonth} du mois`}
              right={() => (
                <IconButton
                  icon="delete-outline"
                  onPress={() => update({ fixedExpenses: config.fixedExpenses.filter(x => x.id !== f.id) })}
                />
              )}
            />
          ))}
          <Card.Content>
            <Field
              mode="outlined"
              dense
              label="Libellé"
              value={fixedLabel}
              onChangeText={setFixedLabel}
              style={styles.input}
            />
            <View style={styles.row}>
              <View style={styles.flex2}>
                <AmountInput label="Montant" value={fixedAmount} onChangeText={setFixedAmount} />
              </View>
              <Field
                mode="outlined"
                label="Jour"
                value={fixedDay}
                onChangeText={setFixedDay}
                keyboardType="number-pad"
                style={styles.flex1}
              />
            </View>
            <Button
              icon="plus"
              disabled={
                !fixedLabel.trim() ||
                parseInputAmount(fixedAmount) <= 0 ||
                !(Number(fixedDay) >= 1 && Number(fixedDay) <= 31)
              }
              onPress={async () => {
                await update({
                  fixedExpenses: [
                    ...config.fixedExpenses,
                    {
                      id: generateId('fixed'),
                      label: fixedLabel.trim(),
                      amount: parseInputAmount(fixedAmount),
                      dayOfMonth: Number(fixedDay),
                    },
                  ],
                });
                setFixedLabel('');
                setFixedAmount('');
                setFixedDay('');
              }}>
              Ajouter la charge
            </Button>
          </Card.Content>
        </Card>

        <Card style={styles.card}>
          <Card.Title title="Enveloppes par catégorie" subtitle="Alerte à 80 % et en cas de dépassement" />
          {Object.entries(config.categoryLimits).map(([category, limit]) => (
            <List.Item
              key={category}
              title={category}
              description={`${formatFCFA(limit)} / mois`}
              right={() => (
                <IconButton
                  icon="delete-outline"
                  onPress={() => {
                    const rest = { ...config.categoryLimits };
                    delete rest[category];
                    return update({ categoryLimits: rest });
                  }}
                />
              )}
            />
          ))}
          <Card.Content>
            <CategoryPicker value={limitCategory} onChange={setLimitCategory} />
            <AmountInput label={`Plafond « ${limitCategory} »`} value={limitAmount} onChangeText={setLimitAmount} />
            <Button
              icon="plus"
              disabled={parseInputAmount(limitAmount) <= 0}
              onPress={async () => {
                await update({
                  categoryLimits: { ...config.categoryLimits, [limitCategory]: parseInputAmount(limitAmount) },
                });
                setLimitAmount('');
              }}>
              Définir l'enveloppe
            </Button>
          </Card.Content>
        </Card>

        <Card style={styles.card}>
          <Card.Title title="Jours spéciaux" subtitle="Tabaski, Noël, mariage… surpondérés dans le budget" />
          <Card.Content>
            <View style={styles.chips}>
              {config.specialDays.map(d => (
                <Chip
                  key={d.date}
                  onClose={() => update({ specialDays: config.specialDays.filter(x => x.date !== d.date) })}>
                  {d.date} ×{d.multiplier}
                </Chip>
              ))}
            </View>
            <View style={styles.row}>
              <Field
                mode="outlined"
                dense
                label="AAAA-MM-JJ"
                value={specialDate}
                onChangeText={setSpecialDate}
                style={styles.flex2}
              />
              <Field
                mode="outlined"
                dense
                label="Coef"
                value={specialMult}
                onChangeText={setSpecialMult}
                keyboardType="decimal-pad"
                style={styles.flex1}
              />
              <IconButton
                icon="plus"
                disabled={!/^\d{4}-\d{2}-\d{2}$/.test(specialDate) || !(Number(specialMult.replace(',', '.')) > 0)}
                onPress={async () => {
                  await update({
                    specialDays: [
                      ...config.specialDays.filter(x => x.date !== specialDate),
                      { date: specialDate, multiplier: Number(specialMult.replace(',', '.')) },
                    ],
                  });
                  setSpecialDate('');
                }}
              />
            </View>
          </Card.Content>
        </Card>

        <Card style={styles.card}>
          <Card.Title
            title="Lecture des SMS"
            subtitle={
              isSmsSupported() ? (smsGranted ? 'Activée ✅' : 'Désactivée') : 'Disponible sur Android uniquement'
            }
          />
          <Card.Content>
            <Text variant="bodySmall" style={styles.muted}>
              Seuls les SMS des expéditeurs agréés (Orange Money, Moov Money, Wave, UBA, Ecobank, Telecel…) sont
              analysés. Les codes OTP / PIN sont ignorés et rien ne quitte ton téléphone.
            </Text>
            <Button
              mode="contained-tonal"
              icon="message-processing-outline"
              loading={importing}
              disabled={importing}
              onPress={importHistory}
              style={styles.input}>
              {smsGranted ? 'Importer les 90 derniers jours' : 'Autoriser et importer'}
            </Button>
            <Field
              mode="outlined"
              dense
              label="Expéditeurs supplémentaires (séparés par des virgules)"
              value={senders}
              onChangeText={setSenders}
              onBlur={() => setExtraSenders(senders.split(','))}
              style={styles.input}
            />
          </Card.Content>
        </Card>

        <Card style={styles.card}>
          <Card.Title title="Tester un SMS" subtitle="Colle un SMS opérateur pour vérifier qu'il est reconnu" />
          <Card.Content>
            <Field
              mode="outlined"
              multiline
              numberOfLines={4}
              testID="test-sms-input"
              value={testSms}
              onChangeText={setTestSms}
              style={styles.input}
            />
            <View style={styles.row}>
              <Button onPress={() => setTestResult(parseTransactionSms(testSms))} disabled={!testSms.trim()}>
                Analyser
              </Button>
              <Button
                disabled={!testResult}
                onPress={async () => {
                  const r = await ingestSms({ body: testSms });
                  Alert.alert(
                    r.status === 'RECORDED'
                      ? 'Ajouté ✅'
                      : r.status === 'DUPLICATE'
                      ? 'Déjà enregistré'
                      : 'Non reconnu',
                  );
                }}>
                Enregistrer
              </Button>
            </View>
            {testResult === null && <Text style={{ color: palette.red }}>SMS non reconnu (ou code de sécurité).</Text>}
            {testResult && (
              <Text variant="bodySmall" selectable testID="test-sms-result">
                {testResult.provider} · {testResult.type} · {formatFCFA(testResult.amount)}
                {testResult.fee + testResult.tax > 0 ? ` (+${testResult.fee + testResult.tax} frais)` : ''}
                {testResult.counterpartyName ? ` · ${testResult.counterpartyName}` : ''}
                {testResult.balanceAfter !== undefined ? ` · solde ${formatFCFA(testResult.balanceAfter)}` : ''}
              </Text>
            )}
          </Card.Content>
        </Card>

        <Card style={styles.card}>
          <Card.Title
            title="Restaurer une sauvegarde"
            subtitle="Nouveau téléphone ? Copie ton fichier LigdiBe_sauvegarde_….json dans Téléchargements"
          />
          <Card.Actions>
            <Button
              icon="folder-search-outline"
              onPress={async () => {
                const files = await listBackupFiles();
                setBackups(files);
                if (files.length === 0) {
                  Alert.alert(
                    'Aucune sauvegarde trouvée',
                    'Exporte une sauvegarde JSON depuis l’onglet Stats de ton ancien téléphone.',
                  );
                }
              }}>
              Chercher
            </Button>
          </Card.Actions>
          {backups?.map(f => (
            <List.Item
              key={f.path}
              title={f.name.replace('LigdiBe_sauvegarde_', '').replace('.json', '')}
              description={`${Math.round(f.size / 1024)} Ko`}
              left={p => <List.Icon {...p} icon="backup-restore" />}
              onPress={() =>
                Alert.alert('Restaurer cette sauvegarde ?', 'Les données seront fusionnées avec celles du téléphone.', [
                  { text: 'Annuler', style: 'cancel' },
                  {
                    text: 'Restaurer',
                    onPress: async () => {
                      try {
                        const report = await restoreBackupFile(await getRepositories(), f.path);
                        await hydrate();
                        Alert.alert(
                          'Restauration réussie ✅',
                          `${report.transactions} opérations, ${report.debts} dettes récupérées.`,
                        );
                      } catch (e) {
                        Alert.alert('Restauration impossible', e instanceof Error ? e.message : String(e));
                      }
                    },
                  },
                ])
              }
            />
          ))}
        </Card>

        <Card style={styles.card}>
          <Card.Title
            title="Verrouillage par code"
            subtitle={pinEnabled ? 'Activé 🔒 (après 1 min en arrière-plan)' : 'Désactivé'}
          />
          <Card.Content>
            <Field
              mode="outlined"
              dense
              label={pinEnabled ? 'Nouveau code (4 à 6 chiffres)' : 'Code (4 à 6 chiffres)'}
              value={newPin}
              onChangeText={v => setNewPin(v.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              secureTextEntry
              style={styles.input}
            />
          </Card.Content>
          <Card.Actions>
            {pinEnabled && (
              <Button
                onPress={async () => {
                  await removePin();
                  setPinEnabled(false);
                }}>
                Désactiver
              </Button>
            )}
            <Button
              mode="contained-tonal"
              disabled={!isValidPin(newPin)}
              onPress={async () => {
                await setPin(newPin);
                setNewPin('');
                setPinEnabled(true);
                Alert.alert(
                  'Code enregistré 🔒',
                  'Ne l’oublie pas : il n’existe aucun moyen de le récupérer en ligne.',
                );
              }}>
              {pinEnabled ? 'Changer le code' : 'Activer'}
            </Button>
          </Card.Actions>
        </Card>

        <Card style={styles.card}>
          <Card.Title title="Rappels" subtitle="07h30 : budget du jour · 21h30 : bilan" />
          <Card.Actions>
            <Button
              icon="bell-ring-outline"
              onPress={async () => {
                await ensureNotificationChannels();
                await scheduleDailyReminders(config, transactions, new Date(), paid);
                Alert.alert('Rappels programmés ✅');
              }}>
              Activer / reprogrammer
            </Button>
          </Card.Actions>
        </Card>
        <Divider style={styles.input} />
        <Text variant="bodySmall" style={[styles.muted, styles.center]}>
          LigdiBe · 100 % hors-ligne · données chiffrées (AES-256) sur ton téléphone
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surface },
  content: { padding: 16, paddingBottom: 48 },
  bold: { fontWeight: '800' },
  card: { marginTop: 14, backgroundColor: '#fff' },
  input: { marginVertical: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex1: { flex: 1 },
  flex2: { flex: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  muted: { opacity: 0.65 },
  center: { textAlign: 'center' },
});
