import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import * as WebBrowser from 'expo-web-browser';
import React, { useState } from 'react';
import { TouchableOpacity } from 'react-native';

import MoonPayAmountSheet, {
  MOONPAY_BASE_CURRENCY,
} from '@/src/components/onramp/MoonPayAmountSheet';
import BottomSheet from '@/src/components/shared/BottomSheet';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { Theme } from '@/src/theme/theme';
import { useAppTheme } from '@/src/theme/ThemeContext';

const MOONPAY_API_KEY = process.env.EXPO_PUBLIC_MOONPAY_API_KEY ?? '';

interface Props {
  visible: boolean;
  onClose: () => void;
  onReceive: () => void;
  poolAddress: string;
  memo?: string;
  /**
   * Mints a funding intent with an on-ramp-length TTL, resolving undefined if it
   * can't. Awaited before handing the tag to a provider, since the intent the
   * sheet was opened with is sized for a direct wallet send.
   */
  prepareOnrampIntent?: () => Promise<{ pool_address: string; memo_id: string } | undefined>;
}

const BuyXLMSheet = ({
  visible,
  onClose,
  onReceive,
  poolAddress,
  memo,
  prepareOnrampIntent,
}: Props) => {
  const theme = useTheme<Theme>();
  const { isDark } = useAppTheme();
  const [amountVisible, setAmountVisible] = useState(false);
  const [preparing, setPreparing] = useState(false);

  const openMoonPay = async (amount: string) => {
    if (preparing) return;
    setPreparing(true);
    let address = poolAddress;
    let tag = memo;
    try {
      // A bank transfer can outlive the default 1h intent, and an expired memo is
      // swept to recovery rather than credited. Fall back to the intent we were
      // opened with if this fails — a short tag still works for a fast card
      // purchase, whereas no tag at all is swept unconditionally.
      const fresh = await prepareOnrampIntent?.();
      if (fresh) {
        address = fresh.pool_address;
        tag = fresh.memo_id;
      }
    } finally {
      setPreparing(false);
    }

    const params: Record<string, string> = {
      apiKey: MOONPAY_API_KEY,
      currencyCode: 'xlm',
      showOnlyCurrencies: 'xlm',
      baseCurrencyCode: MOONPAY_BASE_CURRENCY,
      baseCurrencyAmount: amount,
      // The user set the amount on our own screen, so freeze it in the widget —
      // an editable field there would silently diverge from what they confirmed.
      lockAmount: 'true',
    };
    if (address) params.walletAddress = address;
    // The relayer only credits deposits carrying a MEMO_ID; anything MoonPay
    // sends as MEMO_TEXT is swept to its recovery address. Confirm MoonPay
    // emits this tag as an ID memo for XLM before enabling on mainnet.
    if (tag) params.walletAddressTag = tag;
    // Present the browser from the amount screen and only dismiss that screen
    // once the browser closes. Dismissing it first races the presentation: the
    // browser ends up presented by a view controller that is already going away,
    // which leaves a black screen behind the MoonPay sheet.
    try {
      await WebBrowser.openBrowserAsync(
        `https://buy.moonpay.com?${new URLSearchParams(params).toString()}`,
        { presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET },
      );
    } finally {
      setAmountVisible(false);
    }
  };

  return (
    <>
      <BottomSheet
        visible={visible}
        onClose={onClose}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
      >
        <Box flexDirection="row" alignItems="center" justifyContent="space-between" py="m" mb="s">
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
          </TouchableOpacity>
          <Text variant="h9" color="textPrimary" fontWeight="700">
            Buy XLM
          </Text>
          <Box width={24} />
        </Box>

        <Text variant="p7" color="textSecondary" mb="l">
          Purchase XLM with a debit card or bank transfer.
        </Text>

        <TouchableOpacity activeOpacity={0.75} onPress={() => setAmountVisible(true)}>
          <Box
            flexDirection="row"
            alignItems="center"
            backgroundColor={isDark ? 'gray900' : 'gray100'}
            borderRadius={16}
            padding="m"
            mb="m"
          >
            <Box
              width={48}
              height={48}
              borderRadius={12}
              backgroundColor="black"
              justifyContent="center"
              alignItems="center"
              mr="m"
            >
              <Text variant="p7" color="white" fontWeight="700">
                MP
              </Text>
            </Box>
            <Box flex={1}>
              <Text variant="p6" color="textPrimary" fontWeight="700">
                MoonPay
              </Text>
              <Text variant="p8" color="textSecondary" mt="xs">
                150+ countries · Card & bank transfer
              </Text>
            </Box>
            <Ionicons name="chevron-forward" size={20} color={theme.colors.textSecondary} />
          </Box>
        </TouchableOpacity>

        <Box flexDirection="row" alignItems="center" mb="l">
          <Box flex={1} height={1} backgroundColor="gray800" />
          <Text variant="p7" color="textSecondary" mx="m">
            OR
          </Text>
          <Box flex={1} height={1} backgroundColor="gray800" />
        </Box>

        <TouchableOpacity activeOpacity={0.75} onPress={onReceive}>
          <Box
            height={52}
            borderRadius={26}
            borderWidth={1}
            borderColor="gray800"
            justifyContent="center"
            alignItems="center"
          >
            <Text variant="p6" color="textPrimary" fontWeight="700">
              Receive from another wallet
            </Text>
          </Box>
        </TouchableOpacity>
      </BottomSheet>

      {/* Sibling, not a child: a BottomSheetModal nested inside another sheet's
          content view fights it for the presentation layer. Same arrangement as
          FundWalletSheet's info/status sheets. */}
      <MoonPayAmountSheet
        visible={amountVisible}
        onClose={() => setAmountVisible(false)}
        onContinue={openMoonPay}
        submitting={preparing}
      />
    </>
  );
};

export default BuyXLMSheet;
