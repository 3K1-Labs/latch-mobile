import { Image } from 'expo-image';
import React from 'react';
import { StyleSheet } from 'react-native';

import { SetupButton } from '@/src/components/onboarding/SetupChrome';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';

const IMAGES = {
  success: require('@/src/assets/images/result/tx-success.svg'),
  failed: require('@/src/assets/images/result/tx-failed.svg'),
  rays: require('@/src/assets/images/result/success-rays.png'),
};

interface Props {
  name: string;
  duration: string;
  isError?: boolean;
  onClose: () => void;
  onRetry?: () => void;
}

const SessionKeySuccess = ({ name, duration, isError, onClose, onRetry }: Props) => {
  const label = name || 'My Bot';
  return (
    <Box flex={1} style={styles.body}>
      <Box flex={1} alignItems="center" justifyContent="center" gap="xs">
        <Box>
          {!isError && <Image source={IMAGES.rays} contentFit="contain" style={styles.rays} />}
          <Image
            source={isError ? IMAGES.failed : IMAGES.success}
            contentFit="contain"
            style={isError ? styles.failedArt : styles.successArt}
          />
        </Box>
        <Box alignItems="center" style={styles.copy}>
          <Text
            fontSize={20}
            lineHeight={28}
            fontFamily="SFproSemibold"
            color="textPrimary"
            textAlign="center"
          >
            {isError ? 'Session Not Created' : 'Session Created'}
          </Text>
          <Text fontSize={16} lineHeight={24} color="textSubheading" textAlign="center">
            {isError ? (
              <>
                Could not create a session key for{' '}
                <Text fontSize={16} lineHeight={24} color="textPrimary">
                  {label}
                </Text>
                .
              </>
            ) : (
              <>
                The session key for{' '}
                <Text fontSize={16} lineHeight={24} color="textPrimary">
                  {label}
                </Text>{' '}
                is now active. It will automatically expire in {duration.toLowerCase()}.
              </>
            )}
          </Text>
        </Box>
      </Box>

      <SetupButton
        label={isError ? 'Try Again' : 'View Permissions'}
        onPress={() => (isError ? onRetry?.() : onClose())}
      />
    </Box>
  );
};

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  // Same green burst and offsets as the other result screens (Figma 802:33319).
  rays: {
    position: 'absolute',
    width: 312,
    height: 312,
    left: -37.5,
    top: -58,
    transform: [{ rotate: '180deg' }],
  },
  successArt: {
    width: 229,
    height: 229,
  },
  failedArt: {
    width: 243,
    height: 243,
  },
  copy: {
    width: 281,
    gap: 2,
  },
});

export default SessionKeySuccess;
