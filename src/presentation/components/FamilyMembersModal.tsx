import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { Avatar, Button, Checkbox, Icon, IconButton, List, Searchbar, Text, useTheme } from 'react-native-paper';
import type { FamilyMember } from '../../domain/models/FamilyMember';
import { familyPhoneTails, isFamilyPhone } from '../../domain/usecases/FamilyMembers';
import { foldText } from '../../domain/usecases/SearchTransactions';
import { loadPhoneContacts, type PhoneContact } from '../../services/contacts/ContactsService';
import { useFinanceStore } from '../store/useFinanceStore';
import { palette } from '../theme/theme';
import { Field } from './Field';
import { AppModal } from './Screen';

export const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('');

const AVATAR_COLORS = [palette.green, palette.gold, palette.moov, palette.orange, palette.bank, palette.wave];
export const avatarColor = (name: string) =>
  AVATAR_COLORS[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % AVATAR_COLORS.length];

type Mode = 'MEMBERS' | 'CONTACTS';
type ContactsState =
  | { status: 'LOADING' }
  | { status: 'DENIED' | 'UNAVAILABLE' }
  | { status: 'OK'; contacts: PhoneContact[] };

interface Props {
  visible: boolean;
  onDismiss: () => void;
  /** Ouvre directement la liste des contacts. */
  startWithContacts?: boolean;
  onAdded?: (added: number, reclassified: number) => void;
}

/** « Ma famille » : proches importés des contacts ou saisis, dont les envois sont classés « Famille ». */
export const FamilyMembersModal = ({ visible, onDismiss, startWithContacts, onAdded }: Props) => (
  <AppModal visible={visible} onDismiss={onDismiss}>
    {visible && <MembersBody startWithContacts={startWithContacts} onAdded={onAdded} onClose={onDismiss} />}
  </AppModal>
);

