import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { Theme } from '@/src/theme/theme';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { copyToClipboard } from '@/src/utils/copy-to-clipboard';
import React from 'react';
import { TouchableOpacity } from 'react-native';

interface DetailRowProps {
  label: string;
  value: string;
  /** Full string to copy when `value` is a truncated display form. */
  copyValue?: string;
  copyable?: boolean;
  isLast?: boolean;
}

const DetailRow = ({ label, value, copyValue, copyable, isLast }: DetailRowProps) => {
  const theme = useTheme<Theme>();

  const handleCopy = () => {
    if (copyable) copyToClipboard(copyValue ?? value, label);
  };

  return (
    <Box
      flexDirection="row"
      justifyContent="space-between"
      alignItems="center"
      py="m"
      borderBottomWidth={isLast ? 0 : 0.5}
      borderBottomColor="gray900"
    >
      <Text variant="p8" color="textSecondary">
        {label}
      </Text>
      <Box flexDirection="row" alignItems="center">
        <Text variant="p8" color="textPrimary" fontWeight="700" mr={copyable ? 'xs' : 'none'}>
          {value}
        </Text>
        {copyable && (
          <TouchableOpacity onPress={handleCopy} activeOpacity={0.7}>
            <Ionicons name="copy-outline" size={16} color={theme.colors.textSecondary} />
          </TouchableOpacity>
        )}
      </Box>
    </Box>
  );
};

interface TransactionDetailCardProps {
  date: string;
  from: string;
  to: string;
  fee: string;
  block: string;
  network: string;
  isDark?: boolean;
}

const TransactionDetailCard = ({
  date,
  from,
  to,
  fee,
  block,
  network,
  isDark,
}: TransactionDetailCardProps) => {
  const truncate = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  return (
    <Box
      backgroundColor={isDark ? 'bg11' : 'bgDark100'}
      borderRadius={24}
      paddingHorizontal="m"
      mx="m"
      mb="xl"
      borderWidth={1}
      borderColor="gray900"
    >
      <DetailRow label="Date" value={date} />
      <DetailRow label="From" value={truncate(from)} copyValue={from} copyable />
      <DetailRow label="To" value={truncate(to)} copyValue={to} copyable />
      <DetailRow label="Network Fee" value={fee} />
      <DetailRow label="Block Number" value={block} />
      <DetailRow label="Network" value={network} isLast />
    </Box>
  );
};

export default TransactionDetailCard;
