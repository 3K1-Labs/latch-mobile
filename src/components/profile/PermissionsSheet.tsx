import { Theme } from '@/src/theme/theme';
import { useTheme } from '@shopify/restyle';
import { Image } from 'expo-image';
import React, { useEffect, useState } from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { RoundBackButton } from '@/src/components/onboarding/SetupChrome';
import BottomSheet from '@/src/components/shared/BottomSheet';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { SessionKey, usePermissions } from '@/src/store/permissions';
import { useWalletStore } from '@/src/store/wallet';
import PermissionsInfoModal from './PermissionsInfoModal';
import SessionKeyForm from './SessionKeyForm';
import StepIndicator from './StepIndicator';
import SwipeablePermissionItem from './SwipeablePermissionItem';

const PLUS = require('@/src/assets/images/address-book/plus.svg');
const EMPTY = require('@/src/assets/images/empty.png');

interface Props {
  visible: boolean;
  onClose: () => void;
}

const PermissionsSheet = ({ visible, onClose }: Props) => {
  const theme = useTheme<Theme>();
  const { accounts, activeAccountIndex } = useWalletStore();
  const accountAddress = accounts[activeAccountIndex]?.smartAccountAddress ?? '';
  const { byAccount, rehydrate, addSessionKey, revokeSessionKey } = usePermissions();
  const sessionKeys = (byAccount[accountAddress]?.sessionKeys ?? []).filter(
    (k) => k.status === 'active',
  );

  const [isCreating, setIsCreating] = useState(false);
  const [formStep, setFormStep] = useState(1);
  const [showInfo, setShowInfo] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<SessionKey | null>(null);

  useEffect(() => {
    if (visible) {
      setIsCreating(false);
      setFormStep(1);
      setRevokeTarget(null);
      rehydrate();
    }
  }, [visible, rehydrate]);

  const handleBack = () => {
    if (revokeTarget) {
      setRevokeTarget(null);
    } else if (isCreating) {
      if (formStep > 1) {
        setFormStep(formStep - 1);
      } else {
        setIsCreating(false);
      }
    } else {
      onClose();
    }
  };

  const headerTitle = revokeTarget
    ? 'Revoke Session'
    : isCreating
      ? formStep === 1
        ? 'Create Session Key'
        : formStep === 2
          ? 'Set Limits'
          : 'Review & Confirm'
      : 'Permissions';

  const headerRight = isCreating ? (
    <StepIndicator currentStep={formStep} totalSteps={3} />
  ) : revokeTarget ? (
    <Box width={40} />
  ) : (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel="Create session key"
      activeOpacity={0.7}
      hitSlop={8}
      onPress={() => {
        setFormStep(1);
        setIsCreating(true);
      }}
      style={[styles.addButton, { backgroundColor: theme.colors.inputOutline }]}
    >
      <Image source={PLUS} contentFit="contain" tintColor={theme.colors.iconPrimary} style={styles.addIcon} />
    </TouchableOpacity>
  );

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      snapPoints={['92%']}
      keyboardBehavior="extend"
      android_keyboardInputMode="adjustResize"
      backgroundStyle={[styles.sheet, { backgroundColor: theme.colors.surfaceBase }]}
      handleIndicatorStyle={[styles.grabber, { backgroundColor: theme.colors.inputOutline }]}
      header={
        isCreating && formStep === 4 ? undefined : (
          <Box
            flexDirection="row"
            alignItems="center"
            justifyContent="space-between"
            style={styles.header}
          >
            <RoundBackButton onPress={handleBack} />
            <Text fontSize={18} lineHeight={26} fontFamily="SFproMedium" color="textPrimary">
              {headerTitle}
            </Text>
            {headerRight}
          </Box>
        )
      }
      contentContainerStyle={styles.fill}
    >
      {revokeTarget ? (
        <Box flex={1} alignItems="center" justifyContent="center" style={styles.gutter}>
          <Text
            fontSize={20}
            lineHeight={28}
            fontFamily="SFproSemibold"
            color="textPrimary"
            textAlign="center"
            mb="s"
          >
            Revoke Session Key
          </Text>
          <Text fontSize={16} lineHeight={24} color="textSubheading" textAlign="center" mb="xl">
            Revoking{' '}
            <Text fontSize={16} lineHeight={24} fontFamily="SFproMedium" color="textPrimary">
              {revokeTarget.name}
            </Text>{' '}
            immediately removes its access. This can&apos;t be undone.
          </Text>

          <Box flexDirection="row" gap="sm" width="100%">
            <TouchableOpacity
              accessibilityRole="button"
              activeOpacity={0.7}
              onPress={() => setRevokeTarget(null)}
              style={[
                styles.pill,
                styles.cancelPill,
                { backgroundColor: theme.colors.inputBox, borderColor: theme.colors.inputOutline },
              ]}
            >
              <Text fontSize={16} lineHeight={24} fontFamily="SFproMedium" color="textPrimary">
                Cancel
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              activeOpacity={0.7}
              onPress={() => {
                revokeSessionKey(accountAddress, revokeTarget.id);
                setRevokeTarget(null);
              }}
              style={[styles.pill, styles.revokePill]}
            >
              <Text fontSize={16} lineHeight={24} fontFamily="SFproMedium" color="white">
                Revoke
              </Text>
            </TouchableOpacity>
          </Box>
        </Box>
      ) : isCreating ? (
        <SessionKeyForm
          currentStep={formStep}
          setStep={setFormStep}
          onBack={handleBack}
          onComplete={(values) => {
            addSessionKey(accountAddress, {
              name: values.name,
              durationLabel: values.duration,
              spendingLimit: values.spendingLimit,
              spendingLimitAsset: values.spendingLimitAsset,
              allowedActions: values.allowedActions,
            });
            setIsCreating(false);
          }}
        />
      ) : sessionKeys.length > 0 ? (
        <KeyboardAwareScrollView contentContainerStyle={styles.list} bottomOffset={16}>
          <Box
            backgroundColor="inputBox"
            borderColor="inputOutline"
            borderWidth={1}
            gap="xs"
            style={styles.infoCard}
          >
            <Text fontSize={16} lineHeight={24} letterSpacing={0.32} color="textPrimary">
              Session Keys &amp; dApps
            </Text>
            <Text fontSize={14} lineHeight={22} color="textMuted">
              Active sessions with temporary permissions. Swipe a session left to revoke it —
              revoking immediately removes its access.
            </Text>
            <TouchableOpacity accessibilityRole="link" hitSlop={8} onPress={() => setShowInfo(true)}>
              <Text fontSize={12} lineHeight={20} color="accentGreen">
                Learn how permissions work
              </Text>
            </TouchableOpacity>
          </Box>

          {sessionKeys.map((p) => (
            <SwipeablePermissionItem key={p.id} permission={p} onRevoke={() => setRevokeTarget(p)} />
          ))}
        </KeyboardAwareScrollView>
      ) : (
        <Box flex={1} alignItems="center" justifyContent="center" style={styles.gutter}>
          <Image source={EMPTY} contentFit="contain" style={styles.emptyArt} />
          <Text
            fontSize={20}
            lineHeight={28}
            fontFamily="SFproSemibold"
            color="textPrimary"
            textAlign="center"
            mb="xs"
          >
            No Permissions Yet!
          </Text>
          <Text fontSize={16} lineHeight={24} color="textSubheading" textAlign="center">
            Tap the &quot;Add Icon&quot; to get started.
          </Text>
        </Box>
      )}
      <PermissionsInfoModal visible={showInfo} onClose={() => setShowInfo(false)} />
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: 40,
    borderTopRightRadius: 40,
  },
  grabber: {
    width: 126,
    height: 8,
    borderRadius: 69,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 8,
  },
  fill: {
    flex: 1,
  },
  gutter: {
    paddingHorizontal: 24,
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addIcon: {
    width: 20,
    height: 20,
  },
  list: {
    paddingHorizontal: 24,
    paddingTop: 26,
    paddingBottom: 100,
  },
  infoCard: {
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 16,
    marginBottom: 16,
  },
  emptyArt: {
    width: 220,
    height: 220,
    marginBottom: 32,
  },
  pill: {
    flex: 1,
    height: 48,
    borderRadius: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelPill: {
    borderWidth: 1,
  },
  revokePill: {
    backgroundColor: '#E23A10',
  },
});

export default PermissionsSheet;
