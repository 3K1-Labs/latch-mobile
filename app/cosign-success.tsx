/**
 * cosign-success.tsx — terminal screen for a shared-wallet transfer that reached
 * threshold and was broadcast on-chain. Reuses the standard TransactionDetail
 * layout (status header + timeline + hash + detail card) so a completed multisig
 * transfer looks identical to any other completed transaction.
 *
 * Shown to the last signer (whose approval/submit executed it) and to any member
 * still on the approval screen when the poll detects the submitted tx hash.
 *
 * Params: hash (required), from, to, amount, asset, createdAt (ISO).
 */

import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fetchTxDetails } from '@/src/api/tx-details';
import TransactionStatusHeaderMultisig from '@/src/components/cosign/TransactionStatusHeaderMultisig';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import UtilityHeader from '@/src/components/shared/UtilityHeader';
import TransactionDetailCard from '@/src/components/transaction/TransactionDetailCard';
import TransactionHashBox from '@/src/components/transaction/TransactionHashBox';
import TransactionTimeline from '@/src/components/transaction/TransactionTimeline';
import { ACTIVE_NETWORK } from '@/src/constants/config';
import { useAppTheme } from '@/src/theme/ThemeContext';

const CosignSuccess = () => {
  const insets = useSafeAreaInsets();
  const { isDark } = useAppTheme();
  const { hash, from, to, amount, asset, createdAt } = useLocalSearchParams<{
    hash?: string;
    from?: string;
    to?: string;
    amount?: string;
    asset?: string;
    createdAt?: string;
  }>();

  const { data: txDetails } = useQuery({
    queryKey: ['cosign-tx-details', hash],
    queryFn: () => fetchTxDetails(hash as string),
    enabled: !!hash,
    staleTime: Infinity,
  });

  // Prefer the on-chain ledger close time; fall back to the request createdAt.
  const dateSource = txDetails?.date || createdAt;
  const formattedDate = dateSource ? format(new Date(dateSource), 'MMM d, yyyy • HH:mm') : '—';
  return (
    <Box flex={1} backgroundColor="mainBackground">
      <StatusBar style="light" />

      <Box style={{ paddingTop: insets.top }}>
        <UtilityHeader
          title="Transaction Details"
          onBack={() => router.replace('/(tabs)/history')}
          showHandle={false}
        />
      </Box>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
      >
        <TransactionStatusHeaderMultisig
          amount={amount || '0'}
          assetCode={asset || 'XLM'}
          status="Completed"
          type="sent"
          isDark={isDark}
        />

        <TransactionTimeline date={formattedDate} />

        <TransactionHashBox hash={hash || ''} isDark={isDark} />

        <TransactionDetailCard
          date={formattedDate}
          from={from || ''}
          to={to || ''}
          fee={txDetails?.fee ?? '—'}
          block={txDetails?.ledger ?? '—'}
          network={ACTIVE_NETWORK.networkName}
          isDark={isDark}
        />
      </ScrollView>

      <Box
        position="absolute"
        bottom={0}
        left={0}
        right={0}
        padding="m"
        backgroundColor="mainBackground"
        style={{ paddingBottom: insets.bottom + 16 }}
      >
        <TouchableOpacity activeOpacity={0.8} onPress={() => router.replace('/(tabs)')}>
          <Box
            height={48}
            backgroundColor="primary"
            borderRadius={32}
            flexDirection="row"
            justifyContent="center"
            alignItems="center"
            gap="s"
          >
            <Text variant="h11" color="black" fontWeight="700">
              Done
            </Text>
            {/* <Ionicons name="open-outline" size={20} color="black" /> */}
          </Box>
        </TouchableOpacity>
      </Box>
    </Box>
  );
};

export default CosignSuccess;
