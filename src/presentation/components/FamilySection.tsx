import React, { useMemo, useState } from 'react';
import { Alert, FlatList, Linking, ScrollView, StyleSheet, View } from 'react-native';
import {
  Avatar,
  Button,
  Chip,
  IconButton,
  ProgressBar,
  SegmentedButtons,
  Surface,
  Text,
  useTheme,
} from 'react-native-paper';
import { formatFCFA } from '../../core/currency';
import { formatMonthLabel, monthKey } from '../../core/dates';
import { CASH_ACCOUNT_ID } from '../../domain/models/Account';
import type { FamilyRequest, FamilyRequestStatus } from '../../domain/models/FamilyRequest';
import {
  buildFamilyReply,
  sortRequests,
  suggestedGift,
  summarizeSolidarity,
  type ReplyKind,
  type SolidaritySummary,
} from '../../domain/usecases/FamilySolidarity';
import { buildSmsUrl, buildWhatsAppUrl } from '../../domain/usecases/ManageDebts';
import { useFinanceStore } from '../store/useFinanceStore';
import { palette } from '../theme/theme';
import { AmountInput, parseInputAmount } from './AmountInput';
import { Field } from './Field';
import { AppModal } from './Screen';

const STATUS: Record<FamilyRequestStatus, { label: string; color: string; icon: string }> = {
  PENDING: { label: 'À répondre', color: palette.gold, icon: 'clock-outline' },
  LATER: { label: 'Reporté', color: palette.orange, icon: 'calendar-clock' },
  GIVEN: { label: 'Donné', color: palette.green, icon: 'check-circle-outline' },
  PARTIAL: { label: 'Une partie', color: palette.green, icon: 'circle-half-full' },
  DECLINED: { label: 'Décliné', color: palette.red, icon: 'close-circle-outline' },
};

const REASONS = ['Santé', 'Scolarité', 'Funérailles', 'Baptême', 'Mariage', 'Nourriture', 'Transport', 'Loyer'];

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('');

const levelColor = (s: SolidaritySummary) =>
  s.level === 'EXCEEDED' ? palette.red : s.level === 'WARNING' ? palette.orange : palette.green;

const openUrl = async (url: string, fallback?: string) => {
  try {
    await Linking.openURL(url);
  } catch {
    if (fallback) {
      await Linking.openURL(fallback);
    } else {
      Alert.alert('Impossible d’ouvrir l’application');
    }
  }
};

const SolidarityHeader = ({ summary }: { summary: SolidaritySummary }) => {
  const theme = useTheme();
  const setBudget = useFinanceStore(s => s.setSolidarityBudget);
  const now = useFinanceStore(s => s.now);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(summary.budget > 0 ? String(summary.budget) : '');
  const color = levelColor(summary);
  return (
    <Surface
      style={[styles.header, { backgroundColor: theme.colors.primaryContainer }]}
      elevation={0}
      testID="solidarity-header">
      <View style={styles.rowBetween}>
        <Text variant="labelLarge" style={{ color: theme.colors.onPrimaryContainer }}>
          🤝🏾 Budget solidarité · {formatMonthLabel(monthKey(now))}
        </Text>
        <IconButton
          icon={editing ? 'close' : 'pencil-outline'}
          size={18}
          onPress={() => setEditing(e => !e)}
          accessibilityLabel="Modifier le budget solidarité"
          testID="edit-solidarity-budget"
        />
      </View>
      {editing ? (
        <View style={styles.rowCenter}>
          <View style={styles.flex}>
            <AmountInput
              label="Budget mensuel"
              value={value}
              onChangeText={setValue}
              testID="solidarity-budget-input"
            />
          </View>
          <Button
            mode="contained"
            onPress={async () => {
              await setBudget(parseInputAmount(value));
              setEditing(false);
            }}
            testID="save-solidarity-budget">
            OK
          </Button>
        </View>
      ) : (
        <>
          <Text variant="headlineSmall" style={[styles.big, { color: theme.colors.onPrimaryContainer }]}>
            {formatFCFA(summary.given)}
            {summary.budget > 0 && (
              <Text variant="titleSmall" style={styles.muted}>
                {' '}
                / {formatFCFA(summary.budget)}
              </Text>
            )}
          </Text>
          {summary.budget > 0 ? (
            <>
              <ProgressBar progress={Math.min(1, summary.ratio)} color={color} style={styles.bar} />
              <Text variant="labelMedium" style={{ color }} testID="solidarity-remaining">
                {summary.level === 'EXCEEDED'
                  ? `Budget dépassé de ${formatFCFA(summary.given - summary.budget)}`
                  : summary.remaining === 0
                  ? 'Budget du mois atteint 🙏🏾'
                  : `Il reste ${formatFCFA(summary.remaining)} pour aider ce mois-ci`}
              </Text>
            </>
          ) : (
            <Text variant="bodySmall" style={styles.muted}>
              Fixe un budget mensuel pour aider sans te mettre en difficulté.
            </Text>
          )}
        </>
      )}
      {summary.pendingCount > 0 && (
        <Chip icon="bell-ring-outline" compact style={styles.pendingChip} testID="solidarity-pending">
          {summary.pendingCount} demande{summary.pendingCount > 1 ? 's' : ''} · {formatFCFA(summary.pendingAmount)}
        </Chip>
      )}
    </Surface>
  );
};

