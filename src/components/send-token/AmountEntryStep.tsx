import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import React from 'react';
import { TouchableOpacity } from 'react-native';
import { NUMERIC_KEYS, Recipient, SendToken } from './types';

interface Props {
  selectedToken: SendToken;
  selectedWallet: Recipient;
  amount: string;
  fiatLabel?: string;
  onKeyPress: (key: string) => void;
  onMaxPress: () => void;
  onPresetPress: (usdAmount: number) => void;
}

const AmountEntryStep = ({
  selectedToken,
  selectedWallet,
  amount,
  fiatLabel,
  onKeyPress,
  onMaxPress,
  onPresetPress,
}: Props) => {
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme()

  const shortAddress = `${selectedWallet.address.slice(0, 6)}...${selectedWallet.address.slice(-4)}`;
  const availableAmount = parseFloat(selectedToken.amount);
  const enteredAmount = parseFloat(amount) || 0;
  const isOverBalance = enteredAmount > availableAmount;

  const rows = NUMERIC_KEYS.reduce((acc: { num: string }[][], val, i) => {
    if (i % 3 === 0) acc.push([]);
    acc[acc.length - 1].push(val);
    return acc;
  }, []);

  const KeypadButton = ({ num, onPress }: { num: string; onPress: () => void }) => (
    <TouchableOpacity
      activeOpacity={0.6}
      onPress={onPress}
      style={{
        flex: 1,
        height: 60,
        backgroundColor: isDark ? theme.colors.bg800 : theme.colors.white,
        margin: 4,
        borderRadius: 8,
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <Text variant="h8" color={isDark ? "white" : "black"} fontWeight="400">
        {num}
      </Text>
    </TouchableOpacity>
  );

  return (
    <Box flex={1}>
      <Box paddingHorizontal="l" mb="m">
        <Box
          flexDirection="row"
          alignItems="center"
          justifyContent="space-between"
          pb="s"
          style={{ borderBottomWidth: 1, borderBottomColor: theme.colors.gray800 }}
        >
          <Box flexDirection="row" alignItems="center" flex={1}>
            <Text variant="p7" color="textSecondary">
              To:{' '}
            </Text>
            <Text variant="p7" color="textPrimary" fontWeight="700">
              {shortAddress}
            </Text>
          </Box>
        </Box>
      </Box>

      <Box flex={1} justifyContent="center" alignItems="center" mb="m">
        <Box flexDirection="row" alignItems="center">
          <Text
            variant={amount.length < 10 ? 'h5' : 'h6'}
            color={isOverBalance ? 'inputError' : amount !== '0' ? 'textPrimary' : 'textSecondary'}
          >
            {amount}
          </Text>
          <Box
            width={3}
            height={amount.length < 10 ? 50 : 30}
            backgroundColor="primary700"
            marginHorizontal="s"
          />
          <Text
            variant={amount.length < 10 ? 'h5' : 'h6'}
            style={{ color: theme.colors.textPrimary, fontWeight: '600' }}
          >
            {selectedToken.code}
          </Text>
        </Box>
        {fiatLabel ? (
          <Text variant="p8" color="textSecondary" mt="s">
            {fiatLabel}
          </Text>
        ) : null}
        {isOverBalance && (
          <Text variant="p8" color="inputError" mt="s">
            Exceeds available balance
          </Text>
        )}
      </Box>

      <Box paddingHorizontal="l" mb="m">
        {/* <Box flexDirection="row" justifyContent="center" gap="m" mb="m" paddingHorizontal="l">
            {[50, 500, 1000].map((usdAmount) => (
              <TouchableOpacity
                key={usdAmount}
                style={{ flex: 1 }}
                onPress={() => onPresetPress(usdAmount)}
              >
                <Box
                  height={54}
                  backgroundColor="bg900"
                  borderRadius={12}
                  justifyContent="center"
                  alignItems="center"
                >
                  <Text variant="p6" color="textPrimary" fontWeight="700">
                    {'$' + usdAmount}
                  </Text>
                </Box>
              </TouchableOpacity>
            ))}
          </Box> */}

        <Box height={1} backgroundColor="btnDisabled" mb="m" />
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Box>
            <Text variant="p8" color="textSecondary" mb="xs">
              Available to Send
            </Text>
            <Text variant="h11" color="textPrimary" fontWeight="700">
              {availableAmount.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: selectedToken.code === 'XLM' ? 7 : 2,
              })}{' '}
              {selectedToken.code}
            </Text>
          </Box>
          <TouchableOpacity onPress={onMaxPress}>
            <Box px="m" py="s" backgroundColor="bg900" borderRadius={8}>
              <Text variant="p8" color="textPrimary" fontWeight="700">
                Max
              </Text>
            </Box>
          </TouchableOpacity>
        </Box>
      </Box>
      <Box
        backgroundColor={isDark ? "transparent" : "gray500"}
        paddingHorizontal="xs"
        paddingBottom="m"
        style={{ paddingTop: 8 }}
      >

        {rows.map((row, rowIndex) => (
          <Box key={rowIndex} flexDirection="row">
            {row.map((item, i) => (
              <KeypadButton key={i} num={item.num} onPress={() => onKeyPress(item.num)} />
            ))}
          </Box>
        ))}
        <Box flexDirection="row">
          <KeypadButton num="." onPress={() => onKeyPress('.')} />
          <KeypadButton num="0" onPress={() => onKeyPress('0')} />
          <TouchableOpacity
            onPress={() => onKeyPress('backspace')}
            style={{
              flex: 1,
              height: 60,
              margin: 4,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <Ionicons name="backspace-outline" size={24} color={isDark ? "white" : "black"} />
          </TouchableOpacity>
        </Box>
      </Box>
    </Box>
  );
};

export default AmountEntryStep;
