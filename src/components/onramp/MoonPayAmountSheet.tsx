import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { StatusBar } from 'expo-status-bar';
import { Formik } from 'formik';
import React from 'react';
import { Modal, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Yup from 'yup';

import AmountKeypad, {
  applyAmountKey,
  formatAmountDisplay,
} from '@/src/components/onramp/AmountKeypad';
import Box from '@/src/components/shared/Box';
import Button from '@/src/components/shared/Button';
import Text from '@/src/components/shared/Text';
import TokenIcon from '@/src/components/shared/TokenIcon';
import { usePrices } from '@/src/hooks/use-prices';
import { Theme } from '@/src/theme/theme';
import { UNPRICED_LABEL } from '@/src/utils/format-fiat';

/** Fiat currency the amount is denominated in — MoonPay's `baseCurrencyCode`. */
export const MOONPAY_BASE_CURRENCY = 'usd';

/**
 * Client-side floor so we don't hand off a purchase MoonPay will reject anyway.
 * MoonPay is the authority here and its real minimum varies by currency, country
 * and payment method — treat this as a courtesy check, not a rule.
 */
export const MOONPAY_MIN_AMOUNT = 20;

/** Fat-finger ceiling. MoonPay enforces the real per-transaction limits. */
const MOONPAY_MAX_AMOUNT = 20000;

const validationSchema = Yup.object().shape({
  amount: Yup.number()
    .typeError('Enter a valid amount')
    .required('Amount is required')
    .min(MOONPAY_MIN_AMOUNT, `Minimum is $${MOONPAY_MIN_AMOUNT}`)
    .max(MOONPAY_MAX_AMOUNT, `Maximum is $${MOONPAY_MAX_AMOUNT.toLocaleString()}`),
});

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Runs the handoff. Receives the validated amount as a plain decimal string. */
  onContinue: (amount: string) => void | Promise<void>;
  /** True while the intent is being minted and the browser opened. */
  submitting?: boolean;
}

/**
 * Collects the fiat amount before handing off to MoonPay.
 *
 * The amount is locked in the widget (`lockAmount`), so this is the only place
 * the user can set it — which is the point: a locked amount that was never shown
 * in our own UI would be a surprise on MoonPay's screen.
 */
const MoonPayAmountSheet = ({ visible, onClose, onContinue, submitting }: Props) => {
  const theme = useTheme<Theme>();
  const insets = useSafeAreaInsets();
  const { data: prices } = usePrices();
  const xlmPrice = parseFloat(prices?.XLM?.price ?? '0');

  return (
    <Modal visible={visible} animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <Box
        flex={1}
        backgroundColor="mainBackground"
        paddingHorizontal="m"
        style={{ paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 16) }}
      >
        <StatusBar style="light" />

        <Box flexDirection="row" alignItems="center" justifyContent="space-between" py="s" mb="s">
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
          </TouchableOpacity>
          <Text variant="h9" color="textPrimary" fontWeight="700">
            Buy Crypto
          </Text>
          {/* USD is the only base currency we hand MoonPay, so this is a badge, not a picker. */}
          <Box
            flexDirection="row"
            alignItems="center"
            backgroundColor="gray900"
            borderRadius={20}
            pl="xs"
            pr="sm"
            py="xs"
          >
            <Box
              width={24}
              height={24}
              borderRadius={12}
              backgroundColor="primary"
              justifyContent="center"
              alignItems="center"
              mr="xs"
            >
              <Text variant="p8" color="black" fontWeight="700">
                $
              </Text>
            </Box>
            <Text variant="p8" color="textPrimary" fontWeight="700">
              USD
            </Text>
          </Box>
        </Box>

        <Formik
          initialValues={{ amount: '' }}
          validationSchema={validationSchema}
          onSubmit={(values) => onContinue(values.amount.trim())}
        >
          {({ values, errors, handleSubmit, setFieldValue, isValid, dirty }) => {
            const display = formatAmountDisplay(values.amount);
            const numeric = parseFloat(values.amount) || 0;
            const xlmOut =
              xlmPrice > 0
                ? (numeric / xlmPrice).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })
                : UNPRICED_LABEL;
            const amountVariant = display.length <= 6 ? 'h4' : display.length <= 9 ? 'h5' : 'h6';

            return (
              <Box flex={1}>
                <Box flex={1} justifyContent="center" alignItems="center">
                  <Box flexDirection="row" alignItems="flex-start">
                    <Text variant="h7" color={numeric > 0 ? 'textPrimary' : 'textSecondary'} mt="s">
                      $
                    </Text>
                    <Text
                      variant={amountVariant}
                      color={numeric > 0 ? 'textPrimary' : 'textSecondary'}
                    >
                      {display}
                    </Text>
                  </Box>

                  <Text variant="p6" color="textSecondary" mt="s">
                    You get: {xlmOut} XLM
                  </Text>

                  {dirty && !!errors.amount && (
                    <Text variant="p8" color="inputError" mt="s">
                      {errors.amount}
                    </Text>
                  )}
                </Box>

                <Box
                  flexDirection="row"
                  alignItems="center"
                  justifyContent="space-between"
                  py="m"
                  style={{
                    borderTopWidth: 1,
                    borderBottomWidth: 1,
                    borderColor: theme.colors.gray900,
                  }}
                >
                  <Box flexDirection="row" alignItems="center">
                    <TokenIcon size={36} />
                    <Box ml="s">
                      <Text variant="p6" color="textPrimary" fontWeight="700">
                        XLM
                      </Text>
                      <Text variant="p8" color="textSecondary">
                        You buy
                      </Text>
                    </Box>
                  </Box>

                  <Box flexDirection="row" alignItems="center">
                    <Box
                      width={36}
                      height={36}
                      borderRadius={18}
                      backgroundColor="black"
                      justifyContent="center"
                      alignItems="center"
                    >
                      <Text variant="p8" color="white" fontWeight="700">
                        MP
                      </Text>
                    </Box>
                    <Box ml="s">
                      <Text variant="p6" color="textPrimary" fontWeight="700">
                        Card & bank
                      </Text>
                      <Text variant="p8" color="textSecondary">
                        via MoonPay
                      </Text>
                    </Box>
                  </Box>
                </Box>

                <Box my="s">
                  <AmountKeypad
                    disabled={submitting}
                    onKeyPress={(key) => setFieldValue('amount', applyAmountKey(values.amount, key))}
                  />
                </Box>

                <Button
                  label="Buy XLM"
                  onPress={() => handleSubmit()}
                  loading={submitting}
                  disabled={!isValid || !dirty || submitting}
                />
              </Box>
            );
          }}
        </Formik>
      </Box>
    </Modal>
  );
};

export default MoonPayAmountSheet;
