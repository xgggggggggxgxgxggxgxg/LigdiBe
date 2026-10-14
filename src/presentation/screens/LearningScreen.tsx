import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Appbar,
  Avatar,
  Button,
  Card,
  Chip,
  Icon,
  List,
  ProgressBar,
  Surface,
  Text,
  useTheme,
} from 'react-native-paper';
import { CATEGORIES } from '../../core/categories';
import { formatFCFA } from '../../core/currency';
import { providerFromSender } from '../../data/parser/securityFilters';
import {
  HIGH_CONFIDENCE,
  proposeFor,
  summarizeSession,
  type Decision,
  type IgnoreReason,
  type LearningItem,
  type Proposal,
  type ProposalType,
} from '../../domain/usecases/LearningQueue';
import { AmountInput, parseInputAmount } from '../components/AmountInput';
import { CategoryPicker } from '../components/CategoryPicker';
import { Field } from '../components/Field';
import { useFinanceStore } from '../store/useFinanceStore';
import { useLearningStore } from '../store/useLearningStore';
import { palette, providerColor, providerIcon } from '../theme/theme';

const TYPE_LABELS: Record<ProposalType, string> = {
  EXPENSE: 'Dépense',
  INCOME: 'Entrée',
  CASH_WITHDRAWAL: 'Retrait (→ Poche)',
  AGENT_DEPOSIT: 'Dépôt (Poche →)',
  AIRTIME_RECHARGE: 'Crédit / forfait',
  DATA_FROM_CREDIT: 'Forfait payé en crédit',
};
const EDITABLE_TYPES: ProposalType[] = ['EXPENSE', 'INCOME', 'CASH_WITHDRAWAL', 'AGENT_DEPOSIT', 'AIRTIME_RECHARGE'];

const IGNORE_REASONS: ReadonlyArray<{ value: IgnoreReason; label: string; icon: string }> = [
  { value: 'SPAM', label: 'Pub / spam', icon: 'bullhorn-outline' },
  { value: 'OTP', label: 'Code de sécurité', icon: 'shield-key-outline' },
  { value: 'DUPLICATE', label: 'Doublon', icon: 'content-duplicate' },
  { value: 'OTHER', label: 'Autre', icon: 'dots-horizontal' },
];
export const IGNORE_LABELS: Record<IgnoreReason, string> = {
  SPAM: 'pub / spam',
  OTP: 'code de sécurité',
  DUPLICATE: 'doublon',
  OTHER: 'autre',
};

const formatDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} ${iso.slice(11, 16)}`;

const ConfidenceHint = ({ proposal }: { proposal: Proposal }) => {
  const theme = useTheme();
  const { icon, text, color } =
    proposal.source === 'LEARNED'
      ? {
          icon: 'brain',
          text: `Deviné d'après tes ${proposal.learnedVotes} choix précédents`,
          color: theme.colors.primary,
        }
      : proposal.source === 'UNRECOGNIZED'
      ? { icon: 'help-circle-outline', text: 'Format inconnu : vérifie le montant et le type', color: palette.orange }
      : proposal.confidence >= HIGH_CONFIDENCE
      ? { icon: 'check-decagram-outline', text: 'Reconnu automatiquement', color: palette.green }
      : { icon: 'progress-question', text: 'Proposition à vérifier', color: palette.orange };
  return (
    <View style={styles.hint} testID="proposal-hint" accessibilityLabel={text}>
      <Icon source={icon} size={16} color={color} />
      <Text variant="labelMedium" style={{ color }}>
        {text}
      </Text>
      <View style={styles.flex} />
      <ProgressBar progress={proposal.confidence} color={color} style={styles.confidenceBar} />
    </View>
  );
};

