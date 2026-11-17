import { Theme } from '@/src/theme/theme';
import { useTheme } from '@shopify/restyle';
import PopupHeader from '@/src/components/multisig/PopupHeader';
import Box from '@/src/components/shared/Box';
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Keyboard,
  Modal,
  StyleSheet,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import InviteEmailView from './InviteEmailView';
import MethodOptionCard from './MethodOptionCard';
import PasteAddressView from './PasteAddressView';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

type SheetView = 'method' | 'paste-address' | 'invite-email';

interface Props {
  visible: boolean;
  onClose: () => void;
  onScanQR: () => void;
  onMemberAdded: (name: string, value: string, status: 'pending' | 'added') => void;
}

const ChooseMethodSheet: React.FC<Props> = ({ visible, onClose, onScanQR, onMemberAdded }) => {
  const theme = useTheme<Theme>();
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const [view, setView] = useState<SheetView>('method');

  useEffect(() => {
    if (visible) {
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        damping: 20,
        stiffness: 90,
      }).start();
    } else {
      Animated.timing(translateY, {
        toValue: SCREEN_HEIGHT,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, translateY]);

  useEffect(() => {
    if (!visible) {
      const timeout = setTimeout(() => setView('method'), 300);
      return () => clearTimeout(timeout);
    }
  }, [visible]);

  const handleClose = () => {
    Keyboard.dismiss();
    Animated.timing(translateY, {
      toValue: SCREEN_HEIGHT,
      duration: 250,
      useNativeDriver: true,
    }).start(() => onClose());
  };

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={handleClose}>
      {/* Dim overlay — pointer-events none so touches fall through to the flex layer */}
      <View style={[styles.backdrop, { backgroundColor: theme.colors.backdrop }]} pointerEvents="none" />

      {/* Flex column: backdrop spacer (flex:1) + sheet at bottom */}
      <View style={styles.flex}>
        {/* Tappable spacer above the sheet — closes the sheet */}
        <TouchableWithoutFeedback onPress={handleClose}>
          <View style={styles.flex} />
        </TouchableWithoutFeedback>

        {/* Sheet — no absolute positioning; sits at the natural bottom of the column */}
        <Animated.View
          style={[
            styles.sheet,
            { backgroundColor: theme.colors.surfaceBase },
            {
              paddingBottom: Math.max(insets.bottom, 24),
              transform: [{ translateY }],
            },
          ]}
        >
          {view === 'method' && (
            <>
              <PopupHeader title="Add Owner" onClose={handleClose} />

              <Box gap="sm" style={styles.methods}>
                <MethodOptionCard
                  icon="enter-outline"
                  title="Paste Address"
                  subtitle="Add by wallet address"
                  onPress={() => setView('paste-address')}
                />
                <MethodOptionCard
                  icon="qr-code-outline"
                  title="Scan QR Code"
                  subtitle="Scan member's QR code"
                  image={require('@/src/assets/icon/qr-code.png')}
                  onPress={onScanQR}
                />
                {/* Email invites require an async accept/deploy flow that isn't
                    shipped yet — disabled so a pending invitee can't silently
                    block deploy. Add members by address for now. */}
                <MethodOptionCard
                  icon="mail-outline"
                  title="Invite via Email"
                  // subtitle="Send an invitation"
                  // onPress={() => setView('invite-email')}
                  subtitle="Coming soon — add by address for now"
                  onPress={() => {}}
                  disabled
                  badge="Soon"
                  image={require('@/src/assets/icon/email.png')}
                />
              </Box>
            </>
          )}

          {view === 'paste-address' && (
            <PasteAddressView
              onClose={handleClose}
              onAdd={(name, address) => {
                handleClose();
                onMemberAdded(name, address, 'added');
              }}
            />
          )}

          {view === 'invite-email' && (
            <InviteEmailView
              onClose={handleClose}
              onAdd={(name, email) => {
                handleClose();
                onMemberAdded(name, email, 'pending');
              }}
            />
          )}
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  sheet: {
    width: '100%',
    borderTopLeftRadius: 40,
    borderTopRightRadius: 40,
    paddingHorizontal: 24,
  },
  methods: {
    marginTop: 32,
  },
});

export default ChooseMethodSheet;
