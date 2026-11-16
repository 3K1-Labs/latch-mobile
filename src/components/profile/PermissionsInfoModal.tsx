import React from 'react';
import { Modal, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import PopupHeader from '@/src/components/multisig/PopupHeader';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const SECTIONS = [
  {
    title: 'Temporary Keys',
    body: 'When you connect an app, Latch creates a temporary Session Key that can act on your behalf.',
  },
  {
    title: 'Strict Limits',
    body: 'These keys cannot transfer your full balance or change settings. They are strictly bound to limits you approve.',
  },
  {
    title: 'Auto-Expiration',
    body: 'You never have to remember to disconnect. Sessions expire automatically and revoke themselves.',
  },
];

const PermissionsInfoModal = ({ visible, onClose }: Props) => {
  const insets = useSafeAreaInsets();

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <Box style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 24) }]}>
        <PopupHeader title="How permissions work" onClose={onClose} />
        <Box
          backgroundColor="inputBox"
          borderColor="inputOutline"
          borderWidth={1}
          style={styles.card}
        >
          {SECTIONS.map((s, i) => (
            <Box key={s.title}>
              {i > 0 && <Box height={1} backgroundColor="inputOutline" style={styles.divider} />}
              <Box gap="xs">
                <Text fontSize={16} lineHeight={24} color="textPrimary">
                  {s.title}
                </Text>
                <Text fontSize={14} lineHeight={22} color="textMuted">
                  {s.body}
                </Text>
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(18,18,18,0.9)',
  },
  sheet: {
    backgroundColor: '#020202',
    borderTopLeftRadius: 40,
    borderTopRightRadius: 40,
    paddingHorizontal: 24,
  },
  card: {
    marginTop: 32,
    borderRadius: 16,
    padding: 18,
  },
  divider: {
    marginVertical: 18,
  },
});

export default PermissionsInfoModal;