const SmsCard = ({ item, proposal }: { item: LearningItem; proposal: Proposal }) => {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const provider = providerFromSender(item.sender) ?? 'BANK';
  return (
    <Card style={styles.card} testID={`learning-item-${item.id}`}>
      <Card.Title
        title={item.sender}
        subtitle={formatDate(item.receivedAt)}
        left={props => (
          <Avatar.Icon
            {...props}
            icon={providerIcon(provider)}
            color="#fff"
            style={{ backgroundColor: providerColor(provider) }}
          />
        )}
        right={() => (
          <Text
            variant="titleLarge"
            style={[styles.amount, { color: proposal.type === 'INCOME' ? palette.green : theme.colors.onSurface }]}
            testID="learning-amount">
            {proposal.amount > 0 ? formatFCFA(proposal.amount) : '— FCFA'}
          </Text>
        )}
      />
      <Card.Content>
        <Text
          variant="bodySmall"
          numberOfLines={expanded ? undefined : 4}
          onPress={() => setExpanded(e => !e)}
          style={[styles.sms, { backgroundColor: theme.colors.surfaceVariant }]}
          accessibilityHint="Touche pour afficher tout le SMS"
          selectable>
          {item.body}
        </Text>
        <View style={styles.chips}>
          <Chip icon="swap-vertical" compact testID="proposal-type">
            {TYPE_LABELS[proposal.type]}
          </Chip>
          <Chip icon="tag-outline" compact testID="proposal-category">
            {proposal.category}
          </Chip>
          {proposal.counterpartyName ? (
            <Chip icon="account-outline" compact>
              {proposal.counterpartyName}
            </Chip>
          ) : null}
        </View>
        <ConfidenceHint proposal={proposal} />
      </Card.Content>
    </Card>
  );
};

const CorrectionPanel = ({
  proposal,
  onSubmit,
  onCancel,
}: {
  proposal: Proposal;
  onSubmit: (d: Decision) => void;
  onCancel?: () => void;
}) => {
  const accounts = useFinanceStore(s => s.accounts);
  const [type, setType] = useState<ProposalType>(proposal.type);
  const [amount, setAmount] = useState(proposal.amount > 0 ? String(Math.round(proposal.amount)) : '');
  const [category, setCategory] = useState(proposal.category);
  const [accountId, setAccountId] = useState(proposal.accountId);
  const [label, setLabel] = useState(proposal.counterpartyName ?? '');
  const value = parseInputAmount(amount);
  return (
    <Surface style={styles.panel} elevation={1} testID="correction-panel">
      <Text variant="labelLarge">Type</Text>
      <View style={styles.chips}>
        {EDITABLE_TYPES.map(t => (
          <Chip
            key={t}
            selected={t === type}
            onPress={() => setType(t)}
            compact
            testID={`type-${t}`}
            accessibilityLabel={`Type ${TYPE_LABELS[t]}`}>
            {TYPE_LABELS[t]}
          </Chip>
        ))}
      </View>
      <AmountInput label="Montant" value={amount} onChangeText={setAmount} testID="correction-amount" />
      <Text variant="labelLarge">Catégorie</Text>
      <CategoryPicker value={category} onChange={setCategory} allowCreate />
      <Text variant="labelLarge">Compte</Text>
      <CategoryPicker
        value={accounts.find(a => a.id === accountId)?.name ?? ''}
        onChange={name => setAccountId(accounts.find(a => a.name === name)?.id ?? accountId)}
        categories={accounts.map(a => a.name)}
      />
      <Field
        mode="outlined"
        dense
        label="Libellé (facultatif)"
        value={label}
        onChangeText={setLabel}
        style={styles.input}
      />
      <View style={styles.panelActions}>
        {onCancel && <Button onPress={onCancel}>Annuler</Button>}
        <Button
          mode="contained"
          icon="check"
          disabled={value <= 0}
          onPress={() =>
            onSubmit({
              action: 'CORRECT',
              type,
              amount: value,
              category: type === 'INCOME' && category === CATEGORIES.OTHER ? CATEGORIES.INCOME : category,
              accountId,
              counterpartyName: label.trim() || undefined,
            })
          }
          testID="correction-save"
          accessibilityLabel="Valider la correction">
          Valider la correction
        </Button>
      </View>
    </Surface>
  );
};

