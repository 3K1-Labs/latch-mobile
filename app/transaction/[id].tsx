import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import {
  Animated,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fetchTxDetails } from '@/src/api/tx-details';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import TokenIcon from '@/src/components/shared/TokenIcon';
import { ACTIVE_NETWORK, getTransactionExplorerUrl } from '@/src/constants/config';
import { useDisplayFiat } from '@/src/hooks/use-display-fiat';
import { usePrices } from '@/src/hooks/use-prices';
import { useTokenIcon } from '@/src/hooks/use-token-list';
import { shortenAddress } from '@/src/utils';
import { copyToClipboard } from '@/src/utils/copy-to-clipboard';

const ICONS = {
  close: require('@/src/assets/images/swap/close.svg'),
  tick: require('@/src/assets/images/transaction/tick.svg'),
  open: require('@/src/assets/images/transaction/open.svg'),
  copy: require('@/src/assets/images/transaction/copy.svg'),
  stellar: require('@/src/assets/token/stellar.png'),
};
const STEPS = ['Initiated', 'Submitted', 'Confirmed'];
const GREEN = '#8BB101';

const Dot = () => <Box width={4} height={4} borderRadius={2} style={styles.dot} />;

const DetailRow = ({
  label,
  children,
  icon,
  onIconPress,
  iconLabel,
}: {
  label: string;
  children: React.ReactNode;
  icon?: number;
  onIconPress?: () => void;
  iconLabel?: string;
}) => (
  <Box flexDirection="row" alignItems="center" justifyContent="space-between" style={styles.row}>
    <Text fontSize={14} lineHeight={24} letterSpacing={0.28} color="textSubheading">
      {label}
    </Text>
    <Box flexDirection="row" alignItems="center" gap="s" flexShrink={1}>
      {children}
      {icon && (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={iconLabel}
          hitSlop={10}
          onPress={onIconPress}
        >
          <Image source={icon} contentFit="contain" style={styles.rowIcon} />
        </TouchableOpacity>
      )}
    </Box>
  </Box>
);

const Value = ({ children }: { children: React.ReactNode }) => (
  <Text
    fontSize={14}
    lineHeight={24}
    letterSpacing={0.28}
    fontFamily="SFproMedium"
    color="textPrimary"
    textAlign="right"
    numberOfLines={1}
  >
    {children}
  </Text>
);

