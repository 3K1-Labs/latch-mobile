import { Theme } from '@/src/theme/theme';
import { useTheme } from '@shopify/restyle';
import { SetupButton } from '@/src/components/onboarding/SetupChrome';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import TokenIcon from '@/src/components/shared/TokenIcon';
import { useTokenIcon } from '@/src/hooks/use-token-list';
import { Image } from 'expo-image';
import React, { useEffect, useState } from 'react';
import { Animated, Keyboard, StyleSheet, TouchableOpacity, TouchableWithoutFeedback } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SendToken } from './types';

const CLOSE = require('@/src/assets/images/swap/close.svg');

interface Props {
  visible: boolean;
  title: string;
  token: SendToken;
  amount: string;
  fiatLabel?: string;
  rows: { label: string; value: string }[];
  primaryLabel: string;
  onPrimary: () => void;
  /** Omit to hide the close button (the receipt can only be left via its button). */
  onClose?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  /** Shown in place of the token icon (the receipt's success mascot). */
  illustration?: number;
}

/**
 * Bottom sheet over the amount screen: the transfer review before signing, and
 * the receipt after. Rendered in-screen (not a native Modal) so the auth prompt
 * and the "Sending…" overlay, which are Modals, always stack above it.
 */
const SendSummarySheet = ({
  visible,
  title,
  token,
  amount,
  fiatLabel,
  rows,
  primaryLabel,
  onPrimary,
  onClose,
  secondaryLabel,
  onSecondary,
  illustration,
}: Props) => {
  const theme = useTheme<Theme>();
  const insets = useSafeAreaInsets();
  const iconUrl = useTokenIcon(token.code, token.issuer);
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (visible) Keyboard.dismiss();
    Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: visible ? 280 : 200,
      useNativeDriver: true,
    }).start();
  }, [visible, progress]);

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [700, 0] });

  return (
    <Box
      style={StyleSheet.absoluteFill}
      pointerEvents={visible ? 'auto' : 'none'}
      justifyContent="flex-end"
    >
      <TouchableWithoutFeedback onPress={onClose} disabled={!onClose}>
        <Animated.View style={[styles.backdrop, { backgroundColor: theme.colors.backdrop }, { opacity: progress }]} />
      </TouchableWithoutFeedback>

      <Animated.View
        style={[styles.sheet, { backgroundColor: theme.colors.surfaceBase }, { paddingBottom: insets.bottom + 40, transform: [{ translateY }] }]}
      >
        <Box alignItems="center" style={styles.grabberWrap}>
          <Box width={126} height={8} borderRadius={69} backgroundColor="inputOutline" />
        </Box>

        <Box flexDirection="row" alignItems="center" justifyContent="center" style={styles.header}>
          <Text
            fontSize={18}
            lineHeight={26}
            fontFamily="SFproMedium"
            color="textPrimary"
            numberOfLines={1}
            style={styles.title}
          >
            {title}
          </Text>
          {onClose && (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={8}
              onPress={onClose}
              style={[styles.close, { backgroundColor: theme.colors.inputOutline }]}
            >
              <Image source={CLOSE} contentFit="contain" style={styles.closeIcon} />
            </TouchableOpacity>
          )}
        </Box>

        <Box alignItems="center" gap="m" style={styles.hero}>
          {illustration ? (
            <Image source={illustration} contentFit="contain" style={styles.illustration} />
          ) : (
            <Box width={64} height={64} borderRadius={32} overflow="hidden" style={[styles.tokenBg, { backgroundColor: theme.colors.badgeBg }]}>
              <TokenIcon iconUrl={iconUrl} size={64} />
            </Box>
          )}
          <Box alignItems="center">
            <Box flexDirection="row" alignItems="flex-end">
              <Text
                fontFamily="SFproSemibold"
                fontSize={56}
                lineHeight={72}
                letterSpacing={-1.4}
                color="textPrimary"
                numberOfLines={1}
                adjustsFontSizeToFit
                style={styles.amount}
              >
                {amount}
              </Text>
              <Text
                fontFamily="SFproSemibold"
                fontSize={16}
                lineHeight={24}
                color="textPrimary"
                style={styles.code}
              >
                {token.code}
              </Text>
            </Box>
            {fiatLabel ? (
              <Text fontSize={16} lineHeight={24} letterSpacing={0.32} color="textSubheading">
                {fiatLabel}
              </Text>
            ) : null}
          </Box>
        </Box>

        <Box style={styles.rows}>
          {rows.map((row) => (
            <Box
              key={row.label}
              flexDirection="row"
              alignItems="center"
              justifyContent="space-between"
              gap="m"
              style={styles.row}
            >
              <Text fontSize={16} lineHeight={24} letterSpacing={0.32} color="textSubheading">
                {row.label}
              </Text>
              <Text
                flexShrink={1}
                fontSize={16}
                lineHeight={24}
                letterSpacing={0.32}
                fontFamily="SFproMedium"
                color="textPrimary"
                textAlign="right"
                numberOfLines={1}
              >
                {row.value}
              </Text>
            </Box>
          ))}
        </Box>

        <Box style={styles.actions}>
          <SetupButton label={primaryLabel} onPress={onPrimary} />
          {secondaryLabel && onSecondary && (
            <TouchableOpacity
              accessibilityRole="button"
              activeOpacity={0.7}
              onPress={onSecondary}
              style={styles.secondary}
            >
              <Text fontSize={16} lineHeight={24} fontFamily="SFproMedium" color="textPrimary">
                {secondaryLabel}
              </Text>
            </TouchableOpacity>
          )}
        </Box>
      </Animated.View>
    </Box>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  sheet: {
    borderTopLeftRadius: 40,
    borderTopRightRadius: 40,
    paddingHorizontal: 24,
  },
  grabberWrap: {
    paddingTop: 10,
  },
  header: {
    marginTop: 20,
    height: 40,
  },
  title: {
    maxWidth: '70%',
  },
  close: {
    position: 'absolute',
    right: 0,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeIcon: {
    width: 20,
    height: 20,
  },
  hero: {
    marginTop: 37,
  },
  illustration: {
    width: 160,
    height: 160,
  },
  tokenBg: {

  },
  amount: {
    maxWidth: 260,
  },
  code: {
    marginLeft: 4,
    marginBottom: 12,
  },
  rows: {
    marginTop: 32,
    gap: 4,
  },
  row: {
    paddingVertical: 8,
  },
  actions: {
    marginTop: 40,
  },
  secondary: {
    alignItems: 'center',
    paddingTop: 16,
  },
});

export default SendSummarySheet;
