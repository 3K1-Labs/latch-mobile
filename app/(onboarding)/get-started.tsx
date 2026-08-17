import { useStatusBarStyle } from '@/hooks/use-status-bar-style';
import { useTheme } from '@shopify/restyle';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Box from '@/src/components/shared/Box';
import Button from '@/src/components/shared/Button';
import Header from '@/src/components/shared/Header';
import Text from '@/src/components/shared/Text';
import { Theme } from '@/src/theme/theme';
import { LinearGradient } from 'expo-linear-gradient';

type OptionType = 'new-account' | 'seed-phrase' | 'existing-wallet' | 'recover' | 'guardians';

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
      title: 'Import With Seed Phrase',
      description: 'Restore your account using your 12-word recovery phrase',
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
    {
      id: 'guardians' as OptionType,
      title: 'Recover With Guardians',
      description: 'Ask the people you trust to restore your wallet on this device',
    },
    // {
    //   id: 'recover' as OptionType,
    //   title: 'Recover Account',
    //   description: 'Restore your wallet using your recovery email',
    // },
  ];

  const handleContinue = () => {
    // Navigate based on selected option
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
      case 'guardians':
        router.push('/(onboarding)/recover-guardians');
        break;
      default:
        router.push('/onboarding');
    }
  };

  return (
    <Box flex={1} backgroundColor="onboardingbg">
      <LinearGradient
        colors={['rgba(50, 60, 14, 0.74)', '#121212']}
        locations={[0, 0.2772]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 0.91 }}
        style={StyleSheet.absoluteFill}
      />
      <StatusBar style={statusBarStyle} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.m,
          paddingBottom: 40,
          paddingTop: 60,
        }}
      >
        {/* Header Section */}
        <Box alignItems="center" mb="xxl">
          <Header />

          <Text variant="h7" mt="m" fontSize={32} textAlign="center">
            I Have A Wallet
          </Text>
          <Text variant="p4" color="textSecondary" mt="xs" textAlign="center" width={'85%'}>
            Import the wallet you already have or connect an existing stellar wallet.
          </Text>
        </Box>

        {/* Options Section */}
        <Box gap="m">
          {options.map((option) => (
            <TouchableOpacity
              key={option.id}
              onPress={() => setSelectedOption(option.id)}
              activeOpacity={0.7}
            >
              <Box
                flexDirection="row"
                alignItems="flex-start"
                gap="m"
                padding="m"
                height={90}
                borderRadius={16}
                borderWidth={2}
                borderColor={
                  selectedOption === option.id
                    ? 'primary700'
                    : statusBarStyle !== 'dark'
                      ? 'gray800'
                      : 'gray200'
                }
                backgroundColor="mainBackground"
              >
                <Box flex={1} mt="s">
                  <Text variant="h10" color="textPrimary" fontWeight="bold">
                    {option.title}
                  </Text>
                  <Text variant="p7" color="textSecondary">
                    {option.description}
                  </Text>
                </Box>
              </Box>
            </TouchableOpacity>
          ))}
        </Box>
      </ScrollView>

      {/* Continue Button at Bottom */}
      <Box
        paddingHorizontal="m"
        paddingTop="m"
        backgroundColor="mainBackground"
        style={{ paddingBottom: Math.max(insets.bottom, 24) }}
      >
        <Button
          label="Continue"
          variant={selectedOption ? 'primary' : 'disabled'}
          onPress={handleContinue}
          bg={selectedOption ? 'primary700' : 'btnDisabled'}
          labelColor={selectedOption ? 'black' : 'gray600'}
          disabled={!selectedOption}
        />
      </Box>
    </Box>
  );
};

export default GetStarted;
