import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { Linking, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import UtilityHeader from '@/src/components/shared/UtilityHeader';
import TransactionDetailCard from '@/src/components/transaction/TransactionDetailCard';
import TransactionHashBox from '@/src/components/transaction/TransactionHashBox';
import TransactionStatusHeader from '@/src/components/transaction/TransactionStatusHeader';
import TransactionTimeline from '@/src/components/transaction/TransactionTimeline';
import { ACTIVE_NETWORK, getTransactionExplorerUrl, HORIZON_URL } from '@/src/constants/config';
import { useAppTheme } from '@/src/theme/ThemeContext';

async function fetchTxDetails(hash: string): Promise<{ fee: string; ledger: string }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', `${HORIZON_URL}/transactions/${encodeURIComponent(hash)}`, true);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.timeout = 12000;
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        const feeStroops = parseInt(data.fee_charged ?? '0', 10);
        const feeXLM = String(parseFloat((feeStroops / 10_000_000).toFixed(7)));
        resolve({ fee: `${feeXLM} XLM`, ledger: String(data.ledger ?? '—') });
      } catch {
        resolve({ fee: '—', ledger: '—' });
      }
    };
    xhr.onerror = () => resolve({ fee: '—', ledger: '—' });
    xhr.ontimeout = () => resolve({ fee: '—', ledger: '—' });
    xhr.send();
  });
}

const TransactionDetailScreen = () => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    id: string;
    hash: string;
    type: string;
    from: string;
    to: string;
    amount: string;
    assetType: string;
    assetCode: string;
    createdAt: string;
    direction: 'sent' | 'received';
  }>();
  const { isDark } = useAppTheme();

  const { hash, from, to, amount, createdAt, direction, assetCode } = params;

  const { data: txDetails } = useQuery({
    queryKey: ['tx-details', hash],
    queryFn: () => fetchTxDetails(hash),
    enabled: !!hash,
    staleTime: Infinity,
  });

  const formattedDate = createdAt ? format(new Date(createdAt), 'MMM d, yyyy • HH:mm') : '—';
  const explorerUrl = getTransactionExplorerUrl(hash ?? '');

  return (
    <Box flex={1} backgroundColor="mainBackground">
      <StatusBar style="light" />

      <Box style={{ paddingTop: insets.top }}>
        <UtilityHeader title="Transaction Details" onBack={() => router.back()} showHandle={false} />
      </Box>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
      >
        <TransactionStatusHeader
          amount={amount || '0'}
          assetCode={assetCode || 'XLM'}
          status="Completed"
          type={direction || 'sent'}
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

      {/* Bottom Button */}
      <Box
        position="absolute"
        bottom={0}
        left={0}
        right={0}
        padding="m"
        backgroundColor="mainBackground"
        style={{ paddingBottom: insets.bottom + 16 }}
      >
        <TouchableOpacity activeOpacity={0.8} onPress={() => Linking.openURL(explorerUrl)}>
          <Box
            height={64}
            backgroundColor="primary"
            borderRadius={32}
            flexDirection="row"
            justifyContent="center"
            alignItems="center"
            gap="s"
          >
            <Text variant="h11" color="black" fontWeight="700">
              View On Stellar Explorer
            </Text>
            <Ionicons name="open-outline" size={20} color="black" />
          </Box>
        </TouchableOpacity>
      </Box>
    </Box>
  );
};

export default TransactionDetailScreen;
