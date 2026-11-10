import { useStatusBarStyle } from '@/hooks/use-status-bar-style';
import {
  RoundBackButton,
  SetupButton,
  SetupTitle,
  StepIndicator,
} from '@/src/components/onboarding/SetupChrome';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import {
  AUTH_POLICIES,
  DEFAULT_AUTH_POLICY,
  saveAuthPolicy,
  type AuthPolicy,
} from '@/src/lib/auth-policy';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const RequestAuthentication = () => {
  const router = useRouter();
  const statusBarStyle = useStatusBarStyle();
  const insets = useSafeAreaInsets();
  const [policy, setPolicy] = useState<AuthPolicy>(DEFAULT_AUTH_POLICY);
  const [saving, setSaving] = useState(false);

  const handleContinue = async () => {
    setSaving(true);
    try {
      await saveAuthPolicy(policy);
      router.push({ pathname: '/(auth)/biometric', params: { from: 'new-wallet' } });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box flex={1} backgroundColor="surfaceBase">
      <StatusBar style={statusBarStyle} />
      <ScrollView
        bounces={false}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}
      >
        <RoundBackButton onPress={() => router.canGoBack() && router.back()} />
        <Box style={styles.step}>
          <StepIndicator step={3} />
        </Box>
        <Box style={styles.title}>
          <SetupTitle title="Request Authentication">
            Choose when you want to input your PIN to secure your wallet.
          </SetupTitle>
        </Box>

        <Box style={styles.options}>
          {AUTH_POLICIES.map(({ value, label }) => {
            const selected = value === policy;
            return (
              <Pressable
                key={value}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => setPolicy(value)}
                style={styles.option}
              >
                <Text variant="p6" lineHeight={24} letterSpacing={0} color="textMuted">
                  {label}
                </Text>
                {selected && (
                  <Box style={styles.selected} backgroundColor="accentGreen">
                    <Ionicons name="checkmark" size={14} color="#111111" />
                  </Box>
                )}
              </Pressable>
            );
          })}
        </Box>
      </ScrollView>

      <Box px="l" pt="m" style={{ paddingBottom: Math.max(insets.bottom, 24) }}>
        <SetupButton label="Continue" busy={saving} onPress={handleContinue} />
      </Box>
    </Box>
  );
};

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  step: {
    marginTop: 56,
  },
  title: {
    marginTop: 32,
  },
  options: {
    marginTop: 48,
    gap: 12,
  },
  option: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selected: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default RequestAuthentication;