export const LearningScreen = ({ navigation }: { navigation?: { goBack: () => void } }) => {
  const theme = useTheme();
  const status = useLearningStore(s => s.status);
  const session = useLearningStore(s => s.session);
  const learned = useLearningStore(s => s.learned);
  const context = useLearningStore(s => s.context);
  const loading = useLearningStore(s => s.loading);
  const history = useLearningStore(s => s.history);
  const lastReport = useLearningStore(s => s.lastReport);
  const error = useLearningStore(s => s.error);
  const { restore, start, decide, undo, reopen, discard, commit } = useLearningStore.getState();
  const [mode, setMode] = useState<'PROPOSAL' | 'CORRECT' | 'IGNORE'>('PROPOSAL');
  const [reviewIgnored, setReviewIgnored] = useState(false);
  const [committing, setCommitting] = useState(false);

  useEffect(() => {
    if (useLearningStore.getState().status === 'IDLE' && !useLearningStore.getState().session) {
      restore();
    }
  }, [restore]);

  const item = session && status === 'ACTIVE' ? session.items[session.index] : undefined;
  const proposal = useMemo(() => (item ? proposeFor(item, learned, context) : undefined), [item, learned, context]);
  const summary = session ? summarizeSession(session) : undefined;

  useEffect(() => {
    // Format inconnu : la saisie pré-remplie s'ouvre directement.
    setMode(proposal?.source === 'UNRECOGNIZED' ? 'CORRECT' : 'PROPOSAL');
  }, [item?.id, proposal?.source]);

  const leave = () => navigation?.goBack();

  const confirm = () =>
    proposal &&
    decide({
      action: 'CONFIRM',
      type: proposal.type,
      category: proposal.category,
      accountId: proposal.accountId,
      amount: proposal.amount,
      counterpartyName: proposal.counterpartyName,
    });

  const validate = async () => {
    setCommitting(true);
    try {
      await commit();
    } finally {
      setCommitting(false);
    }
  };

  const done = summary ? summary.total - summary.remaining : 0;

  return (
    <View style={[styles.flex, { backgroundColor: theme.colors.background }]}>
      <Appbar.Header mode="small" elevated={false} style={{ backgroundColor: theme.colors.background }}>
        {navigation && (
          <Appbar.BackAction onPress={leave} accessibilityLabel="Terminer plus tard" testID="learning-back" />
        )}
        <Appbar.Content title="Apprentissage guidé" />
        {status === 'ACTIVE' && history.length > 0 && (
          <Appbar.Action
            icon="undo"
            onPress={undo}
            accessibilityLabel="Annuler le dernier choix"
            testID="learning-undo"
          />
        )}
      </Appbar.Header>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {error && (
          <Surface style={[styles.banner, { backgroundColor: theme.colors.errorContainer }]} elevation={0}>
            <Text>{error}</Text>
          </Surface>
        )}

        {status === 'IDLE' && !lastReport && (
          <Surface
            style={[styles.hero, { backgroundColor: theme.colors.primary }]}
            elevation={2}
            testID="learning-intro">
            <Icon source="school-outline" size={36} color={theme.colors.onPrimary} />
            <Text variant="titleLarge" style={[styles.bold, { color: theme.colors.onPrimary }]}>
              Apprends-moi tes habitudes
            </Text>
            <Text variant="bodyMedium" style={[styles.heroText, { color: theme.colors.onPrimary }]}>
              Je lis tes anciens SMS Mobile Money et tu confirmes chaque opération en un tap. Chaque correction m'aide à
              mieux deviner les suivantes. Les codes de sécurité sont écartés d'office, rien ne quitte ton téléphone.
            </Text>
            <Button
              mode="contained-tonal"
              icon="message-text-clock-outline"
              onPress={() => start()}
              style={styles.heroButton}
              testID="learning-start"
              accessibilityLabel="Analyser mes SMS">
              Analyser mes SMS
            </Button>
          </Surface>
        )}

        {status === 'LOADING' && (
          <Card style={styles.card} testID="learning-loading">
            <Card.Content style={styles.center}>
              <ActivityIndicator />
              <Text variant="bodyMedium" style={styles.top}>
                Analyse de {loading.total} SMS… {loading.done}/{loading.total}
              </Text>
              <ProgressBar progress={loading.total ? loading.done / loading.total : 0} style={styles.fullBar} />
            </Card.Content>
          </Card>
        )}

        {status === 'ACTIVE' && session && item && proposal && summary && (
          <>
            <View
              style={styles.progressRow}
              testID="learning-progress"
              accessibilityLabel={`${done} sur ${summary.total} traités`}>
              <Text variant="labelLarge">
                {done + 1} / {summary.total}
              </Text>
              <Text variant="labelSmall" style={styles.muted}>
                {summary.recorded} à enregistrer · {summary.ignored} ignoré(s)
              </Text>
            </View>
            <ProgressBar progress={summary.total ? done / summary.total : 0} style={styles.fullBar} />

            <SmsCard item={item} proposal={proposal} />

            {mode === 'PROPOSAL' && (
              <View style={styles.actions}>
                <Button
                  mode="contained"
                  icon="check-bold"
                  onPress={confirm}
                  disabled={proposal.amount <= 0}
                  style={styles.mainAction}
                  contentStyle={styles.mainActionContent}
                  testID="learning-confirm"
                  accessibilityLabel={`Confirmer : ${TYPE_LABELS[proposal.type]}, ${proposal.category}, ${formatFCFA(
                    proposal.amount,
                  )}`}>
                  Confirmer
                </Button>
                <View style={styles.row}>
                  <Button
                    mode="outlined"
                    icon="pencil-outline"
                    style={styles.flex}
                    onPress={() => setMode('CORRECT')}
                    testID="learning-correct"
                    accessibilityLabel="Corriger la proposition">
                    Corriger
                  </Button>
                  <Button
                    mode="outlined"
                    icon="eye-off-outline"
                    style={styles.flex}
                    onPress={() => setMode('IGNORE')}
                    testID="learning-ignore"
                    accessibilityLabel="Ignorer ce SMS">
                    Ignorer
                  </Button>
                </View>
              </View>
            )}

            {mode === 'CORRECT' && (
              <CorrectionPanel
                key={item.id}
                proposal={proposal}
                onSubmit={decide}
                onCancel={proposal.source === 'UNRECOGNIZED' ? undefined : () => setMode('PROPOSAL')}
              />
            )}
            {mode === 'CORRECT' && proposal.source === 'UNRECOGNIZED' && (
              <Button icon="eye-off-outline" onPress={() => setMode('IGNORE')} testID="learning-ignore-unrecognized">
                Ignorer ce SMS
              </Button>
            )}

            {mode === 'IGNORE' && (
              <Surface style={styles.panel} elevation={1} testID="ignore-panel">
                <Text variant="labelLarge">Pourquoi l'ignorer ?</Text>
                <View style={styles.chips}>
                  {IGNORE_REASONS.map(r => (
                    <Chip
                      key={r.value}
                      icon={r.icon}
                      onPress={() => decide({ action: 'IGNORE', reason: r.value })}
                      testID={`ignore-${r.value}`}
                      accessibilityLabel={`Ignorer : ${r.label}`}>
                      {r.label}
                    </Chip>
                  ))}
                </View>
                <Button onPress={() => setMode(proposal.source === 'UNRECOGNIZED' ? 'CORRECT' : 'PROPOSAL')}>
                  Retour
                </Button>
              </Surface>
            )}

            <View style={styles.footer}>
              <Button
                icon="pause"
                onPress={leave}
                testID="learning-later"
                accessibilityLabel="Terminer plus tard, reprise au même SMS">
                Terminer plus tard
              </Button>
              {summary.recorded + summary.ignored > 0 && (
                <Button
                  icon="content-save-check-outline"
                  onPress={validate}
                  loading={committing}
                  testID="learning-validate-now">
                  Valider maintenant
                </Button>
              )}
            </View>
          </>
        )}

        {status === 'DONE' && session && summary && session.items.length > 0 && (
          <Card style={styles.card} testID="learning-summary">
            <Card.Title
              title="Tout est classé 🎉"
              subtitle="Valide pour enregistrer tes choix (rien n'est encore écrit)"
              left={props => <Avatar.Icon {...props} icon="flag-checkered" />}
            />
            <Card.Content>
              <SummaryRows
                recorded={summary.recorded}
                ignored={summary.ignoredByReason}
                remaining={summary.remaining}
                recordedLabel="à enregistrer"
              />
              {reviewIgnored &&
                session.items
                  .filter(i => session.decisions[i.id]?.action === 'IGNORE')
                  .map(i => (
                    <List.Item
                      key={i.id}
                      title={i.sender}
                      description={i.body}
                      descriptionNumberOfLines={2}
                      left={p => <List.Icon {...p} icon="eye-off-outline" />}
                      onPress={() => reopen(i.id)}
                      testID={`ignored-${i.id}`}
                      accessibilityLabel={`Reclasser le SMS de ${i.sender}`}
                    />
                  ))}
            </Card.Content>
            <Card.Actions style={styles.wrap}>
              {summary.ignored > 0 && (
                <Button icon="eye-outline" onPress={() => setReviewIgnored(r => !r)} testID="review-ignored">
                  Revoir les ignorés
                </Button>
              )}
              <Button icon="close" onPress={discard} accessibilityLabel="Abandonner sans rien enregistrer">
                Abandonner
              </Button>
              <Button
                mode="contained"
                icon="content-save-check-outline"
                onPress={validate}
                loading={committing}
                testID="learning-commit">
                Valider
              </Button>
            </Card.Actions>
          </Card>
        )}

        {status === 'DONE' && session && session.items.length === 0 && (
          <Text style={styles.center} testID="learning-empty">
            Aucun nouveau SMS financier à classer.
          </Text>
        )}

        {status === 'IDLE' && lastReport && (
          <Card style={styles.card} testID="learning-report">
            <Card.Title
              title="Enregistré ✅"
              left={props => <Avatar.Icon {...props} icon="check" style={{ backgroundColor: palette.green }} />}
            />
            <Card.Content>
              <Text variant="bodyMedium" testID="learning-report-text">
                {lastReport.recorded} enregistré(s) · {lastReport.ignored} ignoré(s) · {lastReport.remaining} restant(s)
                {lastReport.skippedDuplicates > 0 ? ` · ${lastReport.skippedDuplicates} doublon(s) évité(s)` : ''}
              </Text>
            </Card.Content>
            <Card.Actions>
              {lastReport.remaining > 0 && (
                <Button onPress={restore} testID="learning-continue">
                  Continuer ({lastReport.remaining})
                </Button>
              )}
              <Button mode="contained" onPress={leave} testID="learning-close">
                Fermer
              </Button>
            </Card.Actions>
          </Card>
        )}
      </ScrollView>
    </View>
  );
};

