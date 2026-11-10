import { StellarPayment } from '@/src/hooks/use-stellar-transactions';
import { useTokenIcon } from '@/src/hooks/use-token-list';
import { formatRelativeTime, shortenAddress } from '@/src/utils';
import { StyleSheet, TouchableOpacity } from 'react-native';
import Box from '../shared/Box';
import Text from '../shared/Text';
import TokenIcon from '../shared/TokenIcon';

const HistoryItem = ({
  item,
  smartAccountAddress,
  handleRowPress,
}: {
  item: StellarPayment;
  smartAccountAddress: string | null;
  handleRowPress: (tx: StellarPayment) => void;
}) => {
  const iconUrl = useTokenIcon(item.assetCode);

  const isSent = item.txType === 'send' || (item.txType === 'unknown' && item.from === smartAccountAddress);
  const isReceived = item.txType === 'receive' || (item.txType === 'unknown' && item.to === smartAccountAddress);
  const isSwap = item.txType === 'swap';
  const isBridge = item.txType === 'bridge';
  // A swap is two payment rows under one hash — the asset sold leaves the
  // account, the asset bought arrives — so sign each leg by its own direction
  // rather than by the transaction type.
  const isOutgoingLeg = item.from === smartAccountAddress;
  const code = item.assetCode ?? 'XLM';
  const amountNum = parseFloat(item.amount);
  const formattedAmount = amountNum.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 7,
  });

  const label = isSwap
    ? 'Swap'
    : isBridge
      ? 'Bridge'
      : isSent
        ? 'Sent'
        : isReceived
          ? 'Received'
          : 'Contract Call';
  const counterparty = isSent
    ? `To: ${shortenAddress(item.to)}`
    : isReceived
      ? `From: ${shortenAddress(item.from)}`
      : code;

  return (
    <TouchableOpacity activeOpacity={0.7} onPress={() => handleRowPress(item)}>
      <Box flexDirection="row" alignItems="center" gap="sm" borderRadius={16} style={styles.row}>
        <Box width={32} height={32} borderRadius={16} overflow="hidden">
          <TokenIcon iconUrl={iconUrl} size={32} />
        </Box>
        <Box flex={1} gap="xs">
          <Text variant="p6" fontFamily="SFproMedium" lineHeight={24} letterSpacing={0} color="textPrimary">
            {label}
          </Text>
          <Text
            variant="p7"
            lineHeight={14}
            letterSpacing={0}
            color="textSubheading"
            numberOfLines={1}
          >
            {counterparty}
          </Text>
        </Box>
        <Box alignItems="flex-end" gap="xs">
          <Text variant="p6" fontFamily="SFproSemibold" lineHeight={24} letterSpacing={0} color="textPrimary">
            {isSwap || isBridge
              ? `${isOutgoingLeg ? '-' : '+'}${formattedAmount} ${code}`
              : isSent || isReceived
                ? `${isSent ? '-' : '+'}${formattedAmount} ${code}`
                : '—'}
          </Text>
          <Text variant="p7" lineHeight={14} letterSpacing={0} color="textSubheading">
            {formatRelativeTime(item.createdAt)}
          </Text>
        </Box>
      </Box>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
});

export default HistoryItem;