const RequestCard = ({ request, onAnswer }: { request: FamilyRequest; onAnswer: (r: FamilyRequest) => void }) => {
  const deleteRequest = useFinanceStore(s => s.deleteFamilyRequest);
  const st = STATUS[request.status];
  const open = request.status === 'PENDING' || request.status === 'LATER';
  return (
    <Surface style={[styles.card, !open && styles.closed]} elevation={1} testID={`family-${request.id}`}>
      <View style={styles.rowCenter}>
        <Avatar.Text
          size={44}
          label={initials(request.contactName)}
          style={{ backgroundColor: st.color }}
          color="#fff"
        />
        <View style={styles.cardBody}>
          <Text variant="titleSmall">{request.contactName}</Text>
          <Text variant="bodySmall" style={styles.muted} numberOfLines={1}>
            {request.reason ?? 'Sans motif'} · {request.createdAt.slice(8, 10)}/{request.createdAt.slice(5, 7)}
          </Text>
        </View>
        <View style={styles.cardEnd}>
          <Text variant="titleMedium" style={styles.bold}>
            {formatFCFA(request.amount)}
          </Text>
          <Chip compact icon={st.icon} textStyle={[styles.chipText, { color: st.color }]} style={styles.statusChip}>
            {request.status === 'PARTIAL' ? `${st.label} : ${formatFCFA(request.givenAmount)}` : st.label}
          </Chip>
        </View>
      </View>
      <View style={styles.actions}>
        <IconButton icon="delete-outline" size={18} onPress={() => deleteRequest(request.id)} />
        {open && (
          <Button
            mode="contained-tonal"
            icon="message-reply-text-outline"
            onPress={() => onAnswer(request)}
            testID={`answer-${request.id}`}>
            Répondre
          </Button>
        )}
      </View>
    </Surface>
  );
};

const ReplyModal = ({
  request,
  summary,
  onDismiss,
}: {
  request?: FamilyRequest;
  summary: SolidaritySummary;
  onDismiss: () => void;
}) => (
  <AppModal visible={request !== undefined} onDismiss={onDismiss}>
    {request && <ReplyForm request={request} summary={summary} onDone={onDismiss} />}
  </AppModal>
);

