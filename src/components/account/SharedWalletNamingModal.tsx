import { Formik } from 'formik';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Toast from 'react-native-toast-message';
import * as Yup from 'yup';

import { fetchDefaultContextRule, fetchRuleThreshold } from '@/src/api/account-admin';
import Box from '@/src/components/shared/Box';
import Button from '@/src/components/shared/Button';
import Input from '@/src/components/shared/Input';
import Text from '@/src/components/shared/Text';
import {
  STELLAR_FACTORY_ADDRESS,
  STELLAR_NETWORK_PASSPHRASE,
  STELLAR_RPC_URL,
} from '@/src/constants/config';
import { addSharedWalletByAddress } from '@/src/lib/add-shared-wallet';
import { useSharedWalletNaming } from '@/src/store/shared-wallet-naming';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shopify/restyle';
import { Theme } from '@/src/theme/theme';

const Schema = Yup.object().shape({
  name: Yup.string().max(40, 'Name is too long'),
});

function simParams() {
  return {
    rpcUrl: STELLAR_RPC_URL,
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
    factoryAddress: STELLAR_FACTORY_ADDRESS,
  };
}

interface WalletInfo {
  signerCount: number;
  threshold: number;
}

/**
 * Drains the auto-detected shared-wallet naming queue one at a time: when this
 * device is discovered as a signer on a shared wallet, the user names it here
 * before it's stored. "Save" and "Use default name" both run the verified add
 * (addSharedWalletByAddress); "Not now" suppresses the wallet for this session
 * (it re-surfaces on a fresh launch) so the queue is never a hard gate. The next
 * foreground sweep won't re-prompt for one already stored or dismissed.
 */
const SharedWalletNamingModal = () => {
  const theme = useTheme<Theme>();
  const queue = useSharedWalletNaming((s) => s.queue);
  const dequeue = useSharedWalletNaming((s) => s.dequeue);
  const dismiss = useSharedWalletNaming((s) => s.dismiss);
  const rehydrate = useSharedWalletNaming((s) => s.rehydrate);
  const address = queue[0];

  // Restore a queue persisted from before a JS reload / app kill so a
  // discovered-but-unnamed wallet reappears immediately, without waiting on
  // the next foreground discovery sweep to re-find it.
  useEffect(() => {
    rehydrate();
  }, [rehydrate]);
  const remaining = queue.length;
  const [submitting, setSubmitting] = useState(false);
  const [info, setInfo] = useState<WalletInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);

  // Read the wallet's on-chain shape (signer count + required threshold) so the
  // user has context for naming it and a "verified on-chain" reassurance — the
  // add re-verifies membership anyway, but the prompt never said so. Read-only
  // simulation; failure just hides the context line (the add still gates).
  useEffect(() => {
    if (!address) {
      setInfo(null);
      return;
    }
    let cancelled = false;
    setInfo(null);
    setInfoLoading(true);
    (async () => {
      try {
        const rule = await fetchDefaultContextRule(simParams(), address);
        let threshold = rule.signers.length;
        try {
          const t = await fetchRuleThreshold(simParams(), address, rule.ruleId);
          if (Number.isFinite(t) && t >= 1) threshold = t;
        } catch {
          /* no threshold policy read — fall back to signer count */
        }
        if (!cancelled) setInfo({ signerCount: rule.signers.length, threshold });
      } catch {
        if (!cancelled) setInfo(null);
      } finally {
        if (!cancelled) setInfoLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address]);

  const addWallet = async (name?: string) => {
    if (submitting || !address) return;
    setSubmitting(true);
    try {
      const account = await addSharedWalletByAddress(address, name);
      Toast.show({ type: 'success', text1: 'Shared wallet added', text2: account.name });
      dequeue();
    } catch (err: any) {
      Toast.show({
        type: 'error',
        text1: 'Could not add wallet',
        text2: err?.message || 'Failed to add shared wallet',
      });
      // Drop it from the queue; a transient failure gets re-detected on the next
      // foreground sweep.
      dequeue();
    } finally {
      setSubmitting(false);
    }
  };

  const handleNotNow = () => {
    if (submitting || !address) return;
    dismiss(address);
  };

  const shortAddress = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '';

  return (
    <Modal
      visible={!!address}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={handleNotNow}
    >
      <View style={styles.overlay}>
        <KeyboardAwareScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' }}
          keyboardShouldPersistTaps="handled"
          bottomOffset={16}
        >
          <Box
            backgroundColor="cardbg"
            borderTopLeftRadius={32}
            borderTopRightRadius={32}
            paddingHorizontal="m"
            pb="xxl"
          >
            <Box alignItems="center" pt="m" mb="l">
              <Box width={36} height={4} borderRadius={2} backgroundColor="gray800" />
            </Box>

            {remaining > 1 && (
              <Box
                alignSelf="center"
                backgroundColor="bg11"
                borderRadius={12}
                px="m"
                py="xs"
                mb="m"
              >
                <Text variant="h12" color="textSecondary">
                  {remaining} new shared wallets to review
                </Text>
              </Box>
            )}

            <Text variant="h8" color="textPrimary" fontWeight="700" textAlign="center" mb="s">
              New shared wallet
            </Text>
            <Text variant="p7" color="textSecondary" textAlign="center" mb="xs">
              You were added as a signer. Give it a name so you can recognise it in your accounts.
            </Text>

            {(infoLoading || info) && (
              <Box flexDirection="row" justifyContent="center" alignItems="center" mb="xs">
                {infoLoading ? (
                  <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                ) : info ? (
                  <Text variant="h12" color="textSecondary" textAlign="center">
                    {info.signerCount} signers · {info.threshold}-of-{info.signerCount} to approve
                  </Text>
                ) : null}
              </Box>
            )}

            <Box flexDirection="row" justifyContent="center" alignItems="center" mb="xl">
              <Ionicons
                name="shield-checkmark"
                size={13}
                color={theme.colors.textSecondary}
                style={{ marginRight: 4 }}
              />
              <Text variant="h12" color="textSecondary" textAlign="center">
                Verified on-chain · {shortAddress}
              </Text>
            </Box>

            <Formik
              initialValues={{ name: '' }}
              validationSchema={Schema}
              onSubmit={(values) => addWallet(values.name.trim())}
            >
              {({ handleChange, handleBlur, handleSubmit, values, errors, touched }) => (
                <>
                  <Input
                    value={values.name}
                    onChangeText={handleChange('name')}
                    onBlur={handleBlur('name')}
                    placeholder="Shared Wallet"
                    autoFocus
                    status={touched.name && errors.name ? 'danger' : 'basic'}
                  />
                  {touched.name && errors.name && (
                    <Text variant="h12" color="inputError" mt="xs">
                      {errors.name}
                    </Text>
                  )}

                  <Button
                    label="Save"
                    variant="primary"
                    onPress={() => handleSubmit()}
                    loading={submitting}
                    mt="l"
                    mb="m"
                  />
                  <Button
                    label="Use default name"
                    variant="ghost"
                    onPress={() => addWallet()}
                    disabled={submitting}
                    mb="xs"
                  />
                  <Button
                    label="Not now"
                    variant="ghost"
                    onPress={handleNotNow}
                    disabled={submitting}
                  />
                </>
              )}
            </Formik>
          </Box>
        </KeyboardAwareScrollView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
});

export default SharedWalletNamingModal;
