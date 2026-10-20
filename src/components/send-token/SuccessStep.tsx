import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import type { NetworkFee } from '@/src/api/transaction-build';
import React from 'react';
import { Image, TouchableOpacity } from 'react-native';

interface Props {
  amount: string;
  tokenCode: string;
  recipient: string;
  txHash?: string;
  networkFee?: NetworkFee;
  onContinue: () => void;
  onSaveAddress?: () => void;
}

const SuccessStep = ({ amount, tokenCode, recipient, networkFee, onContinue, onSaveAddress }: Props) => {
  const shortRecipient = `${recipient.slice(0, 6)}...${recipient.slice(-4)}`;

  return (
    <Box flex={1} paddingHorizontal="l" justifyContent="space-between" pb="xl">
      <Box flex={1} justifyContent="center" alignItems="center">
        <Image
          source={require('@/src/assets/images/success.png')}
          style={{ width: 160, height: 160, resizeMode: 'contain', marginBottom: 32 }}
        />
        <Text variant="h7" color="textPrimary" fontWeight="700" mb="xs">
          Token Sent!
        </Text>
        <Box px="m">
          <Text textAlign="center" lineHeight={22}>
            <Text variant="p7" fontFamily="SFBold" color="textPrimary">{amount} {tokenCode} </Text>
            <Text variant="p6" color="textSecondary">was successfully sent to </Text>
            <Text variant="p6" color="textPrimary" fontFamily="SFBold">{shortRecipient}</Text>
          </Text>
          {networkFee && (
            <Text variant="p8" color="textSecondary" textAlign="center" mt="s">
              Network fee: {networkFee.maxAmount} {networkFee.symbol}
            </Text>
          )}
        </Box>
      </Box>
      <Box gap="s">
        {onSaveAddress && (
          <TouchableOpacity activeOpacity={0.8} onPress={onSaveAddress}>
            <Box
              height={56}
              borderRadius={28}
              justifyContent="center"
              alignItems="center"
              borderWidth={1}
              borderColor="primary700"
            >
              <Text variant="p6" color="primary700" fontWeight="700">Save to Address Book</Text>
            </Box>
          </TouchableOpacity>
        )}
        <TouchableOpacity activeOpacity={0.8} onPress={onContinue}>
          <Box
            height={56}
            backgroundColor="primary"
            borderRadius={28}
            justifyContent="center"
            alignItems="center"
          >
            <Text variant="p6" color="black" fontWeight="700">Done</Text>
          </Box>
        </TouchableOpacity>
      </Box>
    </Box>
  );
};

export default SuccessStep;