const ReplyForm = ({
  request,
  summary,
  onDone,
}: {
  request: FamilyRequest;
  summary: SolidaritySummary;
  onDone: () => void;
}) => {
  const theme = useTheme();
  const accounts = useFinanceStore(s => s.accounts);
  const userName = useFinanceStore(s => s.userName);
  const decide = useFinanceStore(s => s.decideFamilyRequest);
  const advice = suggestedGift(request, summary);
  const [kind, setKind] = useState<ReplyKind>(advice >= request.amount ? 'GIVEN' : advice > 0 ? 'PARTIAL' : 'LATER');
  const [amount, setAmount] = useState(String(Math.round(advice > 0 ? advice : request.amount)));
  const [source, setSource] = useState<string>('MOMO_SMS');
  const giving = kind === 'GIVEN' || kind === 'PARTIAL';
  const given = kind === 'GIVEN' ? request.amount : parseInputAmount(amount);
  const [message, setMessage] = useState<string>();
  const draft = buildFamilyReply(kind, request, { given, senderName: userName || undefined });
  const text = message ?? draft;

  const confirm = async (send?: 'whatsapp' | 'sms') => {
    await decide(request.id, kind, giving ? given : 0, giving && source !== 'MOMO_SMS' ? source : undefined);
    if (send && request.phone) {
      const sms = buildSmsUrl(request.phone, text);
      await openUrl(send === 'whatsapp' ? buildWhatsAppUrl(request.phone, text) : sms, sms);
    }
    onDone();
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      <Text variant="titleLarge" style={styles.bold}>
        Répondre à {request.contactName}
      </Text>
      <Text variant="bodyMedium" style={styles.muted}>
        Demande : {formatFCFA(request.amount)}
        {request.reason ? ` · ${request.reason}` : ''}
      </Text>
      {summary.level !== 'NO_BUDGET' && (
        <Surface style={[styles.advice, { backgroundColor: theme.colors.secondaryContainer }]} elevation={0}>
          <Text variant="labelMedium" style={{ color: theme.colors.onSecondaryContainer }} testID="family-advice">
            {advice >= request.amount
              ? `✅ Ton budget solidarité le permet (il reste ${formatFCFA(summary.remaining)}).`
              : advice > 0
              ? `⚖️ Il reste ${formatFCFA(summary.remaining)} : tu peux donner une partie sans dépasser.`
              : '⏳ Budget solidarité épuisé ce mois-ci : mieux vaut reporter.'}
          </Text>
        </Surface>
      )}
      <SegmentedButtons
        value={kind}
        onValueChange={v => {
          setKind(v as ReplyKind);
          setMessage(undefined);
        }}
        density="small"
        buttons={[
          { value: 'GIVEN', label: 'Tout', testID: 'reply-GIVEN' },
          { value: 'PARTIAL', label: 'Partie', testID: 'reply-PARTIAL' },
          { value: 'LATER', label: 'Plus tard', testID: 'reply-LATER' },
          { value: 'DECLINED', label: 'Non', testID: 'reply-DECLINED' },
        ]}
        style={styles.block}
      />
      {kind === 'PARTIAL' && (
        <AmountInput
          label="Montant donné"
          value={amount}
          onChangeText={v => {
            setAmount(v);
            setMessage(undefined);
          }}
          testID="reply-amount"
        />
      )}
      {giving && (
        <>
          <Text variant="labelLarge">Comment l'argent part</Text>
          <View style={styles.chips}>
            <Chip
              icon="message-processing-outline"
              selected={source === 'MOMO_SMS'}
              onPress={() => setSource('MOMO_SMS')}
              testID="source-MOMO_SMS">
              Envoi MoMo (SMS)
            </Chip>
            {accounts.map(a => (
              <Chip
                key={a.id}
                icon={a.id === CASH_ACCOUNT_ID ? 'wallet' : 'cellphone-nfc'}
                selected={source === a.id}
                onPress={() => setSource(a.id)}
                testID={`source-${a.id}`}>
                {a.id === CASH_ACCOUNT_ID ? 'Espèces' : a.name}
              </Chip>
            ))}
          </View>
          <Text variant="labelSmall" style={styles.muted}>
            {source === 'MOMO_SMS'
              ? 'L’envoi détecté par SMS (même montant, 3 derniers jours) est classé « Famille ».'
              : 'Une dépense « Famille & Solidarité » est créée sur ce compte.'}
          </Text>
        </>
      )}
      <Field
        mode="outlined"
        label="Message"
        multiline
        numberOfLines={4}
        value={text}
        onChangeText={setMessage}
        style={styles.block}
        testID="reply-message"
      />
      <View style={styles.replyActions}>
        {request.phone ? (
          <>
            <Button mode="contained" icon="whatsapp" onPress={() => confirm('whatsapp')} testID="reply-whatsapp">
              WhatsApp
            </Button>
            <Button mode="outlined" icon="message-text-outline" onPress={() => confirm('sms')}>
              SMS
            </Button>
          </>
        ) : null}
        <Button onPress={() => confirm()} disabled={giving && given <= 0} testID="reply-save">
          Enregistrer
        </Button>
      </View>
    </ScrollView>
  );
};