const MembersBody = ({
  startWithContacts,
  onAdded,
  onClose,
}: {
  startWithContacts?: boolean;
  onAdded?: Props['onAdded'];
  onClose: () => void;
}) => {
  const theme = useTheme();
  const members = useFinanceStore(s => s.familyMembers);
  const addMembers = useFinanceStore(s => s.addFamilyMembers);
  const removeMember = useFinanceStore(s => s.removeFamilyMember);
  const [mode, setMode] = useState<Mode>(startWithContacts ? 'CONTACTS' : 'MEMBERS');
  const [loadCount, setLoadCount] = useState(0);
  const [contacts, setContacts] = useState<ContactsState>({ status: 'LOADING' });
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const tails = useMemo(() => familyPhoneTails(members), [members]);

  useEffect(() => {
    if (mode !== 'CONTACTS') {
      return;
    }
    let alive = true;
    setContacts({ status: 'LOADING' });
    loadPhoneContacts().then(r => alive && setContacts(r));
    return () => {
      alive = false;
    };
  }, [mode, loadCount]);

  const openContacts = () => {
    setMode('CONTACTS');
    setLoadCount(n => n + 1);
  };

  const filtered = useMemo(() => {
    if (contacts.status !== 'OK') {
      return [];
    }
    const q = foldText(query);
    const digits = query.replace(/\D/g, '');
    return contacts.contacts.filter(
      c => !q || foldText(c.name).includes(q) || (digits.length >= 2 && c.phone.replace(/\D/g, '').includes(digits)),
    );
  }, [contacts, query]);

  const save = async (toAdd: ReadonlyArray<Omit<FamilyMember, 'id'>>) => {
    setSaving(true);
    try {
      const reclassified = await addMembers(toAdd);
      onAdded?.(toAdd.length, reclassified);
      setSelected(new Set());
      setMode('MEMBERS');
    } finally {
      setSaving(false);
    }
  };

  if (mode === 'CONTACTS') {
    return (
      <View style={styles.body}>
        <View style={styles.rowCenter}>
          <IconButton icon="arrow-left" onPress={() => setMode('MEMBERS')} accessibilityLabel="Retour" />
          <Text variant="titleLarge" style={styles.title}>
            Mes contacts
          </Text>
        </View>
        {contacts.status === 'LOADING' && <ActivityIndicator style={styles.loader} />}
        {(contacts.status === 'DENIED' || contacts.status === 'UNAVAILABLE') && (
          <View style={styles.empty} testID="contacts-denied">
            <Avatar.Icon icon="account-lock-outline" size={56} />
            <Text variant="bodyMedium" style={styles.center}>
              {contacts.status === 'DENIED'
                ? 'Autorise l’accès aux contacts pour ajouter ta famille en un tap. Ils restent sur ton téléphone.'
                : 'Contacts indisponibles sur cet appareil : ajoute tes proches à la main.'}
            </Text>
            {contacts.status === 'DENIED' && (
              <Button mode="contained" icon="refresh" onPress={openContacts}>
                Réessayer
              </Button>
            )}
          </View>
        )}
        {contacts.status === 'OK' && (
          <>
            <Searchbar placeholder="Nom ou numéro" value={query} onChangeText={setQuery} testID="contacts-search" />
            <FlatList
              data={filtered}
              keyExtractor={c => c.id + c.phone}
              style={styles.list}
              keyboardShouldPersistTaps="handled"
              initialNumToRender={20}
              renderItem={({ item }) => {
                const already = isFamilyPhone(item.phone, tails);
                const checked = already || selected.has(item.phone);
                return (
                  <List.Item
                    testID={`contact-${item.phone}`}
                    title={item.name}
                    description={already ? `${item.phone} · déjà dans ta famille` : item.phone}
                    disabled={already}
                    onPress={() =>
                      setSelected(prev => {
                        const next = new Set(prev);
                        if (next.has(item.phone)) {
                          next.delete(item.phone);
                        } else {
                          next.add(item.phone);
                        }
                        return next;
                      })
                    }
                    left={() => (
                      <Avatar.Text
                        size={40}
                        label={initials(item.name)}
                        color="#fff"
                        style={{ backgroundColor: avatarColor(item.name) }}
                      />
                    )}
                    right={() => (
                      <View style={styles.rowCenter}>
                        {item.starred && <Icon source="star" size={16} color={palette.gold} />}
                        <Checkbox.Android status={checked ? 'checked' : 'unchecked'} disabled={already} />
                      </View>
                    )}
                  />
                );
              }}
              ListEmptyComponent={<Text style={styles.center}>Aucun contact trouvé.</Text>}
            />
            <Button
              mode="contained"
              icon="account-multiple-plus"
              disabled={selected.size === 0 || saving}
              loading={saving}
              onPress={() =>
                save(contacts.contacts.filter(c => selected.has(c.phone)).map(c => ({ name: c.name, phone: c.phone })))
              }
              testID="contacts-add">
              {selected.size > 0
                ? `Ajouter ${selected.size} proche${selected.size > 1 ? 's' : ''}`
                : 'Sélectionne tes proches'}
            </Button>
          </>
        )}
      </View>
    );
  }

  return (
    <View style={styles.body}>
      <Text variant="titleLarge" style={styles.title}>
        Ma famille
      </Text>
      <Text variant="bodySmall" style={styles.muted}>
        Tes envois MoMo vers ces numéros sont classés « Famille & Solidarité » automatiquement.
      </Text>
      <Button
        mode="contained"
        icon="card-account-phone-outline"
        onPress={openContacts}
        style={styles.block}
        testID="open-contacts">
        Importer depuis mes contacts
      </Button>
      <FlatList
        data={members}
        keyExtractor={m => m.id}
        style={styles.list}
        renderItem={({ item }) => (
          <List.Item
            testID={`member-${item.id}`}
            title={item.name}
            description={item.phone ?? 'Sans numéro'}
            left={() => (
              <Avatar.Text
                size={40}
                label={initials(item.name)}
                color="#fff"
                style={{ backgroundColor: avatarColor(item.name) }}
              />
            )}
            right={() => (
              <IconButton
                icon="account-remove-outline"
                onPress={() => removeMember(item.id)}
                accessibilityLabel={`Retirer ${item.name}`}
              />
            )}
          />
        )}
        ListEmptyComponent={
          <Text variant="bodySmall" style={[styles.center, styles.muted]}>
            Personne pour l’instant.
          </Text>
        }
      />
      <View style={[styles.manual, { borderColor: theme.colors.outlineVariant }]}>
        <Text variant="labelLarge">Ajouter à la main</Text>
        <Field mode="outlined" dense label="Nom" value={name} onChangeText={setName} style={styles.input} />
        <Field
          mode="outlined"
          dense
          label="Téléphone"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          style={styles.input}
        />
        <Button
          icon="plus"
          disabled={!name.trim() || saving}
          onPress={async () => {
            await save([{ name: name.trim(), phone: phone.trim() || undefined }]);
            setName('');
            setPhone('');
          }}
          testID="member-add-manual">
          Ajouter
        </Button>
      </View>
      <Button onPress={onClose}>Fermer</Button>
    </View>
  );
};

const styles = StyleSheet.create({
  body: { maxHeight: '100%' },
  title: { fontWeight: '800' },
  muted: { opacity: 0.7 },
  block: { marginVertical: 10 },
  rowCenter: { flexDirection: 'row', alignItems: 'center' },
  loader: { margin: 32 },
  empty: { alignItems: 'center', gap: 12, padding: 16 },
  center: { textAlign: 'center' },
  list: { maxHeight: 360, marginVertical: 8 },
  manual: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8, marginTop: 4 },
  input: { marginVertical: 4 },
});