const TransactionDetailScreen = () => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { hash, from, to, amount, createdAt, assetCode } = useLocalSearchParams<{
    id: string;
    hash: string;
    from: string;
    to: string;
    amount: string;
    assetCode: string;
    createdAt: string;
  }>();
  const code = assetCode || 'XLM';
  const iconUrl = useTokenIcon(code);
  const { data: prices } = usePrices();
  const { formatToken } = useDisplayFiat();

  const { data: txDetails } = useQuery({
    queryKey: ['tx-details', hash],
    queryFn: () => fetchTxDetails(hash),
    enabled: !!hash,
    staleTime: Infinity,
  });

  const date = createdAt ? new Date(createdAt) : null;
  const stepStamp = date ? { day: format(date, 'dd/MM'), time: format(date, 'HH:mm') } : null;

  // The fee is charged in XLM ("0.00001 XLM"); add its fiat value when we have a price.
  const feeXlm = txDetails?.fee && txDetails.fee !== '—' ? txDetails.fee : null;
  const feeFiat = feeXlm
    ? formatToken(feeXlm.replace(' XLM', ''), prices?.XLM?.price, { approx: false }).text
    : null;

  const fiat = prices?.[code]?.price ? formatToken(amount || '0', prices[code].price).text : null;

  const [slide] = useState(() => new Animated.Value(1));
  useEffect(() => {
    Animated.timing(slide, { toValue: 0, duration: 280, useNativeDriver: true }).start();
  }, [slide]);
  const close = () => {
    Animated.timing(slide, { toValue: 1, duration: 200, useNativeDriver: true }).start(() =>
      router.back(),
    );
  };
  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [0, 900] });

  return (
    <Box flex={1}>
      <StatusBar style="light" />
      <Pressable accessibilityLabel="Close" onPress={close} style={styles.backdrop} />

      <Animated.View
        style={[styles.sheet, { marginTop: insets.top - 5, transform: [{ translateY }] }]}
      >

      <Box alignItems="center" style={styles.grabberWrap}>
        <Box width={126} height={8} borderRadius={69} backgroundColor="inputOutline" />
      </Box>

      <Box flexDirection="row" alignItems="center" justifyContent="center" style={styles.header}>
        <Text fontSize={18} lineHeight={26} fontFamily="SFproMedium" color="textPrimary">
          Transaction Details
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={8}
          onPress={close}
          style={styles.close}
        >
          <Image source={ICONS.close} contentFit="contain" style={styles.closeIcon} />
        </TouchableOpacity>
      </Box>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      >
        <Box alignItems="center" gap="m">
          <Box width={64} height={64} borderRadius={32} overflow="hidden">
            <TokenIcon iconUrl={iconUrl} size={64} />
          </Box>
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
                {parseFloat(amount || '0').toLocaleString('en-US', { maximumFractionDigits: 7 })}
              </Text>
              <Text
                fontFamily="SFproSemibold"
                fontSize={16}
                lineHeight={24}
                color="textPrimary"
                style={styles.code}
              >
                {code}
              </Text>
            </Box>
            {fiat && (
              <Text fontSize={16} lineHeight={24} letterSpacing={0.32} color="textSubheading">
                {fiat}
              </Text>
            )}
          </Box>
        </Box>

        {/* Only confirmed transactions reach history, so every step is complete; the
            chain records one timestamp, shown under each. */}
        <Box flexDirection="row" justifyContent="space-between" style={styles.timeline}>
          {STEPS.slice(1).map((step, i) => (
            <LinearGradient
              key={step}
              colors={[GREEN, 'rgba(139,177,1,0)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.connector, { left: `${(i * 100) / 3 + 100 / 6 + 6}%` }]}
            />
          ))}
          {STEPS.map((step) => (
            <Box key={step} flex={1} alignItems="center" style={styles.step}>
              <Box style={styles.tickRing}>
                <Box style={styles.tickDot}>
                  <Image source={ICONS.tick} contentFit="contain" style={styles.tickIcon} />
                </Box>
              </Box>
              <Box alignItems="center" style={styles.stepText}>
                <Text fontSize={14} lineHeight={22} fontFamily="SFproMedium" color="textPrimary">
                  {step}
                </Text>
                {stepStamp && (
                  <Box flexDirection="row" alignItems="center" gap="xs">
                    <Text fontSize={10} lineHeight={18} color="textSubheading">
                      {stepStamp.day}
                    </Text>
                    <Dot />
                    <Text fontSize={10} lineHeight={18} color="textSubheading">
                      {stepStamp.time}
                    </Text>
                  </Box>
                )}
              </Box>
            </Box>
          ))}
        </Box>

        <Box
          backgroundColor="inputBox"
          borderColor="inputOutline"
          borderWidth={1}
          borderRadius={20}
          style={styles.card}
        >
          <DetailRow
            label="Transaction Hash"
            icon={ICONS.open}
            iconLabel="View on Stellar Expert"
            onIconPress={() => hash && Linking.openURL(getTransactionExplorerUrl(hash))}
          >
            <Value>{hash ? shortenAddress(hash) : '—'}</Value>
          </DetailRow>
          <DetailRow label="Date">
            {date ? (
              <Box flexDirection="row" alignItems="center" gap="s">
                <Value>{format(date, 'HH:mm')}</Value>
                <Box width={6} height={6} borderRadius={3} style={styles.dot} />
                <Value>{format(date, 'dd/MM/yy')}</Value>
              </Box>
            ) : (
              <Value>—</Value>
            )}
          </DetailRow>
          <DetailRow
            label="From"
            icon={from ? ICONS.copy : undefined}
            iconLabel="Copy sender address"
            onIconPress={() => copyToClipboard(from)}
          >
            <Value>{from ? shortenAddress(from) : '—'}</Value>
          </DetailRow>
          <DetailRow
            label="To"
            icon={to ? ICONS.copy : undefined}
            iconLabel="Copy recipient address"
            onIconPress={() => copyToClipboard(to)}
          >
            <Value>{to ? shortenAddress(to) : '—'}</Value>
          </DetailRow>
          <DetailRow label="Network Fee">
            <Value>{feeXlm ? (feeFiat ? `${feeFiat} (${feeXlm})` : feeXlm) : '—'}</Value>
          </DetailRow>
          <DetailRow label="Block Number">
            <Value>{txDetails?.ledger ?? '—'}</Value>
          </DetailRow>
          <Box
            flexDirection="row"
            alignItems="center"
            justifyContent="space-between"
            style={styles.row}
          >
            <Text fontSize={16} lineHeight={24} letterSpacing={0.32} color="textSubheading">
              Network
            </Text>
            <Box flexDirection="row" alignItems="center" gap="s">
              <Image source={ICONS.stellar} contentFit="contain" style={styles.networkLogo} />
              <Text
                fontSize={16}
                lineHeight={24}
                letterSpacing={0.32}
                fontFamily="SFproMedium"
                color="textPrimary"
              >
                Stellar {ACTIVE_NETWORK.network === 'TESTNET' ? 'Testnet' : 'Mainnet'}
              </Text>
            </Box>
          </Box>
        </Box>
      </ScrollView>
      </Animated.View>
    </Box>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(18,18,18,0.9)',
  },
  sheet: {
    flex: 1,
    backgroundColor: '#020202',
    borderTopLeftRadius: 40,
    borderTopRightRadius: 40,
    overflow: 'hidden',
  },
  grabberWrap: {
    paddingTop: 10,
  },
  header: {
    marginTop: 20,
    height: 40,
    paddingHorizontal: 24,
  },
  close: {
    position: 'absolute',
    right: 24,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeIcon: {
    width: 20,
    height: 20,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 37,
  },
  amount: {
    maxWidth: 260,
  },
  code: {
    marginLeft: 4,
    marginBottom: 12,
  },
  timeline: {
    marginTop: 32,
  },
  connector: {
    position: 'absolute',
    top: 14,
    width: '22%',
    height: 4,
    borderRadius: 18,
  },
  step: {
    gap: 14,
  },
  // A 24pt green dot inside a 4pt translucent-green ring, as in the design.
  tickRing: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(118,177,1,0.24)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#76B101',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickIcon: {
    width: 20,
    height: 20,
  },
  stepText: {
    gap: 2,
  },
  dot: {
    backgroundColor: '#363636',
  },
  card: {
    marginTop: 44,
    padding: 20,
    gap: 8,
  },
  row: {
    paddingVertical: 8,
    gap: 12,
  },
  rowIcon: {
    width: 18,
    height: 18,
  },
  networkLogo: {
    width: 22,
    height: 20,
    borderRadius: 4,
  },
});

export default TransactionDetailScreen;
