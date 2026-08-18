import { StellarPayment } from '@/src/hooks/use-stellar-transactions';
import { useTokenIcon } from '@/src/hooks/use-token-list';
import { useAppTheme } from '@/src/theme/ThemeContext';
import { formatRelativeTime } from '@/src/utils';
import { TouchableOpacity } from 'react-native';
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
  const { isDark } = useAppTheme();
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

  return (
    <Box>
      <TouchableOpacity activeOpacity={0.7} onPress={() => handleRowPress(item)}>
        <Box
          backgroundColor={'bg11'}
          borderRadius={18}
          padding="m"
          flexDirection="row"
          alignItems="center"
          mb="s"
          style={
            !isDark
              ? {
                  borderWidth: 1,
                  borderColor: '#F5F5F5',
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.04,
                  shadowRadius: 4,
                  elevation: 2,
                }
              : {}
          }
        >
          <Box
            width={44}
            height={44}
            backgroundColor={isDark ? 'black' : 'text400'}
            borderRadius={22}
            mr="m"
          >
            <TokenIcon iconUrl={iconUrl} size={44} />
          </Box>
          <Box flex={1}>
            <Text variant="h10" color="textPrimary" fontWeight="700">
              {code}
            </Text>
            <Text variant="p8" color="textSecondary">
              {isSwap ? 'Swap' : isBridge ? 'Bridge' : isSent ? 'Sent' : isReceived ? 'Received' : 'Contract Call'}
            </Text>
          </Box>
          <Box alignItems="flex-end">
            <Text variant="h10" color="textPrimary" fontWeight="700">
              {isSwap || isBridge
                ? `${isOutgoingLeg ? '-' : '+'}${formattedAmount} ${code}`
                : isSent || isReceived
                  ? `${isSent ? '-' : '+'}${formattedAmount} ${code}`
                  : '—'}
            </Text>
            <Text variant="p8" color="textSecondary">
              {formatRelativeTime(item.createdAt)}
            </Text>
          </Box>
        </Box>
      </TouchableOpacity>
    </Box>
  );
};

export default HistoryItem;
