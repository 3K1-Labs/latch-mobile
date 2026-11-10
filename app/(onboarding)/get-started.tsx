import { useStatusBarStyle } from '@/hooks/use-status-bar-style';
import { useTheme } from '@shopify/restyle';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RoundBackButton, SetupButton, SetupTitle } from '@/src/components/onboarding/SetupChrome';
import Box from '@/src/components/shared/Box';
import Text from '@/src/components/shared/Text';
import { Theme } from '@/src/theme/theme';

type OptionType = 'new-account' | 'seed-phrase' | 'existing-wallet' | 'recover' | 'passkey';

const GetStarted = () => {
  const theme = useTheme<Theme>();
  const statusBarStyle = useStatusBarStyle();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [selectedOption, setSelectedOption] = useState<OptionType | null>(null);

  const options = [
    // {
    //   id: 'new-account' as OptionType,
    //   title: 'Generate New Smart Account',
    //   description: 'Create a new smart account with a secure recovery phrase',
    // },
    {
      id: 'seed-phrase' as OptionType,
      title: 'Import with Seed Phrase',
      description: 'Restore your account using your 12-word recovery phrase',
    },
    {
      id: 'passkey' as OptionType,
      title: 'Sign In With Passkey',
      description: 'Use your synced Google Password Manager or iCloud Keychain passkey',
    },
    // {
    //   id: 'existing-wallet' as OptionType,
    //   title: 'Connect Existing Stellar Wallet',
    //   description: 'Link your existing stellar wallet to this smart account',
    // },
    {
      id: 'recover' as OptionType,
      title: 'Recover Account',
      description: 'Restore your wallet using your recovery email',
    },
  ];

  const handleContinue = () => {
    switch (selectedOption) {
      // case 'new-account':
      //   router.push('/(onboarding)/recovery-phrase');
      //   break;
      case 'seed-phrase':
        router.push('/(onboarding)/import-phrase');
        break;
      case 'existing-wallet':
        router.push('/(onboarding)/connect-wallet');
        break;
      case 'recover':
        router.push({ pathname: '/(onboarding)/collect-email', params: { mode: 'recovery' } });
        break;
      case 'passkey':
        router.push('/(onboarding)/sign-in-passkey');
        break;
      default:
        router.push('/onboarding');
    }
  };

  return (
    <Box flex={1} backgroundColor="surfaceBase">
      <StatusBar style={statusBarStyle} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.l,
          paddingTop: insets.top + 12,
          paddingBottom: 24,
        }}
      >
        <RoundBackButton onPress={() => router.canGoBack() && router.back()} />

        <Box style={styles.title}>
          <SetupTitle title="I have a Wallet">
            Import the wallet you already have or connect an existing stellar wallet.
          </SetupTitle>
        </Box>

        <Box gap="sm" style={styles.options}>
          {options.map((option) => {
            const selected = selectedOption === option.id;
            return (
              <TouchableOpacity
                key={option.id}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                activeOpacity={0.7}
                onPress={() => setSelectedOption(option.id)}
              >
                <Box
                  style={styles.option}
                  backgroundColor="inputBox"
                  borderWidth={1}
                  borderColor={selected ? 'accentGreen' : 'inputOutline'}
                >
                  <Text
                    variant="p6"
                    fontFamily="SFproMedium"
                    lineHeight={24}
                    letterSpacing={0}
                    color="textPrimary"
                  >
                    {option.title}
                  </Text>
                  <Text variant="p7" color="textSubheading">
                    {option.description}
                  </Text>
                </Box>
              </TouchableOpacity>
            );
          })}
        </Box>
      </ScrollView>

      <Box px="l" pt="m" style={{ paddingBottom: Math.max(insets.bottom, 24) }}>
        <SetupButton label="Continue" disabled={!selectedOption} onPress={handleContinue} />
      </Box>
    </Box>
  );
};

const styles = StyleSheet.create({
  title: {
    marginTop: 56,
  },
  options: {
    marginTop: 48,
  },
  option: {
    gap: 2,
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 24,
  },
});

export default GetStarted;