export const AddFamilyRequestModal = ({ visible, onDismiss }: { visible: boolean; onDismiss: () => void }) => {
  const save = useFinanceStore(s => s.saveFamilyRequest);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  return (
    <AppModal visible={visible} onDismiss={onDismiss}>
      <ScrollView keyboardShouldPersistTaps="handled">
        <Text variant="titleLarge" style={styles.bold}>
          Nouvelle demande d'un proche
        </Text>
        <Field
          mode="outlined"
          label="Qui demande ? (ex: Tonton Issa)"
          value={name}
          onChangeText={setName}
          style={styles.block}
        />
        <Field
          mode="outlined"
          label="Téléphone (WhatsApp)"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          style={styles.block}
        />
        <AmountInput label="Montant demandé" value={amount} onChangeText={setAmount} testID="family-amount" />
        <View style={styles.chips}>
          {REASONS.map(r => (
            <Chip key={r} compact selected={reason === r} onPress={() => setReason(reason === r ? '' : r)}>
              {r}
            </Chip>
          ))}
        </View>
        <Field mode="outlined" label="Motif" value={reason} onChangeText={setReason} style={styles.block} />
        <Button
          mode="contained"
          disabled={!name.trim() || parseInputAmount(amount) <= 0}
          onPress={async () => {
            await save({
              contactName: name.trim(),
              phone: phone.trim() || undefined,
              amount: parseInputAmount(amount),
              reason: reason.trim() || undefined,
            });
            setName('');
            setPhone('');
            setAmount('');
            setReason('');
            onDismiss();
          }}
          testID="family-save">
          Ajouter
        </Button>
      </ScrollView>
    </AppModal>
  );
};

/** Onglet « Famille » du Carnet : budget solidarité + demandes à traiter. */
export const FamilySection = () => {
  const requests = useFinanceStore(s => s.familyRequests);
  const budget = useFinanceStore(s => s.solidarityBudget);
  const transactions = useFinanceStore(s => s.transactions);
  const now = useFinanceStore(s => s.now);
  const [answering, setAnswering] = useState<FamilyRequest>();
  const summary = useMemo(() => {
    const month = monthKey(now);
    return summarizeSolidarity(
      requests,
      transactions.filter(t => t.occurredAt.startsWith(month)),
      budget,
    );
  }, [requests, transactions, budget, now]);
  const sorted = useMemo(() => sortRequests(requests), [requests]);

  return (
    <>
      <FlatList
        data={sorted}
        keyExtractor={r => r.id}
        ListHeaderComponent={<SolidarityHeader summary={summary} />}
        renderItem={({ item }) => <RequestCard request={item} onAnswer={setAnswering} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Avatar.Icon icon="hand-heart-outline" size={56} />
            <Text variant="bodyMedium" style={styles.emptyText}>
              Note ici les demandes de la famille : tu décides selon ton budget solidarité et réponds poliment en un
              tap.
            </Text>
          </View>
        }
        contentContainerStyle={styles.list}
      />
      <ReplyModal request={answering} summary={summary} onDismiss={() => setAnswering(undefined)} />
    </>
  );
};

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 96 },
  header: { padding: 16, borderRadius: 20, marginBottom: 14 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flex: { flex: 1 },
  big: { fontWeight: '800', marginTop: 2 },
  muted: { opacity: 0.7 },
  bold: { fontWeight: '800' },
  bar: { height: 10, borderRadius: 5, marginVertical: 8 },
  pendingChip: { alignSelf: 'flex-start', marginTop: 10 },
  card: { padding: 12, borderRadius: 18, marginBottom: 10 },
  closed: { opacity: 0.7 },
  cardBody: { flex: 1 },
  cardEnd: { alignItems: 'flex-end' },
  chipText: { fontSize: 11 },
  statusChip: { marginTop: 4, backgroundColor: 'transparent' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginTop: 4 },
  advice: { padding: 10, borderRadius: 12, marginTop: 10 },
  block: { marginVertical: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 6 },
  replyActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' },
  empty: { alignItems: 'center', margin: 24, gap: 12 },
  emptyText: { textAlign: 'center', opacity: 0.7 },
});
