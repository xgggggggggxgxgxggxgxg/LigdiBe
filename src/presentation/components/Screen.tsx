import React from 'react';
import { StyleSheet } from 'react-native';
import { Modal, Portal, useTheme } from 'react-native-paper';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

/** Conteneur d'écran dont le fond suit le thème (clair / sombre). */
export const Screen = ({ children, edges = ['top'] }: { children: React.ReactNode; edges?: Edge[] }) => {
  const theme = useTheme();
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.colors.background }]} edges={edges}>
      {children}
    </SafeAreaView>
  );
};

/** Fenêtre modale aux couleurs du thème. */
export const AppModal = ({
  visible,
  onDismiss,
  children,
}: {
  visible: boolean;
  onDismiss: () => void;
  children: React.ReactNode;
}) => {
  const theme = useTheme();
  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={onDismiss}
        contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.elevation.level3 }]}>
        {children}
      </Modal>
    </Portal>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1 },
  modal: { margin: 16, padding: 20, borderRadius: 20, maxHeight: '90%' },
});