const SummaryRows = ({
  recorded,
  ignored,
  remaining,
  recordedLabel,
}: {
  recorded: number;
  ignored: Record<IgnoreReason, number>;
  remaining: number;
  recordedLabel: string;
}) => {
  const ignoredTotal = Object.values(ignored).reduce((s, n) => s + n, 0);
  const reasons = (Object.keys(ignored) as IgnoreReason[])
    .filter(r => ignored[r] > 0)
    .map(r => `${ignored[r]} ${IGNORE_LABELS[r]}`);
  return (
    <View testID="learning-summary-rows">
      <Text variant="bodyLarge">
        ✅ {recorded} {recordedLabel}
      </Text>
      <Text variant="bodyLarge">
        🙈 {ignoredTotal} ignoré(s){reasons.length ? ` (${reasons.join(', ')})` : ''}
      </Text>
      <Text variant="bodyLarge">⏳ {remaining} restant(s)</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, paddingBottom: 48 },
  bold: { fontWeight: '800', marginTop: 8 },
  muted: { opacity: 0.7 },
  center: { alignItems: 'center', textAlign: 'center' },
  top: { marginTop: 10 },
  hero: { borderRadius: 24, padding: 20 },
  heroText: { opacity: 0.9, marginTop: 8 },
  heroButton: { marginTop: 16, alignSelf: 'flex-start' },
  banner: { padding: 12, borderRadius: 12, marginBottom: 10 },
  card: { marginTop: 12 },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fullBar: { height: 8, borderRadius: 4, marginTop: 8, width: '100%' },
  amount: { fontWeight: '800', marginRight: 16 },
  sms: { padding: 10, borderRadius: 12, marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 6 },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  confidenceBar: { width: 60, height: 6, borderRadius: 3 },
  actions: { marginTop: 14, gap: 10 },
  mainAction: { borderRadius: 16 },
  mainActionContent: { height: 52 },
  row: { flexDirection: 'row', gap: 10 },
  panel: { marginTop: 14, padding: 14, borderRadius: 18 },
  panelActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 8 },
  input: { marginVertical: 6 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 },
  wrap: { flexWrap: 'wrap' },
});
